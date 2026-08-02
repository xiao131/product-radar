import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Opportunity } from "../shared/types.js";
import {
  getContentLocalizationBacklog,
  persistEvidenceLocalizations,
  persistOpportunityLocalizations,
} from "./content-localization.js";
import { createDatabase, type RadarDatabase } from "./db.js";
import { mapEvidence, mapOpportunity } from "./mappers.js";

describe("historical content localization", () => {
  let database: RadarDatabase;

  beforeEach(() => {
    database = createDatabase(":memory:", true);
  });

  afterEach(() => {
    database.close();
  });

  it("finds records that cannot render both interface languages", () => {
    const opportunity = mapOpportunity(
      database.prepare("SELECT * FROM opportunities LIMIT 1").get() as Record<string, unknown>,
    );
    database
      .prepare("UPDATE opportunities SET localized_content_json = ? WHERE id = ?")
      .run(
        JSON.stringify({ en: opportunity.localizedContent.en }),
        opportunity.id,
      );

    const backlog = getContentLocalizationBacklog(database);

    expect(backlog.opportunities.map((item) => item.id)).toContain(opportunity.id);
    expect(backlog.evidence.length).toBeGreaterThan(0);
  });

  it("fills only missing candidate and evidence locales while preserving originals", () => {
    const opportunity = mapOpportunity(
      database.prepare("SELECT * FROM opportunities LIMIT 1").get() as Record<string, unknown>,
    );
    const english = opportunity.localizedContent.en!;
    const missingChinese = {
      ...opportunity,
      localizedContent: { en: english },
    } as Opportunity;
    database
      .prepare("UPDATE opportunities SET localized_content_json = ? WHERE id = ?")
      .run(JSON.stringify(missingChinese.localizedContent), opportunity.id);

    persistOpportunityLocalizations(database, [missingChinese], {
      items: [
        {
          id: opportunity.id,
          "zh-CN": {
            name: "中文候选",
            oneLiner: "自然的中文机会描述",
            targetUser: "中文目标用户",
            changeSummary: "中文变化说明",
          },
          en: {
            name: "Generated English",
            oneLiner: "Generated English description",
            targetUser: "Generated English audience",
            changeSummary: "Generated English update",
          },
        },
      ],
    });

    const savedOpportunity = mapOpportunity(
      database.prepare("SELECT * FROM opportunities WHERE id = ?").get(opportunity.id) as Record<string, unknown>,
    );
    expect(savedOpportunity.localizedContent["zh-CN"]?.name).toBe("中文候选");
    expect(savedOpportunity.localizedContent.en).toEqual(english);

    const evidence = mapEvidence(
      database.prepare("SELECT * FROM evidence_items LIMIT 1").get() as Record<string, unknown>,
    );
    persistEvidenceLocalizations(database, [evidence], {
      items: [
        {
          id: evidence.id,
          "zh-CN": { summary: "中文证据", rawExcerpt: "中文原文" },
          en: { summary: "English evidence", rawExcerpt: "English excerpt" },
        },
      ],
    });
    const savedEvidence = mapEvidence(
      database.prepare("SELECT * FROM evidence_items WHERE id = ?").get(evidence.id) as Record<string, unknown>,
    );
    expect(savedEvidence.translations?.["zh-CN"]?.summary).toBe("中文证据");
    expect(savedEvidence.translations?.en?.summary).toBe("English evidence");
  });

  it("rejects incomplete AI batches before writing anything", () => {
    const opportunities = (
      database.prepare("SELECT * FROM opportunities LIMIT 2").all() as Record<string, unknown>[]
    ).map(mapOpportunity);

    expect(() =>
      persistOpportunityLocalizations(database, opportunities, { items: [] }),
    ).toThrow("AI 回填结果与输入不一致");
  });
});
