import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  normalizeDiscoveryKey,
  persistDiscoveredSignals,
  persistDiscoveryCandidates,
  refreshChangedLinkedSignalEvidence,
} from "./discovery.js";
import type { DiscoveredSignalInput } from "./discovery-provider.js";

const inputs: DiscoveredSignalInput[] = [
  {
    fingerprint: "search-fingerprint",
    sourceType: "TREND",
    title: "receipt organizer search growth",
    content: "Search demand grew 35% this month.",
    sourceUrl: null,
    tags: ["auto"],
    market: "US/en",
    sourceName: "DataForSEO Labs",
    metrics: { searchVolume: 8_100, monthlyTrend: 35 },
  },
  {
    fingerprint: "complaint-fingerprint",
    sourceType: "REDDIT",
    title: "Receipts are painful to organize",
    content: "I manually rename and file every receipt before tax season.",
    sourceUrl: "https://www.reddit.com/r/example/comments/1",
    tags: ["auto"],
    market: "US/en",
    sourceName: "DataForSEO Google SERP",
    metrics: { discoveryQuery: "manual receipt workflow" },
  },
];

describe("automatic discovery persistence", () => {
  it("deduplicates signals and refreshes a stable opportunity", () => {
    const database = createDatabase(":memory:", false);
    const firstSignals = persistDiscoveredSignals(database, "run-1", inputs);
    expect(firstSignals.inserted).toBe(2);
    expect(firstSignals.reused).toBe(0);

    const candidate = {
      discoveryKey: "Freelancers + receipt organization",
      name: "Receipt Flow",
      oneLiner: "Automatically organize receipts for tax preparation.",
      targetUser: "Freelancers who manually manage receipts",
      recommendedPlatform: "WEB_AND_IOS" as const,
      sourceSignalIds: firstSignals.signals.map((signal) => signal.id),
      confidence: 78,
      whyNow: "Search growth and a concrete manual workflow agree.",
    };
    const firstCandidate = persistDiscoveryCandidates(
      database,
      [candidate],
      firstSignals.signals,
    );
    expect(firstCandidate).toMatchObject({
      created: 1,
      refreshed: 0,
      skipped: 0,
    });

    const secondSignals = persistDiscoveredSignals(database, "run-2", inputs);
    expect(secondSignals.inserted).toBe(0);
    expect(secondSignals.reused).toBe(2);
    const secondCandidate = persistDiscoveryCandidates(
      database,
      [{ ...candidate, sourceSignalIds: secondSignals.signals.map(({ id }) => id) }],
      secondSignals.signals,
    );
    expect(secondCandidate).toMatchObject({
      created: 0,
      refreshed: 1,
      skipped: 0,
    });

    database
      .prepare(
        `UPDATE opportunities
         SET research_status = 'READY', last_researched_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        new Date().toISOString(),
        new Date().toISOString(),
        firstCandidate.opportunityIds[0],
      );
    const updatedSignals = persistDiscoveredSignals(database, "run-3", [
      {
        ...inputs[0],
        content: "Search demand grew 67% this month.",
        metrics: { searchVolume: 12_100, monthlyTrend: 67 },
      },
      inputs[1],
    ]);
    expect(updatedSignals.changedSignalIds).toHaveLength(1);
    expect(
      refreshChangedLinkedSignalEvidence(database, updatedSignals),
    ).toEqual([firstCandidate.opportunityIds[0]]);
    const refreshedOpportunity = database
      .prepare(
        "SELECT research_status, last_researched_at FROM opportunities WHERE id = ?",
      )
      .get(firstCandidate.opportunityIds[0]) as {
      research_status: string;
      last_researched_at: string | null;
    };
    expect(refreshedOpportunity).toEqual({
      research_status: "UNRESEARCHED",
      last_researched_at: null,
    });

    const counts = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM signals) AS signals,
           (SELECT COUNT(*) FROM opportunities) AS opportunities,
           (SELECT COUNT(*) FROM evidence_items) AS evidence`,
      )
      .get() as { signals: number; opportunities: number; evidence: number };
    expect(counts).toEqual({ signals: 2, opportunities: 1, evidence: 3 });
    expect(normalizeDiscoveryKey(candidate.discoveryKey)).toBe(
      "freelancers-receipt-organization",
    );
    database.close();
  });

  it("rejects AI candidates that do not cite two valid signals", () => {
    const database = createDatabase(":memory:", false);
    const persisted = persistDiscoveredSignals(database, "run-1", inputs);
    const saved = persistDiscoveryCandidates(
      database,
      [
        {
          discoveryKey: "unsupported",
          name: "Unsupported",
          oneLiner: "This candidate has only one valid signal.",
          targetUser: "Independent developers",
          recommendedPlatform: "WEB",
          sourceSignalIds: [persisted.signals[0].id, crypto.randomUUID()],
          confidence: 90,
          whyNow: "Not enough evidence.",
        },
      ],
      persisted.signals,
    );
    expect(saved).toMatchObject({ created: 0, refreshed: 0, skipped: 1 });
    database.close();
  });
});
