import { describe, expect, it } from "vitest";
import type { Opportunity } from "./types.js";
import {
  detectContentLanguage,
  languageFromMarket,
  localizedOpportunity,
  marketCode,
} from "./localization.js";

describe("content localization", () => {
  it("detects the original language and lets explicit market metadata win", () => {
    expect(detectContentLanguage("纯中文需求")).toBe("zh-CN");
    expect(detectContentLanguage("English demand")).toBe("en");
    expect(detectContentLanguage("中文 with English")).toBe("mixed");
    expect(languageFromMarket("US/en", "中文标题")).toBe("en");
    expect(marketCode("cn/zh-CN")).toBe("CN");
  });

  it("uses localized candidate copy without changing the canonical record", () => {
    const opportunity = {
      name: "Canonical name",
      oneLiner: "Canonical opportunity",
      targetUser: "Canonical user",
      changeSummary: "Canonical change",
      localizedContent: {
        "zh-CN": {
          name: "中文名称",
          oneLiner: "中文机会",
          targetUser: "中文用户",
          changeSummary: "中文变化",
        },
        en: {
          name: "English name",
          oneLiner: "English opportunity",
          targetUser: "English user",
          changeSummary: "English change",
        },
      },
    } as Opportunity;

    expect(localizedOpportunity(opportunity, "zh-CN").name).toBe("中文名称");
    expect(localizedOpportunity(opportunity, "en").oneLiner).toBe(
      "English opportunity",
    );
    expect(opportunity.name).toBe("Canonical name");
  });
});
