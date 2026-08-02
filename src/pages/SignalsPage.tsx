import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Inbox,
  Link2,
  Plus,
} from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import type {
  Opportunity,
  OpportunityOption,
  Signal,
  SignalPage,
} from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal } from "../components";
import { SignalForm } from "../forms";
import {
  formatDate,
  languageName,
  marketName,
  sourceName,
  useI18n,
} from "../i18n";
import { useNavigate } from "../router";

function metricValue(value: unknown) {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

function visibleMetricEntries(metrics: Record<string, unknown> | undefined) {
  return Object.entries(metrics ?? {}).filter(
    ([key]) => !key.startsWith("_"),
  );
}

export function SignalsPage() {
  const { locale, t } = useI18n();
  const [signals, setSignals] = useState<SignalPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState("");
  const [importing, setImporting] = useState(false);
  const [linkingSignal, setLinkingSignal] = useState<Signal | null>(null);
  const [opportunityOptions, setOpportunityOptions] = useState<
    OpportunityOption[]
  >([]);
  const [linkTarget, setLinkTarget] = useState("");
  const [linking, setLinking] = useState(false);
  const navigate = useNavigate();

  function load() {
    setError("");
    api<SignalPage>(`/api/signals?page=${page}&pageSize=20`)
      .then(setSignals)
      .catch((caught) => setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load")));
  }

  useEffect(() => {
    load();
    const refresh = () => {
      if (!document.hidden) load();
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [page]);

  async function processSignal(signal: Signal) {
    setProcessing(signal.id);
    setActionError("");
    setActionMessage("");
    try {
      const opportunity = await api<Opportunity>(`/api/signals/${signal.id}/process`, {
        method: "POST",
      });
      navigate(`/radar/${opportunity.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("处理失败", "Processing failed"));
      setProcessing("");
    }
  }

  async function openLinking(signal: Signal) {
    setLinkingSignal(signal);
    setLinkTarget("");
    setActionError("");
    setActionMessage("");
    try {
      const options = await api<OpportunityOption[]>(
        "/api/opportunities/options?limit=100",
      );
      setOpportunityOptions(options);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("候选读取失败", "Failed to load candidates"));
    }
  }

  async function linkToOpportunity() {
    if (!linkingSignal || !linkTarget) return;
    setLinking(true);
    setActionError("");
    try {
      const opportunity = await api<Opportunity>(
        `/api/signals/${linkingSignal.id}/link`,
        {
          method: "POST",
          body: JSON.stringify({ opportunityId: linkTarget }),
        },
      );
      setLinkingSignal(null);
      load();
      navigate(`/radar/${opportunity.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("关联失败", "Linking failed"));
    } finally {
      setLinking(false);
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setActionError("");
    setActionMessage("");
    try {
      const csv = await file.text();
      const result = await api<{ imported: number }>("/api/signals/import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setActionMessage(t(`已导入 ${result.imported} 条证据。`, `Imported ${result.imported} evidence items.`));
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("导入失败", "Import failed"));
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!signals) return <LoadingState label={t("正在读取原始证据", "Loading raw evidence")} />;

  return (
    <div>
      <section className="signal-actions">
        <div>
          <span className="eyebrow">{t("可追溯证据", "AUDITABLE EVIDENCE")}</span>
          <h2>{t("证据由系统归并，不需要逐条处理", "The system groups evidence automatically")}</h2>
          <p>
            {t("自动采集内容会先去重，再由 AI 聚类成候选产品；这里仅用于追溯来源和补充手工线索。", "Automatically collected content is deduplicated before AI groups it into candidates. Use this page for traceability and manual additions.")}
          </p>
        </div>
        <div>
          <label
            className={`button button--secondary file-button ${importing ? "file-button--disabled" : ""}`}
            aria-disabled={importing}
          >
            <input
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={importCsv}
              disabled={importing}
            />
            <FileUp size={16} /> {importing ? t("导入中…", "Importing…") : t("导入 CSV", "Import CSV")}
          </label>
          <button className="button button--primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> {t("添加信号", "Add signal")}
          </button>
        </div>
      </section>
      <p className="csv-hint">
        {t("CSV 支持列", "CSV columns")}: <code>title, content, source_type, source_url, tags</code>{t("，tags 用分号分隔。", "; separate tags with semicolons.")}
      </p>
      <section className="signal-activity" aria-live="polite">
        <span><strong>{signals.total}</strong> {t("条原始证据", "raw evidence items")}</span>
        <span>
          {t("最近一轮采集", "Latest collection")} <strong>{signals.activity.collectedSignals}</strong>：
          {t("新增", "new")} <strong>{signals.activity.insertedSignals}</strong>，
          {t("复用/更新", "reused/updated")} <strong>{signals.activity.reusedSignals}</strong>
        </span>
        <span><strong>{signals.activity.waitingAi}</strong> {t("条等待 AI 筛选", "awaiting AI review")}</span>
        <span>
          {t("最近更新", "Last updated")} {signals.activity.latestUpdatedAt
            ? formatDate(signals.activity.latestUpdatedAt, locale)
            : t("暂无", "None")}
        </span>
        <small>{t("页面每 30 秒自动刷新", "Refreshes every 30 seconds")}</small>
      </section>
      {actionError && <div className="form-error standalone-error" role="alert">{actionError}</div>}
      {actionMessage && <div className="form-success standalone-error" role="status">{actionMessage}</div>}

      {signals.items.length ? (
        <>
          <section className="signal-list">
          {signals.items.map((signal) => (
            <article className="signal-card" key={signal.id}>
              <div className="signal-card__source">
                <Inbox size={17} />
                <span>{sourceName(signal.sourceType, locale)}</span>
                {signal.sourceName && <small>{signal.sourceName}</small>}
                {signal.market && <small>{marketName(signal.market, locale)}</small>}
                {signal.originalLanguage && <small>{languageName(signal.originalLanguage, locale)}</small>}
                {signal.autoCollected && (
                  <small className="signal-auto-badge">AUTO</small>
                )}
                {(signal.duplicateCount ?? 1) > 1 && (
                  <small className="signal-auto-badge">
                    {t("已合并", "Merged")} {signal.duplicateCount} {t("条", "items")}
                  </small>
                )}
                <small>{t("首次采集", "First collected")} {formatDate(signal.createdAt, locale)}</small>
                {signal.updatedAt !== signal.createdAt && (
                  <small>{t("最近更新", "Updated")} {formatDate(signal.updatedAt, locale)}</small>
                )}
              </div>
              <div className="signal-card__body">
                <div>
                  <strong>{signal.title}</strong>
                  <span className={`signal-status signal-status--${signal.status.toLowerCase()}`}>
                    {signal.status === "ARCHIVED"
                      ? t("已归档", "Archived")
                      : signal.opportunityId
                        ? t("已归并候选", "Grouped into candidate")
                        : signal.autoCollected
                          ? signal.aiReviewedAt
                            ? t("AI 已筛选", "AI reviewed")
                            : t("等待 AI 筛选", "Awaiting AI review")
                          : t("待判断", "Awaiting decision")}
                  </span>
                </div>
                <p>{signal.content}</p>
                {visibleMetricEntries(signal.metrics).length > 0 && (
                    <dl className="signal-metrics">
                      {visibleMetricEntries(signal.metrics).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{metricValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                {signal.tags.length > 0 && (
                  <div className="tag-list">
                    {signal.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
              </div>
              <div className="signal-card__action">
                {signal.opportunityId ? (
                  <button className="button button--secondary button--small" onClick={() => navigate(`/radar/${signal.opportunityId}`)}>
                    {t("查看候选", "View candidate")} <ArrowRight size={14} />
                  </button>
                ) : signal.autoCollected ? (
                  <span className="muted-copy">
                    {signal.aiReviewedAt
                      ? t("AI 已筛选，本轮暂未形成候选；数据变化后会继续复核", "AI reviewed this signal but did not form a candidate; it will be checked again when data changes.")
                      : t("尚未归入候选，系统会在后续批次继续筛选", "Not yet grouped into a candidate; later batches will continue reviewing it.")}
                  </span>
                ) : (
                  <div className="signal-card__button-stack">
                    <button
                      className="button button--secondary button--small"
                      onClick={() => openLinking(signal)}
                    >
                      <Link2 size={14} /> {t("加入已有候选", "Add to existing candidate")}
                    </button>
                    <button
                      className="button button--ink button--small"
                      disabled={processing === signal.id}
                      onClick={() => processSignal(signal)}
                    >
                      {processing === signal.id ? t("处理中…", "Processing…") : t("转为新候选", "Create candidate")} <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          </section>
          <footer className="pagination">
            <span>
              {t("第", "Page")} {signals.page} / {signals.totalPages} · {signals.total} {t("条", "items")}
            </span>
            <div>
              <button
                className="icon-button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                aria-label={t("上一页", "Previous page")}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                disabled={page >= signals.totalPages}
                onClick={() => setPage((value) => value + 1)}
                aria-label={t("下一页", "Next page")}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        </>
      ) : (
        <EmptyState
          title={t("还没有原始证据", "No raw evidence yet")}
          description={t("真实模式会按计划自动采集；你也可以补充产品点子或真实用户抱怨。", "Live mode collects on schedule; you can also add product ideas or real user complaints.")}
          action={<button className="button button--primary" onClick={() => setModalOpen(true)}>{t("添加第一条线索", "Add the first signal")}</button>}
        />
      )}

      <Modal
        title={t("捕捉一条新信号", "Capture a new signal")}
        subtitle={t("它可以是点子，也可以是一段来自评论区的原始抱怨。", "It can be an idea or an original complaint from a comment thread.")}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <SignalForm
          onCancel={() => setModalOpen(false)}
          onSaved={(signal) => {
            setPage(1);
            setSignals((current) =>
              current
                ? {
                    ...current,
                    items: [signal, ...current.items].slice(
                      0,
                      current.pageSize,
                    ),
                    total: current.total + 1,
                    totalPages: Math.max(
                      1,
                      Math.ceil((current.total + 1) / current.pageSize),
                    ),
                  }
                : current,
            );
            setModalOpen(false);
            setActionMessage(t("信号已保存，可继续转为新候选或加入已有候选。", "Signal saved. You can create a candidate or add it to an existing one."));
          }}
        />
      </Modal>
      <Modal
        title={t("把信号加入已有候选", "Add signal to an existing candidate")}
        subtitle={linkingSignal ? t(`“${linkingSignal.title}”将成为候选的用户痛点证据，并触发重新调研。`, `“${linkingSignal.title}” will become user-pain evidence and trigger reassessment.`) : ""}
        open={Boolean(linkingSignal)}
        onClose={() => setLinkingSignal(null)}
      >
        <div className="link-signal-form">
          <label>
            {t("选择候选产品", "Choose a candidate")}
            <select
              value={linkTarget}
              onChange={(event) => setLinkTarget(event.target.value)}
            >
              <option value="">{t("请选择…", "Choose…")}</option>
              {opportunityOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.localizedContent?.[locale]?.name ?? option.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => setLinkingSignal(null)}
            >
              {t("取消", "Cancel")}
            </button>
            <button
              className="button button--primary"
              disabled={!linkTarget || linking}
              onClick={linkToOpportunity}
            >
              {linking ? t("关联中…", "Linking…") : t("加入并标记待调研", "Add and mark for research")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
