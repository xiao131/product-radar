import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  DimensionScore,
  EvidenceItem,
  Opportunity,
  ResearchReport,
  SignalSource,
  UiLocale,
  Verdict,
  WorkflowStatus,
} from "../shared/types";
import { localizedOpportunity as resolveOpportunity } from "../shared/localization";

const STORAGE_KEY = "product-radar:ui-locale";

interface I18nContextValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (zh: string, en: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): UiLocale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(initialLocale);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The active session still keeps the selected language.
    }
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? "产品雷达" : "Product Radar";
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (zh, en) => (locale === "zh-CN" ? zh : en),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className={`language-switch ${compact ? "language-switch--compact" : ""}`}
      role="group"
      aria-label={t("界面语言", "Interface language")}
    >
      <button
        type="button"
        className={locale === "zh-CN" ? "is-active" : ""}
        aria-pressed={locale === "zh-CN"}
        onClick={() => setLocale("zh-CN")}
      >
        中文
      </button>
      <button
        type="button"
        className={locale === "en" ? "is-active" : ""}
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}

export function opportunityForLocale(
  opportunity: Opportunity,
  locale: UiLocale,
) {
  return resolveOpportunity(opportunity, locale);
}

export function reportForLocale(report: ResearchReport, locale: UiLocale) {
  const localized = report.localizedContent?.[locale];
  if (!localized) return report;
  return {
    ...report,
    recommendedAction: localized.recommendedAction,
    dimensionScores: report.dimensionScores.map(
      (item): DimensionScore => ({
        ...item,
        explanation: localized.dimensionExplanations[item.key] || item.explanation,
      }),
    ),
    supportingReasons: localized.supportingReasons,
    opposingReasons: localized.opposingReasons,
    unknowns: localized.unknowns,
    risks: localized.risks,
    citedClaims: report.citedClaims?.map((claim, index) => ({
      ...claim,
      text: localized.citedClaimTexts[index] || claim.text,
    })),
    platformAnalysis: localized.platformAnalysis,
    mvp: localized.mvp,
    changeSummary: localized.changeSummary,
    researcherSummary: localized.researcherSummary,
    debateSummary: localized.debateSummary,
    guardrail: report.guardrail
      ? {
          ...report.guardrail,
          reasons: report.guardrail.reasons.map((reason) =>
            locale === "zh-CN" ? reason : guardrailReasonInEnglish(reason),
          ),
        }
      : report.guardrail,
  };
}

function guardrailReasonInEnglish(reason: string) {
  const translations: Record<string, string> = {
    "独立证据类别少于 3 类": "Fewer than three independent evidence categories",
    "独立证据来源少于 3 个": "Fewer than three independent evidence sources",
    "缺少用户痛点或抱怨证据": "Missing user pain or complaint evidence",
    "缺少 Web 或 App Store 竞争证据": "Missing Web or App Store competition evidence",
    "可追溯的关键证据引用不足": "Insufficient traceable citations for key claims",
  };
  return translations[reason] ?? reason;
}

export function evidenceForLocale(item: EvidenceItem, locale: UiLocale) {
  const translated = item.translations?.[locale];
  return {
    summary: translated?.summary || item.summary,
    rawExcerpt:
      translated?.rawExcerpt === undefined
        ? item.rawExcerpt
        : translated.rawExcerpt,
    translated: Boolean(translated),
  };
}

export function marketName(code: string, locale: UiLocale) {
  const normalized = code.split("/", 1)[0]?.toUpperCase();
  const names: Record<string, [string, string]> = {
    CN: ["中国市场", "China"],
    US: ["美国市场", "United States"],
    GB: ["英国市场", "United Kingdom"],
    GLOBAL: ["全球市场", "Global"],
    DEMO: ["演示市场", "Demo market"],
  };
  const value = names[normalized];
  return value ? value[locale === "zh-CN" ? 0 : 1] : normalized || code;
}

export function languageName(language: string, locale: UiLocale) {
  const names: Record<string, [string, string]> = {
    "zh-CN": ["中文", "Chinese"],
    en: ["英文", "English"],
    mixed: ["中英混合", "Mixed"],
    und: ["未识别", "Unknown"],
  };
  const value = names[language];
  return value ? value[locale === "zh-CN" ? 0 : 1] : language;
}

export function verdictName(verdict: Verdict, locale: UiLocale) {
  const names: Record<Verdict, [string, string]> = {
    BUILD_NOW: ["现在开发", "Build now"],
    VALIDATE_FIRST: ["先验证", "Validate first"],
    WATCH: ["继续观察", "Watch"],
    SKIP: ["暂不开发", "Skip"],
  };
  return names[verdict][locale === "zh-CN" ? 0 : 1];
}

export function workflowStatusName(status: WorkflowStatus, locale: UiLocale) {
  const names: Record<WorkflowStatus, [string, string]> = {
    UNDECIDED: ["待决定", "Undecided"],
    VALIDATING: ["验证中", "Validating"],
    APPROVED: ["已批准开发", "Approved"],
    WATCHING: ["观察中", "Watching"],
    REJECTED: ["已放弃", "Rejected"],
  };
  return names[status][locale === "zh-CN" ? 0 : 1];
}

export function sourceName(source: SignalSource, locale: UiLocale) {
  const names: Record<SignalSource, [string, string]> = {
    IDEA: ["手工点子", "Manual idea"],
    REDDIT: ["Reddit", "Reddit"],
    X: ["X / Twitter", "X / Twitter"],
    APP_REVIEW: ["App 评论", "App reviews"],
    APP_STORE: ["App Store", "App Store"],
    SEARCH: ["搜索需求", "Search demand"],
    TREND: ["搜索趋势", "Search trend"],
    FORUM: ["论坛", "Forum"],
    CUSTOMER: ["用户反馈", "Customer feedback"],
    OTHER: ["其他", "Other"],
  };
  return names[source][locale === "zh-CN" ? 0 : 1];
}

export function productStatusName(status: string, locale: UiLocale) {
  const names: Record<string, [string, string]> = {
    BUILDING: ["开发中", "Building"],
    LIVE: ["已上线", "Live"],
    PAUSED: ["暂停", "Paused"],
    ARCHIVED: ["归档", "Archived"],
  };
  const value = names[status];
  return value ? value[locale === "zh-CN" ? 0 : 1] : status;
}

export function formatDate(value: string | null, locale: UiLocale) {
  if (!value) return locale === "zh-CN" ? "尚未调研" : "Not researched";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
