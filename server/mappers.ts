import type {
  EvidenceItem,
  Opportunity,
  Product,
  ResearchReport,
  Signal,
} from "../shared/types.js";

type Row = Record<string, unknown>;

export function mapOpportunity(row: Row): Opportunity {
  return {
    id: String(row.id),
    name: String(row.name),
    oneLiner: String(row.one_liner),
    targetUser: String(row.target_user),
    sourceType: row.source_type as Opportunity["sourceType"],
    recommendedPlatform: row.recommended_platform as Opportunity["recommendedPlatform"],
    verdict: row.verdict as Opportunity["verdict"],
    researchStatus: row.research_status as Opportunity["researchStatus"],
    score: Number(row.score),
    scoreDelta: Number(row.score_delta),
    confidence: Number(row.confidence),
    demandScore: Number(row.demand_score),
    painScore: Number(row.pain_score),
    trendScore: Number(row.trend_score),
    willingnessScore: Number(row.willingness_score),
    competitionGapScore: Number(row.competition_gap_score),
    reachabilityScore: Number(row.reachability_score),
    buildabilityScore: Number(row.buildability_score),
    founderFitScore: Number(row.founder_fit_score),
    freshnessScore: Number(row.freshness_score),
    changeSummary: String(row.change_summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastResearchedAt: row.last_researched_at ? String(row.last_researched_at) : null,
  };
}

export function mapProduct(row: Row): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    platform: row.platform as Product["platform"],
    status: row.status as Product["status"],
    url: row.url ? String(row.url) : null,
    description: String(row.description),
    currentFocus: String(row.current_focus),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapSignal(row: Row): Signal {
  let tags: string[] = [];
  try {
    tags = JSON.parse(String(row.tags_json));
  } catch {
    tags = [];
  }
  return {
    id: String(row.id),
    sourceType: row.source_type as Signal["sourceType"],
    title: String(row.title),
    content: String(row.content),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    tags,
    status: row.status as Signal["status"],
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapEvidence(row: Row): EvidenceItem {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    category: row.category as EvidenceItem["category"],
    sourceName: String(row.source_name),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    metric: String(row.metric),
    value: row.value === null || row.value === undefined ? null : Number(row.value),
    unit: row.unit ? String(row.unit) : null,
    direction: row.direction as EvidenceItem["direction"],
    strength: Number(row.strength),
    summary: String(row.summary),
    rawExcerpt: row.raw_excerpt ? String(row.raw_excerpt) : null,
    collectedAt: String(row.collected_at),
    freshnessDays: Number(row.freshness_days),
    fingerprint: row.fingerprint ? String(row.fingerprint) : null,
    market: row.market ? String(row.market) : null,
  };
}

export function mapReport(row: Row): ResearchReport {
  const payload = JSON.parse(String(row.payload_json)) as Partial<ResearchReport>;
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    runId: String(row.run_id),
    version: Number(row.version),
    providerMode: row.provider_mode as ResearchReport["providerMode"],
    verdict: row.verdict as ResearchReport["verdict"],
    recommendedPlatform: row.recommended_platform as ResearchReport["recommendedPlatform"],
    recommendedAction: String(row.recommended_action),
    score: Number(row.score),
    scoreDelta: Number(row.score_delta),
    confidence: Number(row.confidence),
    dimensionScores: payload.dimensionScores ?? [],
    supportingReasons: payload.supportingReasons ?? [],
    opposingReasons: payload.opposingReasons ?? [],
    unknowns: payload.unknowns ?? [],
    risks: payload.risks ?? [],
    platformAnalysis: payload.platformAnalysis ?? {
      web: { score: 0, note: "" },
      ios: { score: 0, note: "" },
    },
    mvp: payload.mvp ?? {
      promise: "",
      coreFeatures: [],
      exclusions: [],
      validationTest: "",
      estimatedDays: 0,
    },
    evidenceIds: payload.evidenceIds ?? [],
    citedClaims: payload.citedClaims ?? [],
    modelId: payload.modelId ?? (row.model_id ? String(row.model_id) : null),
    promptVersion:
      payload.promptVersion ??
      (row.prompt_version ? String(row.prompt_version) : null),
    evidenceCoverage: payload.evidenceCoverage,
    evidenceSnapshot: payload.evidenceSnapshot,
    guardrail: payload.guardrail,
    usage: payload.usage,
    changeSummary: String(row.change_summary),
    researcherSummary: String(row.researcher_summary),
    debateSummary: String(row.debate_summary),
    createdAt: String(row.created_at),
  };
}
