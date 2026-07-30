import { randomUUID } from "node:crypto";
import { generateText, gateway, Output } from "ai";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { mapEvidence, mapOpportunity, mapProduct } from "./mappers.js";
import { createResearchProvider, persistEvidence } from "./providers.js";
import {
  researchStageOneSchema,
  researchStageThreeSchema,
  researchStageTwoSchema,
} from "../shared/schemas.js";
import type {
  DimensionScore,
  EvidenceItem,
  Opportunity,
  Platform,
  Product,
  ResearchReport,
  Verdict,
} from "../shared/types.js";

const dimensions: Array<{
  key: DimensionScore["key"];
  label: string;
  weight: number;
}> = [
  { key: "demand", label: "需求强度", weight: 0.16 },
  { key: "pain", label: "痛点强度", weight: 0.15 },
  { key: "trend", label: "趋势动量", weight: 0.11 },
  { key: "willingness", label: "付费意愿", weight: 0.13 },
  { key: "competitionGap", label: "竞争空档", weight: 0.12 },
  { key: "reachability", label: "用户触达", weight: 0.09 },
  { key: "buildability", label: "可构建性", weight: 0.1 },
  { key: "founderFit", label: "个人匹配", weight: 0.09 },
  { key: "freshness", label: "证据新鲜度", weight: 0.05 },
];

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stableNumber(input: string, min: number, max: number) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

function inferDemoScores(
  opportunity: Opportunity,
  evidence: EvidenceItem[],
  version: number,
  products: Product[],
): DimensionScore[] {
  const metric = (name: string) =>
    evidence.find((item) => item.metric === name)?.value ?? undefined;
  const monthly = metric("monthly_searches") ?? 0;
  const complaints = metric("qualified_complaints") ?? metric("pain_mentions") ?? 20;
  const trend = metric("ninety_day_change") ?? metric("monthly_series_change") ?? 0;
  const density = metric("competition_density") ?? 55;
  const cpc = metric("cpc") ?? 1.2;
  const platformBuildBoost =
    opportunity.recommendedPlatform === "WEB_AND_IOS"
      ? -4
      : opportunity.recommendedPlatform === "WEB"
        ? 5
        : 2;
  const reusableAssetBoost = products.some(
    (product) =>
      product.platform === opportunity.recommendedPlatform ||
      product.platform === "WEB_AND_IOS",
  )
    ? 5
    : 0;

  const values: Record<DimensionScore["key"], number> = {
    demand: clamp(35 + Math.log10(Number(monthly) + 1) * 15),
    pain: clamp(40 + Number(complaints) * 0.9),
    trend: clamp(54 + Number(trend) * 1.25),
    willingness: clamp(48 + Number(cpc) * 7 + stableNumber(opportunity.name, -7, 9)),
    competitionGap: clamp(100 - Number(density) * 0.72),
    reachability: clamp(
      stableNumber(`${opportunity.name}:reach`, 58, 88) + Math.min(4, products.length),
    ),
    buildability: clamp(79 + platformBuildBoost + stableNumber(opportunity.name, -8, 9)),
    founderFit: clamp(
      stableNumber(`${opportunity.name}:fit`, 72, 94) + reusableAssetBoost,
    ),
    freshness: clamp(92 - (version - 1) * 2),
  };

  return dimensions.map((dimension) => ({
    ...dimension,
    score: values[dimension.key],
    explanation: `${dimension.label}基于本轮 ${evidence.length} 条证据和当前产品范围评估。`,
  }));
}

function demoResearch(
  opportunity: Opportunity,
  evidence: EvidenceItem[],
  version: number,
  products: Product[],
): Omit<
  ResearchReport,
  "id" | "opportunityId" | "runId" | "version" | "providerMode" | "createdAt" | "scoreDelta"
