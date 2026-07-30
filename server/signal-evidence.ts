import { createHash, randomUUID } from "node:crypto";
import type { RadarDatabase } from "./db.js";
import { persistEvidence } from "./providers.js";
import type { EvidenceItem, Signal } from "../shared/types.js";

function normalizedContent(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function signalFingerprint(signal: Signal) {
  return createHash("sha256")
    .update(
      [
        signal.sourceType,
        signal.sourceUrl ?? "",
        normalizedContent(signal.title),
        normalizedContent(signal.content),
      ].join("\n"),
    )
    .digest("hex");
}

export function evidenceFromSignal(
  signal: Signal,
  opportunityId: string,
): EvidenceItem {
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(signal.createdAt)) / (24 * 60 * 60 * 1_000)),
  );
  return {
    id: randomUUID(),
    opportunityId,
    category: "COMPLAINT",
    sourceName: `${signal.sourceType} Signal`,
    sourceUrl: signal.sourceUrl,
    metric: "qualified_complaint",
    value: 1,
    unit: "mention",
    direction: "UNKNOWN",
    strength: signal.sourceType === "CUSTOMER" ? 85 : 72,
    summary: `${signal.title}：${signal.content.replace(/\s+/g, " ").slice(0, 240)}`,
    rawExcerpt: signal.content,
    collectedAt: signal.createdAt,
    freshnessDays: ageDays,
    fingerprint: signalFingerprint(signal),
    market: null,
  };
}

export function linkSignalEvidence(
  db: RadarDatabase,
  signal: Signal,
  opportunityId: string,
) {
  const opportunity = db
    .prepare("SELECT id FROM opportunities WHERE id = ?")
    .get(opportunityId) as { id: string } | undefined;
  if (!opportunity) throw new Error("找不到要关联的候选产品");
  if (signal.opportunityId && signal.opportunityId !== opportunityId) {
    throw new Error("这条信号已经关联到另一个候选产品");
  }
  const linkedAt = new Date().toISOString();
  db.transaction(() => {
    persistEvidence(db, [evidenceFromSignal(signal, opportunityId)]);
    db.prepare(
      `UPDATE signals
       SET status = 'PROCESSED', opportunity_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(opportunityId, linkedAt, signal.id);
    db.prepare(
      `UPDATE opportunities
       SET research_status = 'UNRESEARCHED',
           last_researched_at = NULL,
           change_summary = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run("收到新的用户信号，等待结合新证据重新判断。", linkedAt, opportunityId);
  })();
}
