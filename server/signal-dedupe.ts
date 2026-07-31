import type Database from "better-sqlite3";

interface SignalIdentityInput {
  sourceType: string;
  title: string;
  market?: string | null;
  metrics?: Record<string, unknown>;
}

interface SignalRow {
  id: string;
  source_type: string;
  title: string;
  source_url: string | null;
  tags_json: string;
  status: string;
  opportunity_id: string | null;
  fingerprint: string | null;
  market: string | null;
  source_name: string | null;
  metrics_json: string;
  duplicate_count: number;
  created_at: string;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseTags(value: string) {
  try {
    return stringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizedIdentityText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .slice(0, 240);
}

export function automaticSignalCanonicalKey(input: SignalIdentityInput) {
  const appId =
    input.sourceType === "APP_STORE" &&
    typeof input.metrics?.appId === "string"
      ? normalizedIdentityText(input.metrics.appId)
      : "";
  if (appId) return `app:${appId}`;
  const title = normalizedIdentityText(input.title);
  if (!title) return null;
  const market = normalizedIdentityText(input.market ?? "unknown");
  return `text:${market}:${title}`;
}

function mergedMetadata(rows: SignalRow[]) {
  const tags = new Set<string>();
  const fingerprints = new Set<string>();
  const sourceNames = new Set<string>();
  const markets = new Set<string>();
  const sourceUrls = new Set<string>();
  let metrics: Record<string, unknown> = {};

  for (const row of rows) {
    parseTags(row.tags_json).forEach((tag) => tags.add(tag));
    const current = parseObject(row.metrics_json);
    metrics = { ...metrics, ...current };
    stringArray(current._dedupeFingerprints).forEach((value) =>
      fingerprints.add(value),
    );
    stringArray(current.sourceNames).forEach((value) =>
      sourceNames.add(value),
    );
    stringArray(current.markets).forEach((value) => markets.add(value));
    stringArray(current.sourceUrls).forEach((value) => sourceUrls.add(value));
    if (row.fingerprint) fingerprints.add(row.fingerprint);
    if (row.source_name) sourceNames.add(row.source_name);
    if (row.market) markets.add(row.market);
    if (row.source_url) sourceUrls.add(row.source_url);
  }

  return {
    tagsJson: JSON.stringify([...tags]),
    metricsJson: JSON.stringify({
      ...metrics,
      _dedupeFingerprints: [...fingerprints],
      sourceNames: [...sourceNames],
      markets: [...markets],
      sourceUrls: [...sourceUrls],
    }),
    sourceUrl: rows.find((row) => row.source_url)?.source_url ?? null,
    sourceName: rows.find((row) => row.source_name)?.source_name ?? null,
    market: rows.find((row) => row.market)?.market ?? null,
  };
}

export function consolidateAutomaticSignalDuplicates(
  db: Database.Database,
) {
  const rows = db
    .prepare(
      `SELECT id, source_type, title, source_url, tags_json, status,
              opportunity_id, fingerprint, market, source_name, metrics_json,
              duplicate_count, created_at
       FROM signals
       WHERE auto_collected = 1
       ORDER BY created_at ASC`,
    )
    .all() as SignalRow[];
  const groups = new Map<string, SignalRow[]>();
  for (const row of rows) {
    const metrics = parseObject(row.metrics_json);
    const key = automaticSignalCanonicalKey({
      sourceType: row.source_type,
      title: row.title,
      market: row.market,
      metrics,
    });
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let removed = 0;
  for (const [canonicalKey, group] of groups) {
    const linkedOpportunityIds = new Set(
      group
        .map((row) => row.opportunity_id)
        .filter((value): value is string => Boolean(value)),
    );
    if (linkedOpportunityIds.size > 1) continue;
    const ordered = [...group].sort((left, right) => {
      const leftRank =
        (left.opportunity_id ? 2 : 0) + (left.status === "PROCESSED" ? 1 : 0);
      const rightRank =
        (right.opportunity_id ? 2 : 0) + (right.status === "PROCESSED" ? 1 : 0);
      return rightRank - leftRank || left.created_at.localeCompare(right.created_at);
    });
    const survivor = ordered[0];
    const duplicateCount = group.reduce(
      (sum, row) => sum + Math.max(1, Number(row.duplicate_count ?? 1)),
      0,
    );
    const merged = mergedMetadata(group);
    db.prepare(
      `UPDATE signals
       SET canonical_key = ?,
           duplicate_count = ?,
           tags_json = ?,
           metrics_json = ?,
           source_url = COALESCE(source_url, ?),
           source_name = COALESCE(source_name, ?),
           market = COALESCE(market, ?)
       WHERE id = ?`,
    ).run(
      canonicalKey,
      duplicateCount,
      merged.tagsJson,
      merged.metricsJson,
      merged.sourceUrl,
      merged.sourceName,
      merged.market,
      survivor.id,
    );
    for (const duplicate of ordered.slice(1)) {
      db.prepare("DELETE FROM signals WHERE id = ?").run(duplicate.id);
      removed += 1;
    }
  }
  return { removed, remaining: rows.length - removed };
}
