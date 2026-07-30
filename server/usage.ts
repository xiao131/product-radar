import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";

export type UsageProvider = "AI" | "DATAFORSEO";

export class UsageBudgetExceededError extends Error {
  constructor(
    public readonly provider: UsageProvider,
    public readonly limit: number,
  ) {
    super(
      provider === "AI"
        ? `今日 AI 调研预算已达到 ${limit} 次`
        : `今日 DataForSEO 任务预算已达到 ${limit} 个`,
    );
  }
}

function startOfLocalDay() {
  const date = new Date();
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
  ) {
    const limit =
      provider === "AI"
        ? this.config.maxAiRunsPerDay
        : this.config.maxDataForSeoTasksPerDay;
    const createdAt = new Date().toISOString();
    this.db.transaction(() => {
      const used = Number(
        (
          this.db
            .prepare(
              `SELECT COALESCE(SUM(units), 0) AS units
               FROM usage_events
               WHERE provider = ? AND created_at >= ?`,
            )
            .get(provider, startOfLocalDay()) as { units: number }
        ).units,
      );
      if (used + units > limit) {
        throw new UsageBudgetExceededError(provider, limit);
      }
      this.db
        .prepare(
          `INSERT INTO usage_events (
             id, provider, operation, units, metadata_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          provider,
          operation,
          units,
          JSON.stringify(metadata),
          createdAt,
        );
    })();
  }

  recordMeasurement(
    provider: UsageProvider,
    operation: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    metadata: Record<string, unknown> = {},
  ) {
    this.db
      .prepare(
        `INSERT INTO usage_events (
           id, provider, operation, units, input_tokens, output_tokens,
           cost_usd, metadata_json, created_at
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        provider,
        operation,
        Math.max(0, Math.round(inputTokens)),
        Math.max(0, Math.round(outputTokens)),
        Math.max(0, costUsd),
        JSON.stringify(metadata),
        new Date().toISOString(),
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
        reportedCostUsd: Number(dataForSeo?.cost_usd ?? 0),
      },
    };
  }
}
