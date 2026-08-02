import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Pencil,
  PackagePlus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  DimensionScore,
  Opportunity,
  OpportunityDetail,
  OpportunityPromotionResponse,
  OpportunityResearchResponse,
  WorkflowStatus,
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
  WorkflowStatusBadge,
} from "../components";
import { OpportunityForm } from "../forms";
import { workflowStatusLabels } from "../format";
import {
  evidenceForLocale,
  formatDate,
  languageName,
  marketName,
  opportunityForLocale,
  reportForLocale,
  useI18n,
  workflowStatusName,
} from "../i18n";
import { useNavigate, usePath, useSearch } from "../router";
import { useJobPolling } from "../use-job";

function DimensionGrid({ dimensions }: { dimensions: DimensionScore[] }) {
  const { t } = useI18n();
  const labels: Record<DimensionScore["key"], string> = {
    demand: t("需求规模", "Demand"),
    pain: t("痛点强度", "Pain severity"),
    trend: t("增长趋势", "Trend"),
    willingness: t("付费意愿", "Willingness to pay"),
    competitionGap: t("竞争空档", "Competition gap"),
    reachability: t("用户可触达", "Reachability"),
    buildability: t("可构建性", "Buildability"),
    founderFit: t("个人匹配", "Founder fit"),
    freshness: t("证据新鲜度", "Evidence freshness"),
  };
  return (
    <div className="dimension-grid">
      {dimensions.map((item) => (
        <div className="dimension" key={item.key}>
          <div className="dimension__top">
            <span>{labels[item.key]}</span>
            <strong>{item.score}</strong>
          </div>
          <div className="dimension__track">
            <i style={{ width: `${item.score}%` }} />
          </div>
          <small>{Math.round(item.weight * 100)}% {t("权重", "weight")}</small>
          <p>{item.explanation}</p>
        </div>
      ))}
    </div>
  );
}

