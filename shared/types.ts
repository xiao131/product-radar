export type Platform = "WEB" | "IOS" | "WEB_AND_IOS";
export type Verdict = "BUILD_NOW" | "VALIDATE_FIRST" | "WATCH" | "SKIP";
export type ResearchStatus = "UNRESEARCHED" | "READY" | "RUNNING" | "FAILED";
export type SignalStatus = "NEW" | "PROCESSED" | "ARCHIVED";
export type SignalSource =
  | "IDEA"
  | "REDDIT"
  | "X"
  | "APP_REVIEW"
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
  changeSummary: string;
  researcherSummary: string;
  debateSummary: string;
  createdAt: string;
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
    signalsWaiting: number;
    liveProducts: number;
  };
}
