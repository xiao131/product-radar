export type Platform = "WEB" | "IOS" | "WEB_AND_IOS";
export type Verdict = "BUILD_NOW" | "VALIDATE_FIRST" | "WATCH" | "SKIP";
export type ResearchStatus = "UNRESEARCHED" | "READY" | "RUNNING" | "FAILED";
export type SignalStatus = "NEW" | "PROCESSED" | "ARCHIVED";
export type SignalSource =
  | "IDEA"
  | "REDDIT"
  | "X"
  | "APP_REVIEW"
  | "APP_STORE"
  | "SEARCH"
  | "TREND"
  | "FORUM"
  | "CUSTOMER"
  | "OTHER";

export type DimensionKey =
  | "demand"
  | "pain"
  | "trend"
  | "willingness"
  | "competitionGap"
  | "reachability"
  | "buildability"
  | "founderFit"
  | "freshness";

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface PlatformAnalysis {
  web: { score: number; note: string };
  ios: { score: number; note: string };
}

export interface MvpPlan {
  promise: string;
  coreFeatures: string[];
  exclusions: string[];
  validationTest: string;
  estimatedDays: number;
}

export interface Opportunity {
  id: string;
  name: string;
  oneLiner: string;
  targetUser: string;
  sourceType: SignalSource;
  recommendedPlatform: Platform;
  verdict: Verdict;
  researchStatus: ResearchStatus;
  score: number;
  scoreDelta: number;
  confidence: number;
  demandScore: number;
  painScore: number;
  trendScore: number;
  willingnessScore: number;
  competitionGapScore: number;
  reachabilityScore: number;
  buildabilityScore: number;
  founderFitScore: number;
  freshnessScore: number;
  changeSummary: string;
  discoveryKey?: string | null;
  autoDiscovered?: boolean;
  createdAt: string;
  updatedAt: string;
  lastResearchedAt: string | null;
}

export interface EvidenceItem {
  id: string;
  opportunityId: string;
  category:
    | "SEARCH"
    | "TREND"
    | "COMPLAINT"
    | "COMPETITOR"
    | "APP_STORE"
    | "COMMERCIAL"
    | "BUILD";
  sourceName: string;
  sourceUrl: string | null;
  metric: string;
  value: number | null;
  unit: string | null;
  direction: "UP" | "FLAT" | "DOWN" | "UNKNOWN";
  strength: number;
  summary: string;
  rawExcerpt: string | null;
  collectedAt: string;
  freshnessDays: number;
  fingerprint?: string | null;
  market?: string | null;
}

export interface ResearchReport {
  id: string;
  opportunityId: string;
  runId: string;
  version: number;
  providerMode: "DEMO" | "REAL";
  verdict: Verdict;
  recommendedPlatform: Platform;
  recommendedAction: string;
  score: number;
  scoreDelta: number;
  confidence: number;
  dimensionScores: DimensionScore[];
  supportingReasons: string[];
  opposingReasons: string[];
  unknowns: string[];
  risks: string[];
  platformAnalysis: PlatformAnalysis;
  mvp: MvpPlan;
  evidenceIds: string[];
  citedClaims?: Array<{ text: string; evidenceIds: string[] }>;
  modelId?: string | null;
  promptVersion?: string | null;
  evidenceCoverage?: {
    categories: string[];
    sourceCount: number;
    evidenceCount: number;
    gapCount: number;
  };
  evidenceSnapshot?: Array<Record<string, unknown>>;
  guardrail?: {
    applied: boolean;
    reasons: string[];
    originalVerdict?: Verdict;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  changeSummary: string;
  researcherSummary: string;
  debateSummary: string;
  createdAt: string;
}

export interface ResearchResponse extends ResearchReport {
  cached: boolean;
  freshnessDays: number;
}

export interface BatchResearchResult {
  requested: number;
  researched: number;
  unchanged: number;
  failed: number;
  delivery: "live" | "standard";
  providerMode: "DEMO" | "REAL";
  failures: Array<{ opportunityId: string; message: string }>;
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  evidence: EvidenceItem[];
  reports: ResearchReport[];
  signals: Signal[];
}

export interface Product {
  id: string;
  name: string;
  platform: Platform;
  status: "IDEA" | "BUILDING" | "LIVE" | "PAUSED" | "ARCHIVED";
  url: string | null;
  description: string;
  currentFocus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Signal {
  id: string;
  sourceType: SignalSource;
  title: string;
  content: string;
  sourceUrl: string | null;
  tags: string[];
  status: SignalStatus;
  opportunityId: string | null;
  fingerprint?: string | null;
  market?: string | null;
  sourceName?: string | null;
  metrics?: Record<string, unknown>;
  discoveryRunId?: string | null;
  autoCollected?: boolean;
  canonicalKey?: string | null;
  duplicateCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OpportunityOption {
  id: string;
  name: string;
  recommendedPlatform: Platform;
}

export interface DashboardData {
  mode: "DEMO" | "REAL";
  topOpportunities: Opportunity[];
  risingOpportunities: Opportunity[];
  watchlist: Opportunity[];
  products: Product[];
  stats: {
    opportunities: number;
    buildNow: number;
    unresearched: number;
    liveProducts: number;
  };
}

export interface OperationsStatus {
  mode: "DEMO" | "REAL";
  markets: Array<{
    locationCode: number;
    languageCode: string;
    countryCode: string;
  }>;
  market: {
    locationCode: number;
    languageCode: string;
    countryCode: string;
  };
  sources: {
    ai: boolean;
    search: boolean;
    webCompetitors: boolean;
    appleMarket: boolean;
  };
  freshness: {
    due: number;
    running: number;
    failed: number;
    latestResearchAt: string | null;
  };
  usage: {
    ai: {
      used: number;
      limit: number;
      inputTokens: number;
      outputTokens: number;
    };
    dataForSeo: {
      used: number;
      limit: number;
      reportedCostUsd: number;
      dailyCostLimitUsd: number;
      discoveryCostUsd: number;
      discoveryCostLimitUsd: number;
      monthlyCostUsd: number;
      monthlyCostLimitUsd: number;
    };
  };
  scheduler: {
    enabled: boolean;
    discoveryEnabled: boolean;
    discoveryHour: number;
    researchHour: number;
    backupHour: number;
  };
  discovery: {
    latestAt: string | null;
    latestStatus: string | null;
    collectedSignals: number;
    createdCandidates: number;
    refreshedCandidates: number;
    collectionReused: boolean;
  };
  jobs: Array<{
    id: string;
    type: string;
    trigger: string;
    status: string;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  latestBackup: {
    status: string;
    fileName: string | null;
    sizeBytes: number | null;
    integrity: string | null;
    finishedAt: string | null;
  } | null;
}
