import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DimensionScore,
  OpportunityDetail,
  ResearchReport,
} from "../../shared/types";
import { api } from "../api";
import {
  Delta,
  ErrorState,
  LoadingState,
  PlatformBadge,
  Score,
  VerdictBadge,
} from "../components";
import { shortDate } from "../format";
import { useNavigate, usePath } from "../router";

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
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [error, setError] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");

  function load() {
    if (!id) return;
    setError("");
    api<OpportunityDetail>(`/api/opportunities/${id}`)
      .then(setDetail)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取失败"));
  }

  useEffect(load, [id]);

  async function research() {
    if (!id) return;
    setResearching(true);
    setResearchError("");
    try {
      await api<ResearchReport>(`/api/opportunities/${id}/research`, {
        method: "POST",
      });
      load();
    } catch (caught) {
      setResearchError(caught instanceof Error ? caught.message : "调研失败");
    } finally {
      setResearching(false);
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!detail) return <LoadingState label="正在读取完整调研档案" />;

  const { opportunity, evidence, reports, signals } = detail;
  const report = reports[0];

  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate("/radar")}>
        <ArrowLeft size={15} /> 返回雷达库
      </button>

      <section className="detail-head">
        <div className="detail-head__title">
          <div className="detail-head__badges">
            <VerdictBadge verdict={opportunity.verdict} />
            <PlatformBadge platform={opportunity.recommendedPlatform} />
            <span className="source-chip">{opportunity.sourceType}</span>
          </div>
          <h2>{opportunity.name}</h2>
          <p>{opportunity.oneLiner}</p>
          <span className="detail-target">目标用户：{opportunity.targetUser}</span>
        </div>
        <div className="detail-head__score">
          <Score value={opportunity.score} size="large" />
          <div>
            <Delta value={opportunity.scoreDelta} />
            <span>{opportunity.confidence}% 置信度</span>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel judgment">
            <header className="panel__header">
              <div>
                <span className="eyebrow">FINAL JUDGMENT</span>
                <h2>为什么这样判断</h2>
              </div>
              {report && <span className="version-chip">V{report.version} · {report.providerMode}</span>}
            </header>

            {report ? (
              <>
                <div className="judgment-callout">
                  <ArrowRight size={19} />
                  <div>
                    <span>建议下一步</span>
                    <strong>{report.recommendedAction}</strong>
                  </div>
                </div>
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
                <h2>本次判断用了哪些数据</h2>
              </div>
              <span className="panel-count">{evidence.length} 条证据</span>
            </header>
            {evidence.length ? (
              <div className="evidence-list">
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
              <p className="muted">执行首次调研后，这里会出现带来源的数据。</p>
            )}
          </section>

          {reports.length > 0 && (
            <section className="panel">
              <header className="panel__header">
                <div>
                  <span className="eyebrow">DECISION HISTORY</span>
                  <h2>评分如何变化</h2>
                </div>
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
                      <span>{shortDate(item.createdAt)} · {item.providerMode}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
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
              onClick={research}
              disabled={researching}
            >
              <RefreshCw className={researching ? "spin" : ""} size={16} />
              {researching ? "三阶段判断中…" : report ? "重新采集并评分" : "开始调研"}
            </button>
            {researchError && <div className="form-error">{researchError}</div>}
            <small>最近调研：{shortDate(opportunity.lastResearchedAt)}</small>
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
              <h3>关联信号</h3>
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
    </div>
  );
}
