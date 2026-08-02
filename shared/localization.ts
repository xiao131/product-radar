import type {
  ContentLanguage,
  LocalizedOpportunityContent,
  Opportunity,
  UiLocale,
} from "./types.js";

const HAN_PATTERN = /\p{Script=Han}/u;
const LATIN_PATTERN = /[A-Za-z]/;

export function detectContentLanguage(...values: Array<string | null | undefined>): ContentLanguage {
  const text = values.filter(Boolean).join(" ");
  const hasHan = HAN_PATTERN.test(text);
  const hasLatin = LATIN_PATTERN.test(text);
  if (hasHan && hasLatin) return "mixed";
  if (hasHan) return "zh-CN";
  if (hasLatin) return "en";
  return "und";
}

export function languageFromMarket(
  market: string | null | undefined,
  ...fallbackText: Array<string | null | undefined>
): ContentLanguage {
  const language = market?.split("/")[1]?.trim().toLowerCase() ?? "";
  if (language.startsWith("zh")) return "zh-CN";
  if (language.startsWith("en")) return "en";
  return detectContentLanguage(...fallbackText);
}

export function marketCode(value: string | null | undefined) {
  return value?.split("/", 1)[0]?.trim().toUpperCase() ?? "";
}

export function localizedOpportunity(
  opportunity: Opportunity,
  locale: UiLocale,
): LocalizedOpportunityContent {
  const localized = opportunity.localizedContent?.[locale];
  if (!localized) {
    return locale === "zh-CN"
      ? {
          name: "中文内容生成中",
          oneLiner: "该候选的中文展示内容尚未生成，请稍后刷新。",
          targetUser: "待补充中文目标用户",
          changeSummary: "中文更新说明生成中。",
        }
      : {
          name: "English copy pending",
          oneLiner: "The English display copy for this candidate is being generated.",
          targetUser: "English target audience pending",
          changeSummary: "English update summary pending.",
        };
  }
  return {
    name: localized.name,
    oneLiner: localized.oneLiner,
    targetUser: localized.targetUser,
    changeSummary:
      localized.changeSummary ||
      (locale === "zh-CN" ? "暂无中文更新说明。" : "No English update summary yet."),
  };
}
