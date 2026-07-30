import {
  Activity,
  Archive,
  CircleCheck,
  CircleX,
  DatabaseZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { OperationsStatus } from "../../shared/types";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components";
import { shortDate } from "../format";

export function OperationsPage() {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"research" | "backup" | "">("");
  const [actionError, setActionError] = useState("");

  function load() {
    setError("");
    api<OperationsStatus>("/api/operations/status")
      .then(setStatus)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "读取失败"),
      );
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function run(kind: "research" | "backup") {
    setAction(kind);
    setActionError("");
    try {
      await api(`/api/operations/${kind}`, { method: "POST" });
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "任务启动失败");
    } finally {
      setAction("");
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!status) return <LoadingState label="正在读取生产运行状态" />;

  const sourceRows = [
    ["AI Judge", status.sources.ai],
    ["搜索需求", status.sources.search],
    ["Web 竞品", status.sources.webCompetitors],
    ["Apple 市场", status.sources.appleMarket],
  ] as const;

  return (
    <div className="operations-page">
      <section className="operations-command">
        <div>
          <span className="eyebrow">PRODUCTION CONTROL</span>
          <h2>系统是否足以支持今天的判断？</h2>
          <p>
            {status.mode} ·{" "}
            {(status.markets.length ? status.markets : [status.market])
              .map(
                (market) =>
                  `${market.countryCode}/${market.languageCode}`,
              )
              .join(" + ")}{" "}
            · 自动更新
            {status.scheduler.enabled ? "已开启" : "未开启"}
          </p>
        </div>
        <div className="operations-actions">
          <button
            className="button button--secondary"
            disabled={Boolean(action)}
            onClick={() => run("backup")}
          >
            <Archive size={16} />
            {action === "backup" ? "备份中…" : "立即备份"}
          </button>
          <button
            className="button button--primary"
            disabled={Boolean(action)}
            onClick={() => run("research")}
          >
            <RefreshCw size={16} />
            {action === "research" ? "更新中…" : "更新到期数据"}
          </button>
        </div>
      </section>

      {actionError && <div className="form-error standalone-error">{actionError}</div>}

      <section className="operations-band">
        <div>
          <Activity size={18} />
          <span>待更新</span>
          <strong>{status.freshness.due}</strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>今日 DataForSEO</span>
          <strong>{status.usage.dataForSeo.used}/{status.usage.dataForSeo.limit}</strong>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>今日 AI 判断</span>
          <strong>{status.usage.ai.used}/{status.usage.ai.limit}</strong>
        </div>
        <div>
          <Archive size={18} />
          <span>最近备份</span>
          <strong>{status.latestBackup?.finishedAt ? shortDate(status.latestBackup.finishedAt) : "尚无"}</strong>
        </div>
      </section>

      <div className="operations-grid">
        <section className="panel source-matrix">
          <header className="panel__header">
            <div>
              <span className="eyebrow">SOURCE MATRIX</span>
              <h2>数据源</h2>
            </div>
          </header>
          {sourceRows.map(([label, connected]) => (
            <div key={label} className="source-row">
              {connected ? <CircleCheck size={17} /> : <CircleX size={17} />}
              <span>{label}</span>
              <strong>{connected ? "READY" : "OFF"}</strong>
            </div>
          ))}
        </section>

        <section className="panel job-history">
          <header className="panel__header">
            <div>
              <span className="eyebrow">JOB HISTORY</span>
              <h2>最近任务</h2>
            </div>
          </header>
          {status.jobs.length ? (
            status.jobs.map((job) => (
              <div className="job-row" key={job.id}>
                <i className={`job-dot job-dot--${job.status.toLowerCase()}`} />
                <div>
                  <strong>{job.type}</strong>
                  <span>{job.trigger} · {shortDate(job.startedAt)}</span>
                  {job.error && <small>{job.error}</small>}
                </div>
                <b>{job.status}</b>
              </div>
            ))
          ) : (
            <p className="muted-copy">尚未运行生产任务。</p>
          )}
        </section>
      </div>
    </div>
  );
}
