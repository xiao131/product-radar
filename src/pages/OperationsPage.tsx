import {
  Activity,
  Archive,
  CircleCheck,
  CircleX,
  Clock3,
  DatabaseZap,
  Radar,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { OperationsStatus } from "../../shared/types";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components";
import { formatDate, marketName, useI18n } from "../i18n";
import { useNavigate, useSearch } from "../router";
import {
  jobErrorLabel,
  jobStatusLabel,
  jobTriggerLabel,
  jobTypeLabel,
} from "../job-format";

export function OperationsPage() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<
    "discovery" | "research" | "backup" | ""
  >("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const navigate = useNavigate();
  const highlightedJobId = new URLSearchParams(useSearch()).get("job");

  function load() {
    setError("");
    api<OperationsStatus>("/api/operations/status")
      .then(setStatus)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load")),
      );
  }

  useEffect(() => {
    load();
    const refresh = () => {
      if (!document.hidden) load();
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function run(kind: "discovery" | "research" | "backup") {
    setAction(kind);
    setActionError("");
    setActionMessage("");
    try {
      const queued = await api<{ jobId: string; status: "RUNNING" }>(
        `/api/operations/${kind}`,
        { method: "POST" },
      );
      setActionMessage(t(`任务 ${queued.jobId.slice(0, 8)} 已启动，状态会自动更新。`, `Job ${queued.jobId.slice(0, 8)} started; status will update automatically.`));
      navigate(`/operations?job=${queued.jobId}`, { replace: true, scroll: false });
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("任务启动失败", "Failed to start job"));
    } finally {
      setAction("");
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!status) return <LoadingState label={t("正在读取生产运行状态", "Loading production status")} />;

  const sourceRows = [
    [t("自动发现", "Automatic discovery"), status.scheduler.discoveryEnabled],
    [t("AI 判断", "AI evaluation"), status.sources.ai],
    [t("搜索需求", "Search demand"), status.sources.search],
    [t("网页竞品", "Web competitors"), status.sources.webCompetitors],
    [t("Apple 市场", "Apple market"), status.sources.appleMarket],
  ] as const;
  const scheduleRows = [
    [t("数据备份", "Data backup"), status.scheduler.nextRuns.backup],
    [t("自动发现", "Automatic discovery"), status.scheduler.nextRuns.discovery],
    [t("多维调研", "Research"), status.scheduler.nextRuns.research],
  ] as const;

  return (
    <div className="operations-page">
      <section className="operations-command">
        <div>
          <span className="eyebrow">{t("生产控制", "PRODUCTION CONTROL")}</span>
          <h2>{t("系统是否足以支持今天的判断？", "Can the system support today's decision?")}</h2>
          <p>
            {status.mode === "REAL" ? t("真实模式", "Live mode") : t("演示模式", "Demo mode")} ·{" "}
            {(status.markets.length ? status.markets : [status.market])
              .map(
                (market) =>
                  marketName(market.countryCode, locale),
              )
              .join(" + ")}{" "}
            · {t("自动更新", "automatic updates")} {status.scheduler.enabled ? t("已开启", "enabled") : t("未开启", "disabled")}
          </p>
        </div>
        <div className="operations-actions">
          <button
            className="button button--secondary"
            disabled={Boolean(action)}
            onClick={() => run("backup")}
          >
            <Archive size={16} />
            {action === "backup" ? t("备份中…", "Backing up…") : t("立即备份", "Back up now")}
          </button>
          <button
            className="button button--secondary"
            disabled={Boolean(action) || !status.scheduler.discoveryEnabled}
            onClick={() => run("discovery")}
          >
            <Radar size={16} />
            {action === "discovery" ? t("发现中…", "Discovering…") : t("立即发现候选", "Discover candidates now")}
          </button>
          <button
            className="button button--primary"
            disabled={Boolean(action)}
            onClick={() => run("research")}
          >
            <RefreshCw size={16} />
            {action === "research" ? t("更新中…", "Updating…") : t("更新到期数据", "Update due data")}
          </button>
        </div>
      </section>

      {actionError && <div className="form-error standalone-error" role="alert">{actionError}</div>}
      {actionMessage && <div className="form-success standalone-error" role="status">{actionMessage}</div>}

      <section className="scheduler-strip" aria-label={t("定时任务状态", "Scheduled job status")}>
        <div>
          <Clock3 size={18} />
          <span>
            {t("调度器", "Scheduler")} {status.scheduler.running ? t("正在执行", "running") : t("正常等待", "waiting")}
          </span>
          <strong>
            {status.scheduler.lastTickAt
              ? `${t("最近检查", "Last check")} ${formatDate(status.scheduler.lastTickAt, locale)}`
              : t("等待首次检查", "Awaiting first check")}
          </strong>
          <small>
            {status.scheduler.nextTickAt
              ? `${t("下次检查", "Next check")} ${formatDate(status.scheduler.nextTickAt, locale)}`
              : t("自动更新未启用", "Automatic updates are disabled")}
          </small>
        </div>
        {scheduleRows.map(([label, nextAt]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{nextAt ? formatDate(nextAt, locale) : t("未启用", "Disabled")}</strong>
            <small>{t("下一次计划", "Next scheduled run")}</small>
          </div>
        ))}
      </section>

      <section className="operations-band">
        <div>
          <Radar size={18} />
          <span>
            {t("最近自动发现", "Latest discovery")} ·{" "}
            {status.discovery.latestAt
              ? formatDate(status.discovery.latestAt, locale)
              : t("尚无", "None")}
            {status.discovery.latestStatus
              ? ` · ${jobStatusLabel(status.discovery.latestStatus, locale)}`
              : ""}
          </span>
          <strong>
            {status.discovery.collectedSignals} {t("信号", "signals")} · +
            {status.discovery.createdCandidates}/
            {status.discovery.refreshedCandidates} {t("更新", "updated")}
            {status.discovery.collectionReused ? ` · ${t("复用采集", "reused collection")}` : ""}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            {t("今日自动发现 · 付费采集最多一次", "Today's discovery · at most one paid collection")}
          </span>
          <strong>
            ${status.usage.dataForSeo.discoveryCostUsd.toFixed(3)}/$
            {status.usage.dataForSeo.discoveryCostLimitUsd.toFixed(2)}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            DataForSEO · {t("今日计费提交", "billable submissions today")} {status.usage.dataForSeo.billedRequests}
          </span>
          <strong>
            {t("子任务", "Tasks")} {status.usage.dataForSeo.used}/
            {status.usage.dataForSeo.limit}
          </strong>
        </div>
        <div>
          <DatabaseZap size={18} />
          <span>
            DataForSEO {t("费用 · 今日", "cost · today")} $
            {status.usage.dataForSeo.reportedCostUsd.toFixed(3)}/$
            {status.usage.dataForSeo.dailyCostLimitUsd.toFixed(2)}
          </span>
          <strong>
            {t("本月", "This month")} ${status.usage.dataForSeo.monthlyCostUsd.toFixed(2)}/$
            {status.usage.dataForSeo.monthlyCostLimitUsd.toFixed(2)}
          </strong>
        </div>
        <div>
          <Activity size={18} />
          <span>{t("待更新或补齐", "Updates or localization due")}</span>
          <strong>{status.freshness.due}</strong>
        </div>
      </section>

      <div className="operations-grid">
        <section className="panel source-matrix">
          <header className="panel__header">
            <div>
              <span className="eyebrow">{t("数据来源", "DATA SOURCES")}</span>
              <h2>{t("数据源", "Sources")}</h2>
            </div>
          </header>
          {sourceRows.map(([label, connected]) => (
            <div key={label} className="source-row">
              {connected ? <CircleCheck size={17} /> : <CircleX size={17} />}
              <span>{label}</span>
              <strong>{connected ? t("正常", "Connected") : t("关闭", "Off")}</strong>
            </div>
          ))}
        </section>

        <section className="panel job-history">
          <header className="panel__header">
            <div>
              <span className="eyebrow">{t("任务记录", "JOB HISTORY")}</span>
              <h2>{t("最近任务", "Recent jobs")}</h2>
            </div>
          </header>
          {status.jobs.length ? (
            status.jobs.map((job) => (
              <div
                id={`job-${job.id}`}
                className={`job-row job-row--${job.status.toLowerCase()} ${highlightedJobId === job.id ? "job-row--highlighted" : ""}`}
                key={job.id}
                aria-current={highlightedJobId === job.id ? "true" : undefined}
              >
                <i className={`job-dot job-dot--${job.status.toLowerCase()}`} />
                <div>
                  <strong>{jobTypeLabel(job.type, locale)}</strong>
                  <span>
                    {jobTriggerLabel(job.trigger, locale)} · {formatDate(job.startedAt, locale)}
                  </span>
                  {job.error && (
                    <small title={job.error}>{jobErrorLabel(job.error, locale)}</small>
                  )}
                </div>
                <b>{jobStatusLabel(job.status, locale)}</b>
              </div>
            ))
          ) : (
            <p className="muted-copy">{t("尚未运行生产任务。", "No production jobs have run yet.")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
