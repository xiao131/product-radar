import { ArrowRight, Boxes, Radar, Target } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardData } from "../../shared/types";
import { api } from "../api";
import {
  Delta,
  ErrorState,
  LoadingState,
  OpportunityRow,
  PlatformBadge,
} from "../components";
import {
  opportunityForLocale,
  productStatusName,
  useI18n,
} from "../i18n";
import { useNavigate } from "../router";

export function DashboardPage() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function load() {
    setError("");
    api<DashboardData>("/api/dashboard").then(setData).catch((caught) => {
      setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load"));
    });
  }

  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <LoadingState />;

  const primary = data.topOpportunities[0];
  const primaryCopy = primary ? opportunityForLocale(primary, locale) : null;
  return (
    <div className="dashboard">
      <section className="decision-hero">
        <div className="decision-hero__main">
          <div className="section-kicker">
            <Target size={15} />
            <span>{t("下一步最佳选择", "NEXT BEST BET")}</span>
          </div>
          {primary ? (
            <>
              <div className="decision-scoreline">
                <span className="decision-score">{primary.score}</span>
                <div>
                  <span>{t("综合机会分", "Overall opportunity score")}</span>
                  <Delta value={primary.scoreDelta} />
                </div>
              </div>
              <h2>{primaryCopy?.name}</h2>
              <p className="decision-hero__promise">{primaryCopy?.oneLiner}</p>
              <p className="decision-hero__reason">{primaryCopy?.changeSummary}</p>
              <button
                className="button button--ink"
                onClick={() => navigate(`/radar/${primary.id}`)}
              >
                {t("查看判断依据", "View decision evidence")}
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <h2>{t("尚未形成值得开发的结论", "No build-worthy decision yet")}</h2>
              <p className="decision-hero__promise">
                {t("系统会在后台归并采集到的证据，并由 AI 筛选成候选产品。", "The system groups collected evidence in the background and uses AI to form product candidates.")}
              </p>
              <button
                className="button button--ink"
                onClick={() => navigate("/operations")}
              >
                {t("查看处理进度", "View progress")}
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
        <div className="decision-hero__aside">
          <span className="eyebrow">{t("雷达状态", "RADAR STATUS")}</span>
          <strong>{data.stats.opportunities}</strong>
          <p>{t("个候选正在被持续比较", "candidates under continuous comparison")}</p>
          <div className="hero-stat-grid">
            <div>
              <b>{data.stats.buildNow}</b>
              <span>{t("现在开发", "Build now")}</span>
            </div>
            <div>
              <b>{data.stats.liveProducts}</b>
              <span>{t("已上线产品", "Live products")}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate("/radar?researchStatus=UNRESEARCHED")}
              aria-label={`${t("查看", "View")} ${data.stats.unresearched} ${t("个待调研候选", "unresearched candidates")}`}
            >
              <b>{data.stats.unresearched}</b>
              <span>{t("待调研候选", "Unresearched")}</span>
            </button>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <header className="panel__header">
            <div>
              <span className="eyebrow">{t("优先队列", "PRIORITY QUEUE")}</span>
              <h2>{t("值得投入的候选", "Candidates worth pursuing")}</h2>
            </div>
            <button className="text-button" onClick={() => navigate("/radar")}>
              {t("查看全部", "View all")} <ArrowRight size={14} />
            </button>
          </header>
          <div className="opportunity-stack">
            {data.topOpportunities.map((item) => (
              <OpportunityRow
                key={item.id}
                item={item}
                compact
                onClick={() => navigate(`/radar/${item.id}`)}
              />
            ))}
          </div>
        </section>

        <section className="panel panel--dark">
          <header className="panel__header">
            <div>
              <span className="eyebrow">{t("增长动量", "MOMENTUM")}</span>
              <h2>{t("最近涨分", "Recent score gains")}</h2>
            </div>
            <Radar size={18} />
          </header>
          <div className="riser-list">
            {data.risingOpportunities.slice(0, 4).map((item, index) => (
              <button key={item.id} onClick={() => navigate(`/radar/${item.id}`)}>
                <span className="mono riser-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{opportunityForLocale(item, locale).name}</strong>
                  <span>{opportunityForLocale(item, locale).changeSummary}</span>
                </div>
                <Delta value={item.scoreDelta} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <header className="panel__header">
          <div>
            <span className="eyebrow">{t("产品组合", "PORTFOLIO CONTEXT")}</span>
            <h2>{t("已经上线了什么", "What is already live")}</h2>
          </div>
          <button className="text-button" onClick={() => navigate("/products")}>
            {t("管理产品", "Manage products")} <ArrowRight size={14} />
          </button>
        </header>
        <div className="product-strip">
          {data.products.map((product) => (
            <button key={product.id} onClick={() => navigate("/products")}>
              <Boxes size={17} />
              <div>
                <strong>{product.name}</strong>
                <span>{product.currentFocus || product.description}</span>
              </div>
              <div>
                <PlatformBadge platform={product.platform} />
                <small>{productStatusName(product.status, locale)}</small>
              </div>
            </button>
          ))}
          <button className="product-strip__signal" onClick={() => navigate("/radar")}>
            <Radar size={18} />
            <div>
              <strong>{t("继续比较全部候选产品", "Compare all candidates")}</strong>
              <span>{t("按评分和最新变化决定下一步", "Use scores and recent changes to decide what comes next")}</span>
            </div>
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