> {
  const dimensionScores = inferDemoScores(opportunity, evidence, version, products);
  const score = clamp(
    dimensionScores.reduce((sum, item) => sum + item.score * item.weight, 0),
  );
  const confidence = clamp(52 + evidence.length * 5);
  const verdict: Verdict =
    score >= 80 && confidence >= 65
      ? "BUILD_NOW"
      : score >= 67
        ? "VALIDATE_FIRST"
        : score >= 52
          ? "WATCH"
          : "SKIP";
  const iosAffinity =
    opportunity.recommendedPlatform === "IOS"
      ? 12
      : /photo|截图|camera|voice|receipt|票据/i.test(
            `${opportunity.name} ${opportunity.oneLiner}`,
          )
        ? 8
        : -8;
  const webScore = clamp(score + (iosAffinity < 0 ? 7 : -5));
  const iosScore = clamp(score + iosAffinity);
  const recommendedPlatform: Platform =
    Math.abs(webScore - iosScore) <= 4
      ? "WEB_AND_IOS"
      : webScore > iosScore
        ? "WEB"
        : "IOS";

  return {
    verdict,
    recommendedPlatform,
    recommendedAction:
      verdict === "BUILD_NOW"
        ? "进入 7–14 天 MVP：只实现最强痛点闭环，并同步开放真实付费验证。"
        : verdict === "VALIDATE_FIRST"
          ? "先做价格页、访谈或人工服务测试；达到 3 个付费承诺后再开发。"
          : verdict === "WATCH"
            ? "继续收集搜索、抱怨和付费信号；出现连续增长后重新调研。"
            : "停止开发投入，仅保留证据，除非出现结构性新信号。",
    score,
    confidence,
    dimensionScores,
    supportingReasons: [
      `痛点不是抽象方向：本轮证据把具体工作流问题聚合为 ${dimensionScores.find((item) => item.key === "pain")?.score}/100。`,
      `需求和触达路径均可量化，适合用窄范围页面或原型快速验证。`,
      `可构建性 ${dimensionScores.find((item) => item.key === "buildability")?.score}/100，个人开发可控。`,
    ],
    opposingReasons: [
      "当前证据仍以方向信号为主，真实付费转化需要单独验证。",
      "竞品可能快速补齐单点功能，产品必须围绕完整工作流而非功能按钮。",
    ],
    unknowns: ["首批用户的真实获客成本", "价格敏感度", "第 7 天留存"],
    risks: ["样本偏差", "平台原生功能替代", "演示数据与真实市场存在差异"],
    platformAnalysis: {
      web: {
        score: webScore,
        note:
          webScore >= iosScore
            ? "搜索落地、快速迭代和低摩擦试用更占优势。"
            : "可做获客入口，但核心工作流更偏移动端。",
      },
      ios: {
        score: iosScore,
        note:
          iosScore > webScore
            ? "移动场景与系统能力能显著缩短用户完成路径。"
            : "暂未发现必须依赖 iOS 系统能力的决定性理由。",
      },
    },
    mvp: {
      promise: opportunity.oneLiner,
      coreFeatures: ["单一核心输入", "自动完成关键处理", "结果预览与导出"],
      exclusions: ["团队协作", "复杂账户体系", "自动化工作流市场", "多档订阅"],
      validationTest: "上线可操作原型和价格页，面向 20 位目标用户，验证至少 5 次完整使用与 3 次付费。",
      estimatedDays: recommendedPlatform === "WEB_AND_IOS" ? 18 : score >= 78 ? 10 : 14,
    },
    evidenceIds: evidence.map((item) => item.id),
    changeSummary:
      version === 1
        ? `首次完成九维度调研，基准分 ${score}。`
        : `加入 ${evidence.length} 条新证据后重新判断；重点变化来自趋势与证据新鲜度。`,
    researcherSummary: `研究员将 ${evidence.length} 条证据拆分为需求、趋势、痛点、竞争与商业信号，并结合 ${products.length} 个现有产品判断资产复用与重复建设风险。`,
    debateSummary: "正方认为痛点具体且范围可控；反方要求先验证付费和防替代性。Judge 根据九维度证据作出最终结论。",
  };
}

