import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Pencil,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  DimensionScore,
  OpportunityDetail,
  OpportunityResearchResponse,
} from "../../shared/types";
import { api, dataForSeoBudgetConfirmation } from "../api";
import {
  Delta,
  ErrorState,
  LoadingState,
  Modal,
  PlatformBadge,
  ResearchStatusBadge,
  Score,
  VerdictBadge,
} from "../components";
import { OpportunityForm } from "../forms";
import { shortDate } from "../format";
import { useNavigate, usePath, useSearch } from "../router";
import { useJobPolling } from "../use-job";

const categoryLabels = {
  SEARCH: "搜索需求",
  TREND: "趋势变化",
  COMPLAINT: "用户抱怨",
  COMPETITOR: "竞争格局",
  APP_STORE: "App Store",
  COMMERCIAL: "商业意图",
  BUILD: "实现成本",
} as const;

function DimensionGrid({ dimensions }: { dimensions: DimensionScore[] }) {
  return (
    <div className="dimension-grid">
      {dimensions.map((item) => (
        <div className="dimension" key={item.key}>
          <div className="dimension__top">
            <span>{item.label}</span>
            <strong>{item.score}</strong>
          </div>
          <div className="dimension__track">
            <i style={{ width: `${item.score}%` }} />
          </div>
          <small>{Math.round(item.weight * 100)}% 权重</small>
          <p>{item.explanation}</p>
        </div>
      ))}
    </div>
  );
}