export function OpportunityDetailPage() {
  const { locale, t } = useI18n();
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
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [originalEvidence, setOriginalEvidence] = useState<Set<string>>(
    () => new Set(),
  );
  const { job: researchJob, error: researchJobError } = useJobPolling(researchJobId);

  const load = useCallback((signal?: AbortSignal) => {
    if (!id) return;
    setError("");
    api<OpportunityDetail>(`/api/opportunities/${id}?limit=${limit}`, { signal })
      .then(setDetail)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load"));
      });
  }, [id, limit]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (researchJob?.status === "COMPLETED") {
      setResearchMessage(t("当前候选调研已完成，结论和证据已经更新。", "Research is complete; the decision and evidence have been updated."));
      setResearchError("");
      load();
    } else if (researchJob?.status === "PARTIAL") {
      setResearchMessage(t("调研任务已结束，成功结果已经保存。", "The research job finished and successful results were saved."));
      setResearchError(researchJob.error || t("任务包含失败结果", "The job contains failures"));
      load();
    } else if (researchJob?.status === "FAILED") {
      setResearchError(researchJob.error || t("当前候选调研失败", "Candidate research failed"));
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
          t("只针对当前候选的调研任务已启动，页面会持续跟踪到完成。", "Research for this candidate has started and the page will track it to completion."),
        );
        return;
      }
      setResearchMessage(
        result.cached
          ? t(
              `最近 ${result.freshnessDays} 天内已有结果，本次直接使用缓存，没有调用付费数据。`,
              `A result from the last ${result.freshnessDays} days was reused; no paid data was requested.`,
            )
          : t("已采集新数据并生成最新判断。", "New data was collected and the latest decision was generated."),
      );
      load();
    } catch (caught) {
      const budget = dataForSeoBudgetConfirmation(caught);
      if (budget) {
        if (confirmTaskBudgetOverride) {
          setResearchError(
            t("预算状态在确认后发生变化，本次没有继续调用，请重新点击调研。", "The budget changed after confirmation. No request was made; start the research again."),
          );
          return;
        }
        const confirmed = window.confirm(
          t(
            `本次调研预计新增 ${budget.estimatedAdditionalTasks} 个 DataForSEO 计费子任务，约 $${budget.estimatedAdditionalCostUsd.toFixed(3)}。\n\n今日已用 ${budget.usedTasks}/${budget.taskLimit} 个子任务，已记录 $${budget.currentCostUsd.toFixed(3)}/$${budget.dailyCostLimitUsd.toFixed(2)}。\n继续后预计为 ${budget.projectedTasks} 个子任务、$${budget.projectedCostUsd.toFixed(3)}。\n\n是否仅对本次调研继续？美元日/月硬上限仍然有效。`,
            `This research is expected to add ${budget.estimatedAdditionalTasks} billable DataForSEO tasks, about $${budget.estimatedAdditionalCostUsd.toFixed(3)}.\n\nToday: ${budget.usedTasks}/${budget.taskLimit} tasks and $${budget.currentCostUsd.toFixed(3)}/$${budget.dailyCostLimitUsd.toFixed(2)} recorded.\nContinuing projects ${budget.projectedTasks} tasks and $${budget.projectedCostUsd.toFixed(3)}.\n\nContinue only for this research run? Daily and monthly USD hard limits remain active.`,
          ),
        );
        if (confirmed) {
          await submitResearch(force, true);
        } else {
          setResearchMessage(t("已取消本次调研，没有调用付费数据。", "Research was cancelled; no paid data was requested."));
        }
        return;
      }
      setResearchError(caught instanceof Error ? caught.message : t("调研失败", "Research failed"));
    }
  }

  async function research(force = false) {
    if (!id) return;
    if (
      force &&
      !window.confirm(t("强制刷新会忽略该候选的数据缓存，在后台重新购买外部数据并调用 AI，确定继续吗？", "A forced refresh ignores this candidate's cache, purchases fresh external data, and calls AI. Continue?"))
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

  async function updateWorkflow(
    workflowStatus: WorkflowStatus,
    message?: string,
  ) {
    if (!id) return;
    setWorkflowSaving(true);
    setActionError("");
    setActionMessage("");
    try {
      const opportunity = await api<Opportunity>(
        `/api/opportunities/${id}/workflow`,
        {
          method: "PATCH",
          body: JSON.stringify({ workflowStatus }),
        },
      );
      setDetail((current) => current ? { ...current, opportunity } : current);
      setActionMessage(
        message ??
          t(
            `人工状态已更新为“${workflowStatusName(workflowStatus, locale)}”。`,
            `Human status updated to “${workflowStatusName(workflowStatus, locale)}”.`,
          ),
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("人工状态更新失败", "Failed to update human status"));
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function promoteToProduct() {
    if (!id) return;
    setPromoting(true);
    setActionError("");
    setActionMessage("");
    try {
      const result = await api<OpportunityPromotionResponse>(
        `/api/opportunities/${id}/promote`,
        { method: "POST" },
      );
      setDetail((current) => current ? { ...current, linkedProduct: result.product } : current);
      setActionMessage(
        result.created
          ? t("已转成“我的产品”，并保留与候选调研档案的来源关系。", "The candidate was added to My Products with its research history linked.")
          : t("这个候选已经转成产品，没有重复创建。", "This candidate is already a product; no duplicate was created."),
      );
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("转成产品失败", "Failed to create product"));
    } finally {
      setPromoting(false);
    }
  }

  if (error) return <ErrorState message={error} retry={() => load()} />;
  if (!detail) return <LoadingState label={t("正在读取完整调研档案", "Loading the complete research record")} />;

  const {
    opportunity,
    linkedProduct,
    evidence,
    reportEvidence,
    reports,
    signals,
    totals,
  } = detail;
  const rawReport = reports[0];
  const report = rawReport ? reportForLocale(rawReport, locale) : undefined;
  const opportunityCopy = opportunityForLocale(opportunity, locale);
  const categoryLabels: Record<(typeof evidence)[number]["category"], string> = {
    SEARCH: t("搜索需求", "Search demand"),
    TREND: t("趋势变化", "Trend change"),
    COMPLAINT: t("用户抱怨", "User complaint"),
    COMPETITOR: t("竞争格局", "Competition"),
    APP_STORE: "App Store",
    COMMERCIAL: t("商业意图", "Commercial intent"),
    BUILD: t("实现成本", "Build cost"),
  };
  const evidenceById = new Map(reportEvidence.map((item) => [item.id, item]));
  const from = new URLSearchParams(search).get("from");
  const radarReturn = from?.startsWith("?") ? `/radar${from}` : "/radar";
  const researchBusy = researching || researchJob?.status === "RUNNING";
  const canLoadMore =
    limit < 100 &&
    (evidence.length < totals.evidence ||
      reports.length < totals.reports ||
      signals.length < totals.signals);
  const primaryAction = opportunity.verdict === "BUILD_NOW"
    ? { label: t("转成我的产品", "Turn into my product"), status: "APPROVED" as const }
    : opportunity.verdict === "VALIDATE_FIRST"
      ? { label: t("开始验证", "Start validation"), status: "VALIDATING" as const }
      : opportunity.verdict === "WATCH"
        ? { label: t("加入观察", "Add to watchlist"), status: "WATCHING" as const }
        : { label: t("标记放弃", "Mark as rejected"), status: "REJECTED" as const };
  const workflowBusy = workflowSaving || promoting;
  const stageItems = [
    { label: t("候选", "Candidate"), detail: t("已进入雷达", "Added to radar"), state: "complete" },
    {
      label: t("调研", "Research"),
      detail: report ? `${t("报告", "Report")} V${report.version}` : t("等待首次调研", "Awaiting first research"),
      state: report ? "complete" : "active",
    },
    {
      label: t("AI 决策", "AI decision"),
      detail: opportunity.decisionCurrent ? t("结论有效", "Decision current") : report ? t("等待重评", "Awaiting reassessment") : t("尚未形成", "Not available"),
      state: opportunity.decisionCurrent ? "complete" : report ? "active" : "pending",
    },
    {
      label: t("人工执行", "Human action"),
      detail: workflowStatusName(opportunity.workflowStatus, locale),
      state: opportunity.workflowStatus !== "UNDECIDED"
        ? "complete"
        : opportunity.decisionCurrent ? "active" : "pending",
    },
  ];

  function toggleEvidenceLanguage(evidenceId: string) {
    setOriginalEvidence((current) => {
      const next = new Set(current);
      if (next.has(evidenceId)) next.delete(evidenceId);
      else next.add(evidenceId);
      return next;
    });
  }

  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate(radarReturn)}>
        <ArrowLeft size={15} /> {t("返回雷达库", "Back to radar")}
      </button>

      <ol className="candidate-stages" aria-label={t("候选处理阶段", "Candidate stages")}>
        {stageItems.map((item, index) => (
          <li className={`candidate-stage candidate-stage--${item.state}`} key={item.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          </li>
        ))}
      </ol>

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
            {opportunity.workflowStatus !== "UNDECIDED" && (
              <WorkflowStatusBadge status={opportunity.workflowStatus} />
            )}
          </div>
          <h2>{opportunityCopy.name}</h2>
          {opportunityCopy.name !== opportunity.name && (
            <small className="detail-original-name">{t("原名", "Original")}: {opportunity.name}</small>
          )}
          <p>{opportunityCopy.oneLiner}</p>
          <span className="detail-target">{t("目标用户", "Target user")}：{opportunityCopy.targetUser}</span>
          <div className="detail-market-tags">
            {opportunity.targetMarkets.map((market) => (
              <span key={market}>{marketName(market, locale)}</span>
            ))}
            <span>{t("原始语言", "Original language")}: {languageName(opportunity.originalLanguage, locale)}</span>
          </div>
          <button className="text-button detail-edit" onClick={() => setEditing(true)}>
            <Pencil size={14} /> {t("编辑候选定义", "Edit candidate")}
          </button>
        </div>
        <div className="detail-head__score">
          {opportunity.decisionCurrent ? (
            <Score value={opportunity.score} size="large" />
          ) : (
            <div className="pending-decision-score">
              <strong>—</strong>
              <span>{t("等待形成当前评分", "Awaiting a current score")}</span>
            </div>
          )}
          {opportunity.decisionCurrent ? (
            <div>
              <Delta value={opportunity.scoreDelta} />
              <span>{opportunity.confidence}% {t("置信度", "confidence")}</span>
            </div>
          ) : null}
        </div>
      </section>

      {!opportunity.decisionCurrent && report && (
        <div className="stale-decision" role="status">
          <CircleAlert size={18} />
          <div>
            <strong>{t("下面是上一次历史判断，不是当前推荐", "The content below is historical, not the current recommendation")}</strong>
            <p>{opportunityCopy.changeSummary}</p>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel judgment">
            <header className="panel__header">
              <div>
                <span className="eyebrow">{t("最终判断", "FINAL JUDGMENT")}</span>
                <h2>
                  {report
                    ? opportunity.decisionCurrent ? t("为什么这样判断", "Why this decision") : t("上一次如何判断", "Previous decision")
                    : t("尚未形成判断", "No decision yet")}
                </h2>
              </div>
              {report && <span className="version-chip">V{report.version} · {report.providerMode}</span>}
            </header>

            {report ? (
              <>
                <div className={`judgment-callout ${opportunity.decisionCurrent ? "" : "judgment-callout--historic"}`}>
                  <ArrowRight size={19} />
                  <div>
                    <span>{opportunity.decisionCurrent ? t("建议下一步", "Recommended next step") : t("当时建议", "Previous recommendation")}</span>
                    <strong>{report.recommendedAction}</strong>
                  </div>
                </div>
                {report.guardrail?.applied && (
                  <div className="guardrail-callout">
                    <ShieldAlert size={18} />
                    <div>
                      <strong>{t("证据充分性保护已介入", "Evidence sufficiency guardrail applied")}</strong>
                      <p>{report.guardrail.reasons.join("；")}</p>
                    </div>
                  </div>
                )}
                <div className="argument-grid">
                  <div className="argument argument--for">
                    <h3><CheckCircle2 size={17} /> {t("支持开发", "Reasons to build")}</h3>
                    <ul>
                      {report.supportingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                  <div className="argument argument--against">
                    <h3><ShieldAlert size={17} /> {t("反对与约束", "Constraints and objections")}</h3>
                    <ul>
                      {report.opposingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                </div>
                {report.citedClaims && report.citedClaims.length > 0 && (
                  <div className="cited-claims">
                    <span className="eyebrow">{t("可追溯判断", "TRACEABLE CLAIMS")}</span>
                    <h3>{t("关键判断与证据引用", "Key claims and evidence")}</h3>
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
                  <strong>{t("这个候选还没有完成调研", "This candidate has not been researched yet")}</strong>
                  <p>{t("执行调研后会生成九维度评分、正反论证、平台判断和 MVP 建议。", "Research produces a nine-dimension score, arguments for and against, platform guidance, and an MVP plan.")}</p>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <span className="eyebrow">{t("证据账本", "EVIDENCE LEDGER")}</span>
                <h2>{t("本次报告实际使用的证据", "Evidence used by this report")}</h2>
              </div>
              <span className="panel-count">{reportEvidence.length} {t("条证据", "evidence items")}</span>
            </header>
            {reportEvidence.length ? (
              <div className="evidence-list">
                {reportEvidence.map((item) => {
                  const localized = evidenceForLocale(item, locale);
                  const showOriginal = originalEvidence.has(item.id);
                  const summary = showOriginal ? item.summary : localized.summary;
                  const excerpt = showOriginal ? item.rawExcerpt : localized.rawExcerpt;
                  return (
                  <article className="evidence" key={item.id}>
                    <div className="evidence__kind">
                      <span>{categoryLabels[item.category]}</span>
                      <small>{item.sourceName}</small>
                    </div>
                    <div className="evidence__body">
                      <strong>{summary}</strong>
                      {excerpt && <blockquote>“{excerpt}”</blockquote>}
                      <span>{t("采集于", "Collected")} {formatDate(item.collectedAt, locale)} · {t("强度", "strength")} {item.strength}/100</span>
                      {localized.translated && (
                        <button className="text-button evidence-language-toggle" onClick={() => toggleEvidenceLanguage(item.id)}>
                          {showOriginal ? t("查看译文", "View translation") : t("查看原文", "View original")}
                        </button>
                      )}
                    </div>
                    <div className="evidence__metric">
                      <strong>
                        {item.value === null ? t("定性", "Qualitative") : item.value.toLocaleString(locale)}
                      </strong>
                      <span>{item.unit}</span>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={t("打开来源", "Open source")}>
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">{t("首次调研完成后，这里会固定保存该报告实际使用的证据快照。", "After the first research run, this section preserves the exact evidence snapshot used by the report.")}</p>
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <span className="eyebrow">{t("当前证据", "CURRENT EVIDENCE")}</span>
                <h2>{t("当前证据库", "Current evidence library")}</h2>
              </div>
              <span className="panel-count">{t("显示", "Showing")} {evidence.length} / {totals.evidence}</span>
            </header>
            {evidence.length ? (
              <div className="evidence-list evidence-list--current">
                {evidence.map((item) => {
                  const localized = evidenceForLocale(item, locale);
                  const showOriginal = originalEvidence.has(item.id);
                  const summary = showOriginal ? item.summary : localized.summary;
                  const excerpt = showOriginal ? item.rawExcerpt : localized.rawExcerpt;
                  return (
                  <article className="evidence" key={item.id}>
                    <div className="evidence__kind">
                      <span>{categoryLabels[item.category]}</span>
                      <small>{item.sourceName}</small>
                    </div>
                    <div className="evidence__body">
                      <strong>{summary}</strong>
                      {excerpt && <blockquote>“{excerpt}”</blockquote>}
                      <span>{t("采集于", "Collected")} {formatDate(item.collectedAt, locale)} · {t("强度", "strength")} {item.strength}/100</span>
                      {localized.translated && (
                        <button className="text-button evidence-language-toggle" onClick={() => toggleEvidenceLanguage(item.id)}>
                          {showOriginal ? t("查看译文", "View translation") : t("查看原文", "View original")}
                        </button>
                      )}
                    </div>
                    <div className="evidence__metric">
                      <strong>{item.value === null ? t("定性", "Qualitative") : item.value.toLocaleString(locale)}</strong>
                      <span>{item.unit}</span>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={t("打开来源", "Open source")}>
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">{t("暂无当前证据。", "No current evidence yet.")}</p>
            )}
          </section>

          {reports.length > 0 && (
            <section className="panel">
              <header className="panel__header">
                <div>
                  <span className="eyebrow">{t("判断历史", "DECISION HISTORY")}</span>
                  <h2>{t("评分如何变化", "How the score changed")}</h2>
                </div>
                <span className="panel-count">{t("显示", "Showing")} {reports.length} / {totals.reports}</span>
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
                      <p>{reportForLocale(item, locale).changeSummary}</p>
                      <span>
                        {formatDate(item.createdAt, locale)} · {item.providerMode}
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
              {t("加载更多证据与历史", "Load more evidence and history")}
            </button>
          )}
          {!canLoadMore &&
            limit >= 100 &&
            (totals.evidence > 100 || totals.reports > 100 || totals.signals > 100) && (
              <p className="muted history-limit-note">
                {t("为保持页面流畅，这里最多展示各类最新 100 条记录。", "For performance, this page shows at most the latest 100 records of each type.")}
              </p>
            )}
        </div>

        <aside className="detail-aside">
          {report && (
            <section className="action-card decision-action-card">
              <span className="eyebrow">{t("我的决定", "MY DECISION")}</span>
              <h3>{t("决定下一步怎么做", "Decide what to do next")}</h3>
              <div className="decision-source-row">
                <span>{t("AI 结论", "AI decision")}</span>
                <VerdictBadge verdict={opportunity.verdict} />
              </div>
              <div className="decision-source-row">
                <span>{t("人工状态", "Human status")}</span>
                <WorkflowStatusBadge status={opportunity.workflowStatus} />
              </div>
              <label className="workflow-select">
                <span>{t("手动更新人工状态", "Update human status")}</span>
                <select
                  value={opportunity.workflowStatus}
                  onChange={(event) => void updateWorkflow(event.target.value as WorkflowStatus)}
                  disabled={workflowBusy}
                >
                  {Object.keys(workflowStatusLabels).map((value) => (
                    <option value={value} key={value}>{workflowStatusName(value as WorkflowStatus, locale)}</option>
                  ))}
                </select>
              </label>
              {linkedProduct ? (
                <button
                  className="button button--orange button--full"
                  onClick={() => navigate("/products")}
                >
                  <PackagePlus size={16} /> {t("打开关联产品", "Open linked product")}
                </button>
              ) : opportunity.decisionCurrent ? (
                <button
                  className="button button--orange button--full"
                  onClick={() => {
                    if (primaryAction.status === "APPROVED") {
                      void promoteToProduct();
                    } else {
                      void updateWorkflow(
                        primaryAction.status,
                        t(
                          `已按 AI 建议进入“${workflowStatusName(primaryAction.status, locale)}”。`,
                          `Moved to “${workflowStatusName(primaryAction.status, locale)}” based on the AI recommendation.`,
                        ),
                      );
                    }
                  }}
                  disabled={workflowBusy}
                >
                  {workflowBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                  {promoting ? t("正在转成产品…", "Creating product…") : workflowSaving ? t("正在更新…", "Updating…") : primaryAction.label}
                </button>
              ) : (
                <p className="decision-stale-note">{t("AI 结论已过期，请先重新调研；人工状态仍可单独记录。", "The AI decision is stale. Research again first; human status can still be recorded separately.")}</p>
              )}
              {actionError && <div className="form-error" role="alert">{actionError}</div>}
              {actionMessage && <div className="form-success" role="status">{actionMessage}</div>}
              <small>
                {t("AI 结论不会被手动覆盖；人工状态只记录你的执行决定。", "Human status records your action without overwriting the AI decision.")}
              </small>
            </section>
          )}

          <section className="action-card">
            <span className="eyebrow">{t("调研控制", "RESEARCH CONTROL")}</span>
            <h3>{report ? t("用新数据重新判断", "Reassess with new data") : t("完成首次调研", "Run the first research")}</h3>
            <p>
              {t("每次调研都会追加证据和新版本，不会覆盖旧结论。评分可升也可降。", "Each run adds evidence and a new version without overwriting history. Scores may rise or fall.")}
            </p>
            <button
              className="button button--orange button--full"
              onClick={() => research(false)}
              disabled={researchBusy}
            >
              <RefreshCw className={researchBusy ? "spin" : ""} size={16} />
              {researchBusy ? t("当前候选调研中…", "Researching candidate…") : report ? t("检查并更新", "Check and update") : t("开始调研", "Start research")}
            </button>
            {report && (
              <button
                className="button button--ghost button--full"
                onClick={() => research(true)}
                disabled={researchBusy}
              >
                {t("强制刷新付费数据", "Force refresh paid data")}
              </button>
            )}
            {researchError && <div className="form-error" role="alert">{researchError}</div>}
            {researchMessage && <div className="form-success" role="status">{researchMessage}</div>}
            {researchJobId && (
              <button
                className="text-button"
                onClick={() => navigate(`/operations?job=${researchJobId}`)}
              >
                {t("查看任务", "View job")} {researchJobId.slice(0, 8)}
              </button>
            )}
            <small>{t("上次完成调研", "Last research")}: {formatDate(opportunity.lastResearchedAt, locale)}</small>
          </section>

          {report && (
            <>
              <section className="side-panel">
                <span className="eyebrow">{t("市场判断", "MARKET ASSESSMENTS")}</span>
                <h3>{t("不同市场是否值得做", "Is it worth building in each market?")}</h3>
                <div className="market-assessment-list">
                  {(report.marketAssessments ?? opportunity.marketAssessments).map((assessment) => (
                    <article key={assessment.marketCode}>
                      <div>
                        <strong>{marketName(assessment.marketCode, locale)}</strong>
                        <VerdictBadge verdict={assessment.verdict} />
                      </div>
                      <span>{assessment.score}/100 · {assessment.confidence}% {t("置信度", "confidence")}</span>
                      <p>{assessment.localizedSummary?.[locale] ?? assessment.summary}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="side-panel">
                <span className="eyebrow">{t("平台匹配", "PLATFORM FIT")}</span>
                <h3>{t("先做哪个平台", "Which platform should come first?")}</h3>
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
                <span className="eyebrow">{t("最小测试", "SMALLEST TEST")}</span>
                <h3>{report.mvp.estimatedDays} {t("天 MVP", "day MVP")}</h3>
                <p>{report.mvp.promise}</p>
                <ul>
                  {report.mvp.coreFeatures.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <div>
                  <span>{t("验证门槛", "Validation threshold")}</span>
                  <p>{report.mvp.validationTest}</p>
                </div>
              </section>

              <section className="side-panel">
                <span className="eyebrow">{t("待确认问题", "OPEN QUESTIONS")}</span>
                <h3>{t("仍需确认", "Still unknown")}</h3>
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
              <span className="eyebrow">{t("来源", "ORIGIN")}</span>
              <h3>{t("关联信号", "Linked signals")} · {signals.length}/{totals.signals}</h3>
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
        title={t("编辑候选定义", "Edit candidate definition")}
        subtitle={t("修改会使当前结论失效，但会完整保留历史报告与上次调研时间。", "Changes make the current decision stale while preserving report history and the last research time.")}
        open={editing}
        onClose={() => setEditing(false)}
      >
        <OpportunityForm
          opportunity={opportunity}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setDetail((current) => current ? { ...current, opportunity: saved } : current);
            setResearchMessage(t("候选定义已保存，旧结论已标记为历史，等待重新调研。", "Candidate definition saved. The previous decision is now historical and awaits reassessment."));
            setEditing(false);
          }}
        />
      </Modal>
    </div>
  );
}
