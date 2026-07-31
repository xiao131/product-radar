import {
  Activity,
  Archive,
  CircleCheck,
  CircleX,
  DatabaseZap,
  Radar,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { OperationsStatus } from "../../shared/types";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components";
import { shortDate } from "../format";
import {
  jobErrorLabel,
  jobStatusLabel,
  jobTriggerLabel,
  jobTypeLabel,
} from "../job-format";

export function OperationsPage() {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<
    "discovery" | "research" | "backup" | ""
  >("");
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

  async function run(kind: "discovery" | "research" | "backup") {
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
    ["自动发现", status.scheduler.discoveryEnabled],
    ["AI 判断", status.sources.ai],
    ["搜索需求", status.sources.search],
    ["网页竞品", status.sources.webCompetitors],
    ["Apple 市场", status.sources.appleMarket],
  ] as const;

  return (
    <div className="operations-page">
      <section className="operations-command">
        <div>
          <span className="eyebrow">生产控制</span>
          <h2>系统是否足以支持今天的判断？</h2>
          <p>
            {status.mode === "REAL" ? "真实模式" : "演示模式"} ·{" "}
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
            className="button button--secondary"
            disabled={Boolean(action) || !status.scheduler.discoveryEnabled}
            onClick={() => run("discovery")}
          >
            <Radar size={16} />
            {action === "discovery" ? "发现中…" : "立即发现候选"}
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
          <Radar size={18} />
          <span>
            最近自动发现 ·{" "}
            {status.discovery.latestAt
              ? shortDate(status.discovery.latestAt)
              : "尚无"}
            {status.discovery.latestStatus
              ? ` · ${jobStatusLabel(status.discovery.latestStatus)}`
              : ""}
          </span>
          <strong>
            {status.discovery.collectedSignals} 信号 · +
            {status.discovery.createdCandidates}/
            {status.discovery.refreshedCandidates} 更新
            {status.discovery.collectionReused ? " · 复用采集" : ""}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            今日自动发现 · 付费采集最多一次
          </span>
          <strong>
            ${status.usage.dataForSeo.discoveryCostUsd.toFixed(3)}/$
            {status.usage.dataForSeo.discoveryCostLimitUsd.toFixed(2)}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            DataForSEO · 今日计费提交 {status.usage.dataForSeo.billedRequests} 次
          </span>
          <strong>
            子任务 {status.usage.dataForSeo.used}/
            {status.usage.dataForSeo.limit}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            DataForSEO 费用 · 今日 $
            {status.usage.dataForSeo.reportedCostUsd.toFixed(3)}/$
            {status.usage.dataForSeo.dailyCostLimitUsd.toFixed(2)}
          </span>
          <strong>
            本月 ${status.usage.dataForSeo.monthlyCostUsd.toFixed(2)}/$
            {status.usage.dataForSeo.monthlyCostLimitUsd.toFixed(2)}
          </strong>
        </div>
        <div>
          <Activity size={18} />
          <span>待完整调研</span>
          <strong>{status.freshness.due}</strong>
        </div>
      </section>

      <div className="operations-grid">
        <section className="panel source-matrix">
          <header className="panel__header">
            <div>
              <span className="eyebrow">数据来源</span>
              <h2>数据源</h2>
            </div>
          </header>
          {sourceRows.map(([label, connected]) => (
            <div key={label} className="source-row">
              {connected ? <CircleCheck size={17} /> : <CircleX size={17} />}
              <span>{label}</span>
              <strong>{connected ? "正常" : "关闭"}</strong>
            </div>
          ))}
        </section>

        <section className="panel job-history">
          <header className="panel__header">
            <div>
              <span className="eyebrow">任务记录</span>
              <h2>最近任务</h2>
            </div>
          </header>
          {status.jobs.length ? (
            status.jobs.map((job) => (
              <div className="job-row" key={job.id}>
                <i className={`job-dot job-dot--${job.status.toLowerCase()}`} />
                <div>
                  <strong>{jobTypeLabel(job.type)}</strong>
                  <span>
                    {jobTriggerLabel(job.trigger)} · {shortDate(job.startedAt)}
                  </span>
                  {job.error && (
                    <small title={job.error}>{jobErrorLabel(job.error)}</small>
                  )}
                </div>
                <b>{jobStatusLabel(job.status)}</b>
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
