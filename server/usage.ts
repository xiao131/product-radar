import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";

export type UsageProvider = "AI" | "DATAFORSEO";

export class UsageBudgetExceededError extends Error {
  constructor(
    public readonly provider: UsageProvider,
    public readonly limit: number,
    public readonly budgetType:
      | "units"
      | "daily_cost"
      | "discovery_cost"
      | "monthly_cost" = "units",
  ) {
    super(
      budgetType === "daily_cost"
        ? `今日 DataForSEO 费用将超过 $${limit.toFixed(2)} 上限`
        : budgetType === "discovery_cost"
          ? `今日自动发现费用将超过 $${limit.toFixed(2)} 上限，已在请求前停止`
        : budgetType === "monthly_cost"
          ? `本月 DataForSEO 费用将超过 $${limit.toFixed(2)} 上限`
          : provider === "AI"
            ? `今日 AI 调研预算已达到 ${limit} 次`
            : `今日 DataForSEO 计费子任务预算已达到 ${limit} 个`,
    );
  }
}

function startOfLocalDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfLocalMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export class UsageLedger {
  constructor(
    private readonly db: RadarDatabase,
    private readonly config: AppConfig,
  ) {}

  reserve(
    provider: UsageProvider,
    operation: string,
    units = 1,
    metadata: Record<string, unknown> = {},
    estimatedCostUsd = 0,
  ) {
    const limit =
      provider === "AI"
        ? this.config.maxAiRunsPerDay
        : this.config.maxDataForSeoTasksPerDay;
    const createdAt = new Date().toISOString();
    const reservationId = randomUUID();
    this.db.transaction(() => {
      const usage = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN created_at >= ? THEN units ELSE 0 END), 0) AS daily_units,
             COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_usd ELSE 0 END), 0) AS daily_cost,
             COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_usd ELSE 0 END), 0) AS monthly_cost
           FROM usage_events
           WHERE provider = ?`,
        )
        .get(
          startOfLocalDay(),
          startOfLocalDay(),
          startOfLocalMonth(),
          provider,
        ) as {
        daily_units: number;
        daily_cost: number;
        monthly_cost: number;
      };
      const used = Number(usage.daily_units);
      const reservedCost = Math.max(0, estimatedCostUsd);
      if (provider === "DATAFORSEO" && operation.startsWith("discovery_")) {
        const discoveryUsage = this.db
          .prepare(
            `SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd
             FROM usage_events
             WHERE provider = 'DATAFORSEO'
               AND operation LIKE 'discovery_%'
               AND created_at >= ?`,
          )
          .get(startOfLocalDay()) as { cost_usd: number };
        if (
          Number(discoveryUsage.cost_usd) + reservedCost >
          this.config.maxDataForSeoDiscoveryCostPerDayUsd
        ) {
          throw new UsageBudgetExceededError(
            provider,
            this.config.maxDataForSeoDiscoveryCostPerDayUsd,
            "discovery_cost",
          );
        }
      }
      if (
        provider === "DATAFORSEO" &&
        Number(usage.daily_cost) + reservedCost >
          this.config.maxDataForSeoCostPerDayUsd
      ) {
        throw new UsageBudgetExceededError(
          provider,
          this.config.maxDataForSeoCostPerDayUsd,
          "daily_cost",
        );
      }
      if (
        provider === "DATAFORSEO" &&
        Number(usage.monthly_cost) + reservedCost >
          this.config.maxDataForSeoCostPerMonthUsd
      ) {
        throw new UsageBudgetExceededError(
          provider,
          this.config.maxDataForSeoCostPerMonthUsd,
          "monthly_cost",
        );
      }
      if (used + units > limit) {
        throw new UsageBudgetExceededError(provider, limit);
      }
      this.db
        .prepare(
          `INSERT INTO usage_events (
             id, provider, operation, units, cost_usd, metadata_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reservationId,
          provider,
          operation,
          units,
          reservedCost,
          JSON.stringify(metadata),
          createdAt,
        );
    })();
    return reservationId;
  }

  settle(
    reservationId: string | undefined,
    operation: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    metadata: Record<string, unknown> = {},
  ) {
    if (!reservationId) return;
    this.db
      .prepare(
        `UPDATE usage_events
         SET operation = ?,
             input_tokens = ?,
             output_tokens = ?,
             cost_usd = ?,
             metadata_json = ?
         WHERE id = ?`,
      )
      .run(
        operation,
        Math.max(0, Math.round(inputTokens)),
        Math.max(0, Math.round(outputTokens)),
        Math.max(0, costUsd),
        JSON.stringify(metadata),
        reservationId,
      );
  }

  today() {
    const rows = this.db
      .prepare(
        `SELECT provider,
                COALESCE(SUM(units), 0) AS units,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_events
         WHERE created_at >= ?
         GROUP BY provider`,
      )
      .all(startOfLocalDay()) as Array<{
      provider: UsageProvider;
      units: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }>;
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const ai = byProvider.get("AI");
    const dataForSeo = byProvider.get("DATAFORSEO");
    const monthlyDataForSeo = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_events
         WHERE provider = 'DATAFORSEO' AND created_at >= ?`,
      )
      .get(startOfLocalMonth()) as { cost_usd: number };
    const dailyDiscoveryDataForSeo = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_events
         WHERE provider = 'DATAFORSEO'
           AND operation LIKE 'discovery_%'
           AND created_at >= ?`,
      )
      .get(startOfLocalDay()) as { cost_usd: number };
    const dailyDataForSeoRequests = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM usage_events
         WHERE provider = 'DATAFORSEO' AND created_at >= ?`,
      )
      .get(startOfLocalDay()) as { count: number };
    return {
      ai: {
        used: Number(ai?.units ?? 0),
        limit: this.config.maxAiRunsPerDay,
        inputTokens: Number(ai?.input_tokens ?? 0),
        outputTokens: Number(ai?.output_tokens ?? 0),
      },
      dataForSeo: {
        used: Number(dataForSeo?.units ?? 0),
        limit: this.config.maxDataForSeoTasksPerDay,
        billedRequests: Number(dailyDataForSeoRequests.count ?? 0),
        reportedCostUsd: Number(dataForSeo?.cost_usd ?? 0),
        dailyCostLimitUsd: this.config.maxDataForSeoCostPerDayUsd,
        discoveryCostUsd: Number(
          dailyDiscoveryDataForSeo.cost_usd ?? 0,
        ),
        discoveryCostLimitUsd:
          this.config.maxDataForSeoDiscoveryCostPerDayUsd,
        monthlyCostUsd: Number(monthlyDataForSeo.cost_usd ?? 0),
        monthlyCostLimitUsd: this.config.maxDataForSeoCostPerMonthUsd,
      },
    };
  }
}
