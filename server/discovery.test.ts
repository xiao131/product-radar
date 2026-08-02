import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  normalizeDiscoveryKey,
  normalizeDiscoveryConfidence,
  discoveryStructuredRetryLimits,
  discoveryCollectionForToday,
  markSignalsAiReviewed,
  persistDiscoveredSignals,
  persistDiscoveryCandidates,
  refreshChangedLinkedSignalEvidence,
  selectSignalsForAi,
} from "./discovery.js";
import type { Signal } from "../shared/types.js";
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
  it("shrinks an empty structured-output batch without dropping below two signals", () => {
    expect(discoveryStructuredRetryLimits(60)).toEqual([60, 30, 15]);
    expect(discoveryStructuredRetryLimits(3)).toEqual([3, 2]);
    expect(discoveryStructuredRetryLimits(2)).toEqual([2]);
  });

  it("keeps batches small while reserving reviewed context", () => {
    const signal = (index: number, reviewed: boolean): Signal => ({
      id: crypto.randomUUID(),
      sourceType: "SEARCH",
      title: `Signal ${index}`,
      content: `Evidence ${index}`,
      sourceUrl: null,
      tags: [],
      status: "NEW",
      opportunityId: null,
      aiReviewedAt: reviewed ? new Date().toISOString() : null,
      aiReviewCount: reviewed ? 1 : 0,
      createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
      updatedAt: new Date(2026, 0, 1, 0, index).toISOString(),
    });
    const signals = [
      ...Array.from({ length: 20 }, (_, index) => signal(index, false)),
      ...Array.from({ length: 10 }, (_, index) => signal(index + 20, true)),
    ];
    const result = selectSignalsForAi(signals, 20);
    expect(result.selected).toHaveLength(20);
    expect(result.selected.filter((item) => !item.aiReviewedAt)).toHaveLength(16);
    expect(result.selected.filter((item) => item.aiReviewedAt)).toHaveLength(4);
  });

  it("deduplicates signals and refreshes a stable opportunity", () => {
    const database = createDatabase(":memory:", false);
    const firstSignals = persistDiscoveredSignals(database, "run-1", inputs);
    expect(firstSignals.inserted).toBe(2);
    expect(firstSignals.reused).toBe(0);

    const candidate = {
      discoveryKey: "Freelancers + receipt organization",
      existingOpportunityId: null,
      name: "Receipt Flow",
      oneLiner: "Automatically organize receipts for tax preparation.",
      targetUser: "Freelancers who manually manage receipts",
      originalLanguage: "en" as const,
      targetMarkets: ["US"],
      localizedContent: {
        "zh-CN": {
          name: "票据流",
          oneLiner: "自动整理票据用于报税。",
          targetUser: "手工管理票据的自由职业者",
          changeSummary: "搜索增长与具体人工流程相互印证。",
        },
        en: {
          name: "Receipt Flow",
          oneLiner: "Automatically organize receipts for tax preparation.",
          targetUser: "Freelancers who manually manage receipts",
          changeSummary: "Search growth and a concrete manual workflow agree.",
        },
      },
      recommendedPlatform: "WEB_AND_IOS" as const,
      sourceSignalIds: firstSignals.signals.map((signal) => signal.id),
      confidence: 0.78,
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
    expect(
      database
        .prepare("SELECT confidence FROM opportunities WHERE id = ?")
        .get(firstCandidate.opportunityIds[0]),
    ).toEqual({ confidence: 78 });

    markSignalsAiReviewed(
      database,
      firstSignals.signals.map((signal) => signal.id),
      "run-1",
    );
    const reviewed = database
      .prepare(
        `SELECT ai_reviewed_at, ai_review_count, last_ai_run_id
         FROM signals WHERE id = ?`,
      )
      .get(firstSignals.signals[0].id) as {
      ai_reviewed_at: string | null;
      ai_review_count: number;
      last_ai_run_id: string | null;
    };
    expect(reviewed.ai_reviewed_at).toBeTruthy();
    expect(reviewed.ai_review_count).toBe(1);
    expect(reviewed.last_ai_run_id).toBe("run-1");

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
    expect(refreshedOpportunity.research_status).toBe("UNRESEARCHED");
    expect(refreshedOpportunity.last_researched_at).not.toBeNull();

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
    expect(normalizeDiscoveryConfidence(0.82)).toBe(82);
    expect(normalizeDiscoveryConfidence(82)).toBe(82);
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
          existingOpportunityId: null,
          name: "Unsupported",
          oneLiner: "This candidate has only one valid signal.",
          targetUser: "Independent developers",
          originalLanguage: "en",
          targetMarkets: ["US"],
          localizedContent: {
            "zh-CN": {
              name: "证据不足",
              oneLiner: "这个候选只有一条有效信号。",
              targetUser: "独立开发者",
              changeSummary: "证据不足。",
            },
            en: {
              name: "Unsupported",
              oneLiner: "This candidate has only one valid signal.",
              targetUser: "Independent developers",
              changeSummary: "Not enough evidence.",
            },
          },
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

  it("merges repeated automatic evidence by stable identity", () => {
    const database = createDatabase(":memory:", false);
    const persisted = persistDiscoveredSignals(database, "run-dedupe", [
      {
        ...inputs[1],
        fingerprint: "complaint-copy-a",
        sourceName: "DataForSEO Google SERP",
      },
      {
        ...inputs[1],
        fingerprint: "complaint-copy-b",
        sourceName: "DataForSEO Community Search",
        sourceUrl: "https://example.com/a-copy",
      },
    ]);
    expect(persisted).toMatchObject({ inserted: 1, reused: 1 });
    expect(persisted.signals).toHaveLength(1);
    expect(persisted.signals[0]).toMatchObject({
      duplicateCount: 2,
      autoCollected: true,
    });
    expect(persisted.signals[0].metrics?.sourceNames).toEqual([
      "DataForSEO Google SERP",
      "DataForSEO Community Search",
    ]);
    markSignalsAiReviewed(database, [persisted.signals[0].id], "review-run");
    persistDiscoveredSignals(database, "changed-run", [
      {
        ...inputs[1],
        fingerprint: "complaint-copy-a",
        content: "The same workflow now takes eight manual steps.",
      },
    ]);
    expect(
      database
        .prepare(
          `SELECT ai_reviewed_at, ai_review_count, last_ai_run_id
           FROM signals WHERE id = ?`,
        )
        .get(persisted.signals[0].id),
    ).toEqual({
      ai_reviewed_at: null,
      ai_review_count: 0,
      last_ai_run_id: null,
    });
    database.close();
  });

  it("treats an existing paid discovery attempt as reusable collection", () => {
    const database = createDatabase(":memory:", false);
    database
      .prepare(
        `INSERT INTO usage_events (
           id, provider, operation, units, cost_usd, metadata_json, created_at
         ) VALUES (?, 'DATAFORSEO', 'discovery_keyword_ideas', 1, 0.024, '{}', ?)`,
      )
      .run(crypto.randomUUID(), new Date().toISOString());
    expect(discoveryCollectionForToday(database)).toMatchObject({
      collectionCompleted: true,
      collectedSignals: 0,
    });
    database.close();
  });
});