async function realResearch(
  opportunity: Opportunity,
  evidence: EvidenceItem[],
  previousReport: ResearchReport | null,
  products: Product[],
  config: AppConfig,
) {
  const evidenceText = evidence
    .slice(0, 30)
    .map(
      (item) =>
        `- [${item.category}] ${item.sourceName}: ${item.summary} (${item.metric}=${item.value ?? "N/A"} ${item.unit ?? ""})`,
    )
    .join("\n");
  const context = `候选产品：${opportunity.name}
一句话：${opportunity.oneLiner}
目标用户：${opportunity.targetUser}
候选平台：${opportunity.recommendedPlatform}
现有产品组合：
${products.length ? products.map((product) => `- ${product.name} / ${product.platform} / ${product.status}: ${product.description}`).join("\n") : "- 暂无"}
证据：
${evidenceText}
上一版结论：${previousReport ? `${previousReport.verdict}, ${previousReport.score}分` : "无"}`;

  const researcher = await generateText({
    model: gateway(config.aiModel),
    output: Output.object({ schema: researchStageOneSchema }),
    system: "你是严谨的产品市场研究员。只基于给定证据提取事实，明确缺口，不得把推测写成数据。",
    prompt: context,
  });
  const debate = await generateText({
    model: gateway(config.aiModel),
    output: Output.object({ schema: researchStageTwoSchema }),
    system: "你同时扮演产品机会的 Advocate 与 Critic。用同一组证据进行最强正反论证。",
    prompt: `${context}\n研究员输出：${JSON.stringify(researcher.output)}`,
  });
  const judge = await generateText({
    model: gateway(config.aiModel),
    output: Output.object({ schema: researchStageThreeSchema }),
    system:
      "你是最终产品投资判断者。目标不是产生点子，而是筛选是否值得由一名独立开发者投入开发。评分必须由证据支撑；证据不足时降低置信度并优先 VALIDATE_FIRST 或 WATCH。",
    prompt: `${context}
研究员：${JSON.stringify(researcher.output)}
正反辩论：${JSON.stringify(debate.output)}
九个维度的 key、中文标签、固定权重必须分别为：
${dimensions.map((item) => `${item.key}/${item.label}/${item.weight}`).join("\n")}`,
  });

  return {
    ...judge.output,
    evidenceIds: evidence.map((item) => item.id),
    researcherSummary: researcher.output.factualSummary,
    debateSummary: debate.output.debateSummary,
  };
}

function getReport(db: RadarDatabase, opportunityId: string): ResearchReport | null {
  const row = db
    .prepare(
      "SELECT * FROM research_reports WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1",
    )
    .get(opportunityId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload = JSON.parse(String(row.payload_json)) as Partial<ResearchReport>;
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    runId: String(row.run_id),
    version: Number(row.version),
    providerMode: row.provider_mode as ResearchReport["providerMode"],
    verdict: row.verdict as Verdict,
    recommendedPlatform: row.recommended_platform as Platform,
    recommendedAction: String(row.recommended_action),
    score: Number(row.score),
    scoreDelta: Number(row.score_delta),
    confidence: Number(row.confidence),
    dimensionScores: payload.dimensionScores ?? [],
    supportingReasons: payload.supportingReasons ?? [],
    opposingReasons: payload.opposingReasons ?? [],
    unknowns: payload.unknowns ?? [],
    risks: payload.risks ?? [],
    platformAnalysis: payload.platformAnalysis!,
    mvp: payload.mvp!,
    evidenceIds: payload.evidenceIds ?? [],
    changeSummary: String(row.change_summary),
    researcherSummary: String(row.researcher_summary),
    debateSummary: String(row.debate_summary),
    createdAt: String(row.created_at),
  };
}

