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
  return {
    name: localized?.name || opportunity.name,
    oneLiner: localized?.oneLiner || opportunity.oneLiner,
    targetUser: localized?.targetUser || opportunity.targetUser,
    changeSummary: localized?.changeSummary || opportunity.changeSummary,
  };
}
