import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type RadarDatabase } from "./db.js";
import { mapOpportunity } from "./mappers.js";
import { researchDueOpportunities } from "./research.js";
import { createTestConfig } from "./test-config.js";

describe("research task scope", () => {
  let database: RadarDatabase | undefined;

  afterEach(() => database?.close());

  it("researches only the requested opportunity", async () => {
    database = createDatabase(":memory:", true);
    const candidates = (
      database.prepare("SELECT * FROM opportunities ORDER BY score DESC LIMIT 2").all() as Record<
        string,
        unknown
      >[]
    ).map(mapOpportunity);
    database
      .prepare(
        "UPDATE opportunities SET research_status = 'UNRESEARCHED', updated_at = ? WHERE id IN (?, ?)",
      )
      .run(new Date().toISOString(), candidates[0].id, candidates[1].id);

    const result = await researchDueOpportunities(
      database,
      createTestConfig(),
      "standard",
      { targetOpportunityIds: [candidates[0].id] },
    );

    expect(result.requested).toBe(1);
    expect(result.researched).toBe(1);
    expect(
      database
        .prepare("SELECT research_status FROM opportunities WHERE id = ?")
        .get(candidates[0].id),
    ).toEqual({ research_status: "READY" });
    expect(
      database
        .prepare("SELECT research_status FROM opportunities WHERE id = ?")
        .get(candidates[1].id),
    ).toEqual({ research_status: "UNRESEARCHED" });
  });
});