export async function researchOpportunity(
  db: RadarDatabase,
  opportunityId: string,
  config: AppConfig,
): Promise<ResearchReport> {
  const opportunityRow = db
    .prepare("SELECT * FROM opportunities WHERE id = ?")
    .get(opportunityId) as Record<string, unknown> | undefined;
  if (!opportunityRow) throw new Error("找不到这个候选产品");

  const opportunity = mapOpportunity(opportunityRow);
  const previousReport = getReport(db, opportunityId);
  const version = (previousReport?.version ?? 0) + 1;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const provider = createResearchProvider(config);
  const providerMode =
    config.researchProvider === "real" && config.aiGatewayApiKey && provider.mode === "REAL"
      ? "REAL"
      : "DEMO";

  db.prepare(
    `INSERT INTO discovery_runs (
      id, opportunity_id, status, provider_mode, started_at
    ) VALUES (?, ?, 'RUNNING', ?, ?)`,
  ).run(runId, opportunityId, providerMode, startedAt);
  db.prepare(
    "UPDATE opportunities SET research_status = 'RUNNING', updated_at = ? WHERE id = ?",
  ).run(startedAt, opportunityId);

  try {
    const newEvidence = await provider.collect(opportunity, version);
    persistEvidence(db, newEvidence);
    const evidenceRows = db
      .prepare(
        "SELECT * FROM evidence_items WHERE opportunity_id = ? ORDER BY collected_at DESC LIMIT 40",
      )
      .all(opportunityId) as Record<string, unknown>[];
    const evidence = evidenceRows.map(mapEvidence);
    const products = (
      db.prepare("SELECT * FROM products WHERE status != 'ARCHIVED'").all() as Record<
        string,
        unknown
      >[]
    ).map(mapProduct);
    const output =
      providerMode === "REAL"
        ? await realResearch(opportunity, evidence, previousReport, products, config)
        : demoResearch(opportunity, evidence, version, products);
    const scoreDelta = output.score - (previousReport?.score ?? 0);
    const finishedAt = new Date().toISOString();
    const reportId = randomUUID();
    const payload = {
      dimensionScores: output.dimensionScores,
      supportingReasons: output.supportingReasons,
      opposingReasons: output.opposingReasons,
      unknowns: output.unknowns,
      risks: output.risks,
      platformAnalysis: output.platformAnalysis,
      mvp: output.mvp,
      evidenceIds: output.evidenceIds,
    };

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO research_reports (
          id, opportunity_id, run_id, version, provider_mode, verdict,
          recommended_platform, recommended_action, score, score_delta, confidence,
          payload_json, change_summary, researcher_summary, debate_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        opportunityId,
        runId,
        version,
        providerMode,
        output.verdict,
        output.recommendedPlatform,
        output.recommendedAction,
        output.score,
        scoreDelta,
        output.confidence,
        JSON.stringify(payload),
        output.changeSummary,
        output.researcherSummary,
        output.debateSummary,
        finishedAt,
      );
      db.prepare(`
        UPDATE opportunities SET
          recommended_platform = ?, verdict = ?, research_status = 'READY',
          score = ?, score_delta = ?, confidence = ?,
          demand_score = ?, pain_score = ?, trend_score = ?, willingness_score = ?,
          competition_gap_score = ?, reachability_score = ?, buildability_score = ?,
          founder_fit_score = ?, freshness_score = ?, change_summary = ?,
          updated_at = ?, last_researched_at = ?
        WHERE id = ?
      `).run(
        output.recommendedPlatform,
        output.verdict,
        output.score,
        scoreDelta,
        output.confidence,
        output.dimensionScores.find((item) => item.key === "demand")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "pain")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "trend")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "willingness")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "competitionGap")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "reachability")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "buildability")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "founderFit")?.score ?? 0,
        output.dimensionScores.find((item) => item.key === "freshness")?.score ?? 0,
        output.changeSummary,
        finishedAt,
        finishedAt,
        opportunityId,
      );
      db.prepare(
        "UPDATE discovery_runs SET status = 'COMPLETED', finished_at = ? WHERE id = ?",
      ).run(finishedAt, runId);
    });
    transaction();

    return {
      id: reportId,
      opportunityId,
      runId,
      version,
      providerMode,
      verdict: output.verdict,
      recommendedPlatform: output.recommendedPlatform,
      recommendedAction: output.recommendedAction,
      score: output.score,
      scoreDelta,
      confidence: output.confidence,
      dimensionScores: output.dimensionScores,
      supportingReasons: output.supportingReasons,
      opposingReasons: output.opposingReasons,
      unknowns: output.unknowns,
      risks: output.risks,
      platformAnalysis: output.platformAnalysis,
      mvp: output.mvp,
      evidenceIds: output.evidenceIds,
      changeSummary: output.changeSummary,
      researcherSummary: output.researcherSummary,
      debateSummary: output.debateSummary,
      createdAt: finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知调研错误";
    const failedAt = new Date().toISOString();
    db.prepare(
      "UPDATE discovery_runs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?",
    ).run(message, failedAt, runId);
    db.prepare(
      "UPDATE opportunities SET research_status = 'FAILED', updated_at = ? WHERE id = ?",
    ).run(failedAt, opportunityId);
    throw error;
  }
}
