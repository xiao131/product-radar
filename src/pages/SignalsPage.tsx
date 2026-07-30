import { ArrowRight, FileUp, Inbox, Plus } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { Opportunity, Signal } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal } from "../components";
import { SignalForm } from "../forms";
import { shortDate, sourceLabels } from "../format";
import { useNavigate } from "../router";

export function SignalsPage() {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function load() {
    setError("");
    api<Signal[]>("/api/signals")
      .then(setSignals)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取失败"));
  }

  useEffect(load, []);

  async function processSignal(signal: Signal) {
    setProcessing(signal.id);
    setActionError("");
    try {
      const opportunity = await api<Opportunity>(`/api/signals/${signal.id}/process`, {
        method: "POST",
      });
      navigate(`/radar/${opportunity.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "处理失败");
      setProcessing("");
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setActionError("");
    try {
      const csv = await file.text();
      await api<{ imported: number }>("/api/signals/import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!signals) return <LoadingState label="正在读取信号收件箱" />;

  return (
    <div>
      <section className="signal-actions">
        <div>
          <span className="eyebrow">RAW INPUT → OPPORTUNITY</span>
          <h2>所有灵感先进入收件箱</h2>
          <p>先保留原始上下文，再决定是否转成候选；一条信号不是结论。</p>
        </div>
        <div>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            onChange={importCsv}
          />
          <button
            className="button button--secondary"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
          >
            <FileUp size={16} /> {importing ? "导入中…" : "导入 CSV"}
          </button>
          <button className="button button--primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> 添加信号
          </button>
        </div>
      </section>
      <p className="csv-hint">
        CSV 支持列：<code>title, content, source_type, source_url, tags</code>，tags 用分号分隔。
      </p>
      {actionError && <div className="form-error standalone-error">{actionError}</div>}

      {signals.length ? (
        <section className="signal-list">
          {signals.map((signal) => (
            <article className="signal-card" key={signal.id}>
              <div className="signal-card__source">
                <Inbox size={17} />
                <span>{sourceLabels[signal.sourceType]}</span>
                <small>{shortDate(signal.createdAt)}</small>
              </div>
              <div className="signal-card__body">
                <div>
                  <strong>{signal.title}</strong>
                  <span className={`signal-status signal-status--${signal.status.toLowerCase()}`}>
                    {signal.status === "NEW" ? "待处理" : signal.status === "PROCESSED" ? "已转候选" : "已归档"}
                  </span>
                </div>
                <p>{signal.content}</p>
                {signal.tags.length > 0 && (
                  <div className="tag-list">
                    {signal.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
              </div>
              <div className="signal-card__action">
                {signal.opportunityId ? (
                  <button className="button button--secondary button--small" onClick={() => navigate(`/radar/${signal.opportunityId}`)}>
                    查看候选 <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    className="button button--ink button--small"
                    disabled={processing === signal.id}
                    onClick={() => processSignal(signal)}
                  >
                    {processing === signal.id ? "处理中…" : "转为候选"} <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="还没有原始信号"
          description="先录入一个产品点子，或者粘贴一条真实用户抱怨。"
          action={<button className="button button--primary" onClick={() => setModalOpen(true)}>添加第一条信号</button>}
        />
      )}

      <Modal
        title="捕捉一条新信号"
        subtitle="它可以是点子，也可以是一段来自评论区的原始抱怨。"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <SignalForm
          onCancel={() => setModalOpen(false)}
          onSaved={(signal) => {
            setSignals((current) => [signal, ...(current ?? [])]);
            setModalOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