export function OpportunityDetailPage() {
  const id = usePath().split("/")[2];
  const navigate = useNavigate();
  const search = useSearch();
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [error, setError] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [researchMessage, setResearchMessage] = useState("");
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [editing, setEditing] = useState(false);
  const { job: researchJob, error: researchJobError } = useJobPolling(researchJobId);

  const load = useCallback((signal?: AbortSignal) => {
    if (!id) return;
    setError("");
    api<OpportunityDetail>(`/api/opportunities/${id}?limit=${limit}`, { signal })
      .then(setDetail)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "读取失败");
      });
  }, [id, limit]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (researchJob?.status === "COMPLETED") {
      setResearchMessage("当前候选调研已完成，结论和证据已经更新。");
      setResearchError("");
      load();
    } else if (researchJob?.status === "PARTIAL") {
      setResearchMessage("调研任务已结束，成功结果已经保存。");
      setResearchError(researchJob.error || "任务包含失败结果");
      load();
    } else if (researchJob?.status === "FAILED") {
      setResearchError(researchJob.error || "当前候选调研失败");
    }
  }, [load, researchJob]);

  useEffect(() => {
    if (researchJobError) setResearchError(researchJobError);
  }, [researchJobError]);

  async function submitResearch(
    force: boolean,
    confirmTaskBudgetOverride = false,
  ) {
    if (!id) return;
    try {
      const result = await api<OpportunityResearchResponse>(
        `/api/opportunities/${id}/research`,
        {
          method: "POST",
          body: JSON.stringify({ force, confirmTaskBudgetOverride }),
        },
      );
      if ("queued" in result) {
        setResearchJobId(result.jobId);
        setResearchMessage(
          "只针对当前候选的调研任务已启动，页面会持续跟踪到完成。",
        );
        return;
      }
      setResearchMessage(
        result.cached
          ? `最近 ${result.freshnessDays} 天内已有结果，本次直接使用缓存，没有调用付费数据。`
          : "已采集新数据并生成最新判断。",
      );
      load();
    } catch (caught) {
      const budget = dataForSeoBudgetConfirmation(caught);
      if (budget) {
        if (confirmTaskBudgetOverride) {
          setResearchError(
            "预算状态在确认后发生变化，本次没有继续调用，请重新点击调研。",
          );
          return;
        }
        const confirmed = window.confirm(
          `本次调研预计新增 ${budget.estimatedAdditionalTasks} 个 DataForSEO 计费子任务，约 $${budget.estimatedAdditionalCostUsd.toFixed(3)}。\n\n` +
            `今日已用 ${budget.usedTasks}/${budget.taskLimit} 个子任务，已记录 $${budget.currentCostUsd.toFixed(3)}/$${budget.dailyCostLimitUsd.toFixed(2)}。\n` +
            `继续后预计为 ${budget.projectedTasks} 个子任务、$${budget.projectedCostUsd.toFixed(3)}。\n\n` +
            "是否仅对本次调研继续？美元日/月硬上限仍然有效。",
        );
        if (confirmed) {
          await submitResearch(force, true);
        } else {
          setResearchMessage("已取消本次调研，没有调用付费数据。");
        }
        return;
      }
      setResearchError(caught instanceof Error ? caught.message : "调研失败");
    }
  }

  async function research(force = false) {
    if (!id) return;
    if (
      force &&
      !window.confirm("强制刷新会忽略该候选的数据缓存，在后台重新购买外部数据并调用 AI，确定继续吗？")
    ) {
      return;
    }
    setResearching(true);
    setResearchError("");
    setResearchMessage("");
    try {
      await submitResearch(force);
    } finally {
      setResearching(false);
    }
  }

  if (error) return <ErrorState message={error} retry={() => load()} />;
  if (!detail) return <LoadingState label="正在读取完整调研档案" />;

  const { opportunity, evidence, reportEvidence, reports, signals, totals } = detail;
  const report = reports[0];
  const evidenceById = new Map(reportEvidence.map((item) => [item.id, item]));
  const from = new URLSearchParams(search).get("from");
  const radarReturn = from?.startsWith("?") ? `/radar${from}` : "/radar";
  const researchBusy = researching || researchJob?.status === "RUNNING";
  const canLoadMore =
    limit < 100 &&
    (evidence.length < totals.evidence ||
      reports.length < totals.reports ||
      signals.length < totals.signals);

  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate(radarReturn)}>
        <ArrowLeft size={15} /> 返回雷达库
      </button>

      <section className="detail-head">
        <div className="detail-head__title">
          <div className="detail-head__badges">
            {opportunity.decisionCurrent ? (
              <VerdictBadge verdict={opportunity.verdict} />
            ) : (
              <ResearchStatusBadge status={opportunity.researchStatus} />
            )}
            <PlatformBadge platform={opportunity.recommendedPlatform} />
            <span className="source-chip">{opportunity.sourceType}</span>
          </div>
          <h2>{opportunity.name}</h2>
          <p>{opportunity.oneLiner}</p>
          <span className="detail-target">目标用户：{opportunity.targetUser}</span>
          <button className="text-button detail-edit" onClick={() => setEditing(true)}>
            <Pencil size={14} /> 编辑候选定义
          </button>
        </div>
        <div className="detail-head__score">
          {opportunity.decisionCurrent ? (
            <Score value={opportunity.score} size="large" />
          ) : (
            <div className="pending-decision-score">
              <strong>—</strong>
              <span>等待形成当前评分</span>
            </div>
          )}
          {opportunity.decisionCurrent ? (
            <div>
              <Delta value={opportunity.scoreDelta} />
              <span>{opportunity.confidence}% 置信度</span>
            </div>
          ) : null}
        </div>
      </section>

      {!opportunity.decisionCurrent && report && (
        <div className="stale-decision" role="status">
          <CircleAlert size={18} />
          <div>
            <strong>下面是上一次历史判断，不是当前推荐</strong>
            <p>{opportunity.changeSummary}</p>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel judgment">
            <header className="panel__header">
              <div>
                <span className="eyebrow">FINAL JUDGMENT</span>
                <h2>{opportunity.decisionCurrent ? "为什么这样判断" : "上一次如何判断"}</h2>
              </div>
              {report && <span className="version-chip">V{report.version} · {report.providerMode}</span>}
            </header>

            {report ? (
              <>
                <div className={`judgment-callout ${opportunity.decisionCurrent ? "" : "judgment-callout--historic"}`}>
                  <ArrowRight size={19} />
                  <div>
                    <span>{opportunity.decisionCurrent ? "建议下一步" : "当时建议"}</span>
                    <strong>{report.recommendedAction}</strong>
                  </div>
                </div>
                {report.guardrail?.applied && (
                  <div className="guardrail-callout">
                    <ShieldAlert size={18} />
                    <div>
                      <strong>证据充分性保护已介入</strong>
                      <p>{report.guardrail.reasons.join("；")}</p>
                    </div>
                  </div>
                )}
                <div className="argument-grid">
                  <div className="argument argument--for">
                    <h3><CheckCircle2 size={17} /> 支持开发</h3>
                    <ul>
                      {report.supportingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                  <div className="argument argument--against">
                    <h3><ShieldAlert size={17} /> 反对与约束</h3>
                    <ul>
                      {report.opposingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                </div>
                {report.citedClaims && report.citedClaims.length > 0 && (
                  <div className="cited-claims">
                    <span className="eyebrow">TRACEABLE CLAIMS</span>
                    <h3>关键判断与证据引用</h3>
                    {report.citedClaims.map((claim) => (
                      <div key={`${claim.text}-${claim.evidenceIds.join("-")}`}>
                        <p>{claim.text}</p>
                        <span>
                          {claim.evidenceIds
                            .map((id) => evidenceById.get(id))
                            .filter(Boolean)
                            .map((item) => item!.sourceName)
                            .join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <DimensionGrid dimensions={report.dimensionScores} />
              </>
            ) : (
              <div className="unresearched">
                <CircleAlert size={25} />
                <div>
                  <strong>这个候选还没有完成调研</strong>
                  <p>执行调研后会生成九维度评分、正反论证、平台判断和 MVP 建议。</p>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <span className="eyebrow">EVIDENCE LEDGER</span>
                <h2>本次报告实际使用的证据</h2>
              </div>
              <span className="panel-count">{reportEvidence.length} 条证据</span>
            </header>
            {reportEvidence.length ? (
              <div className="evidence-list">
                {reportEvidence.map((item) => (
                  <article className="evidence" key={item.id}>
                    <div className="evidence__kind">
                      <span>{categoryLabels[item.category]}</span>
                      <small>{item.sourceName}</small>
                    </div>
                    <div className="evidence__body">
                      <strong>{item.summary}</strong>
                      {item.rawExcerpt && <blockquote>“{item.rawExcerpt}”</blockquote>}
                      <span>采集于 {shortDate(item.collectedAt)} · 强度 {item.strength}/100</span>
                    </div>
                    <div className="evidence__metric">
                      <strong>
                        {item.value === null ? "定性" : item.value.toLocaleString()}
                      </strong>
                      <span>{item.unit}</span>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开来源">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">首次调研完成后，这里会固定保存该报告实际使用的证据快照。</p>
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <span className="eyebrow">CURRENT EVIDENCE</span>
                <h2>当前证据库</h2>
              </div>
              <span className="panel-count">显示 {evidence.length} / {totals.evidence}</span>
            </header>
            {evidence.length ? (
              <div className="evidence-list evidence-list--current">
                {evidence.map((item) => (
                  <article className="evidence" key={item.id}>
                    <div className="evidence__kind">
                      <span>{categoryLabels[item.category]}</span>
                      <small>{item.sourceName}</small>
                    </div>
                    <div className="evidence__body">
                      <strong>{item.summary}</strong>
                      {item.rawExcerpt && <blockquote>“{item.rawExcerpt}”</blockquote>}
                      <span>采集于 {shortDate(item.collectedAt)} · 强度 {item.strength}/100</span>
                    </div>
                    <div className="evidence__metric">
                      <strong>{item.value === null ? "定性" : item.value.toLocaleString()}</strong>
                      <span>{item.unit}</span>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开来源">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">暂无当前证据。</p>
            )}
          </section>

          {reports.length > 0 && (
            <section className="panel">
              <header className="panel__header">
                <div>
                  <span className="eyebrow">DECISION HISTORY</span>
                  <h2>评分如何变化</h2>
                </div>
                <span className="panel-count">显示 {reports.length} / {totals.reports}</span>
              </header>
              <div className="history-list">
                {reports.map((item) => (
                  <article key={item.id}>
                    <div className="history-version">V{item.version}</div>
                    <div>
                      <div className="history-title">
                        <strong>{item.score} 分</strong>
                        <Delta value={item.scoreDelta} />
                        <VerdictBadge verdict={item.verdict} />
                      </div>
                      <p>{item.changeSummary}</p>
                      <span>
                        {shortDate(item.createdAt)} · {item.providerMode}
                        {item.modelId ? ` · ${item.modelId}` : ""}
                        {item.promptVersion ? ` · ${item.promptVersion}` : ""}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {canLoadMore && (
            <button
              className="button button--secondary history-load-more"
              onClick={() => setLimit((value) => Math.min(100, value + 20))}
            >
              加载更多证据与历史
            </button>
          )}
          {!canLoadMore &&
            limit >= 100 &&
            (totals.evidence > 100 || totals.reports > 100 || totals.signals > 100) && (
              <p className="muted history-limit-note">
                为保持页面流畅，这里最多展示各类最新 100 条记录。
              </p>
            )}
        </div>

        <aside className="detail-aside">
          <section className="action-card">
            <span className="eyebrow">RESEARCH CONTROL</span>
            <h3>{report ? "用新数据重新判断" : "完成首次调研"}</h3>
            <p>
              每次调研都会追加证据和新版本，不会覆盖旧结论。评分可升也可降。
            </p>
            <button
              className="button button--orange button--full"
              onClick={() => research(false)}
              disabled={researchBusy}
            >
              <RefreshCw className={researchBusy ? "spin" : ""} size={16} />
              {researchBusy ? "当前候选调研中…" : report ? "检查并更新" : "开始调研"}
            </button>
            {report && (
              <button
                className="button button--ghost button--full"
                onClick={() => research(true)}
                disabled={researchBusy}
              >
                强制刷新付费数据
              </button>
            )}
            {researchError && <div className="form-error" role="alert">{researchError}</div>}
            {researchMessage && <div className="form-success" role="status">{researchMessage}</div>}
            {researchJobId && (
              <button
                className="text-button"
                onClick={() => navigate(`/operations?job=${researchJobId}`)}
              >
                查看任务 {researchJobId.slice(0, 8)}
              </button>
            )}
            <small>上次完成调研：{shortDate(opportunity.lastResearchedAt)}</small>
          </section>

          {report && (
            <>
              <section className="side-panel">
                <span className="eyebrow">PLATFORM FIT</span>
                <h3>先做哪个平台</h3>
                <div className="platform-score">
                  <div>
                    <span>WEB</span>
                    <strong>{report.platformAnalysis.web.score}</strong>
                    <p>{report.platformAnalysis.web.note}</p>
                  </div>
                  <div>
                    <span>iOS</span>
                    <strong>{report.platformAnalysis.ios.score}</strong>
                    <p>{report.platformAnalysis.ios.note}</p>
                  </div>
                </div>
              </section>

              <section className="side-panel mvp-card">
                <span className="eyebrow">SMALLEST TEST</span>
                <h3>{report.mvp.estimatedDays} 天 MVP</h3>
                <p>{report.mvp.promise}</p>
                <ul>
                  {report.mvp.coreFeatures.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <div>
                  <span>验证门槛</span>
                  <p>{report.mvp.validationTest}</p>
                </div>
              </section>

              <section className="side-panel">
                <span className="eyebrow">OPEN QUESTIONS</span>
                <h3>仍需确认</h3>
                <ul className="question-list">
                  {[...report.unknowns, ...report.risks].slice(0, 6).map((item) => (
                    <li key={item}><CircleAlert size={14} /> {item}</li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {signals.length > 0 && (
            <section className="side-panel">
              <span className="eyebrow">ORIGIN</span>
              <h3>关联信号 · {signals.length}/{totals.signals}</h3>
              {signals.map((signal) => (
                <div className="linked-signal" key={signal.id}>
                  <strong>{signal.title}</strong>
                  <p>{signal.content}</p>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
      <Modal
        title="编辑候选定义"
        subtitle="修改会使当前结论失效，但会完整保留历史报告与上次调研时间。"
        open={editing}
        onClose={() => setEditing(false)}
      >
        <OpportunityForm
          opportunity={opportunity}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setDetail((current) => current ? { ...current, opportunity: saved } : current);
            setResearchMessage("候选定义已保存，旧结论已标记为历史，等待重新调研。");
            setEditing(false);
          }}
        />
      </Modal>
    </div>
  );
}
