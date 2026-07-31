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
import { productStatusLabels } from "../format";
import { useNavigate } from "../router";

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function load() {
    setError("");
    api<DashboardData>("/api/dashboard").then(setData).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "读取失败");
    });
  }

  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <LoadingState />;

  const primary = data.topOpportunities[0];
  return (
    <div className="dashboard">
      <section className="decision-hero">
        <div className="decision-hero__main">
          <div className="section-kicker">
            <Target size={15} />
            <span>NEXT BEST BET</span>
          </div>
          {primary ? (
            <>
              <div className="decision-scoreline">
                <span className="decision-score">{primary.score}</span>
                <div>
                  <span>综合机会分</span>
                  <Delta value={primary.scoreDelta} />
                </div>
              </div>
              <h2>{primary.name}</h2>
              <p className="decision-hero__promise">{primary.oneLiner}</p>
              <p className="decision-hero__reason">{primary.changeSummary}</p>
              <button
                className="button button--ink"
                onClick={() => navigate(`/radar/${primary.id}`)}
              >
                查看判断依据
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <h2>尚未形成值得开发的结论</h2>
              <p className="decision-hero__promise">
                系统会在后台归并采集到的证据，并由 AI 筛选成候选产品。
              </p>
              <button
                className="button button--ink"
                onClick={() => navigate("/operations")}
              >
                查看处理进度
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
        <div className="decision-hero__aside">
          <span className="eyebrow">RADAR STATUS</span>
          <strong>{data.stats.opportunities}</strong>
          <p>个候选正在被持续比较</p>
          <div className="hero-stat-grid">
            <div>
              <b>{data.stats.buildNow}</b>
              <span>现在开发</span>
            </div>
            <div>
              <b>{data.stats.liveProducts}</b>
              <span>已上线产品</span>
            </div>
            <div>
              <b>{data.stats.unresearched}</b>
              <span>待调研候选</span>
            </div>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <header className="panel__header">
            <div>
              <span className="eyebrow">PRIORITY QUEUE</span>
              <h2>值得投入的候选</h2>
            </div>
            <button className="text-button" onClick={() => navigate("/radar")}>
              查看全部 <ArrowRight size={14} />
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
              <span className="eyebrow">MOMENTUM</span>
              <h2>最近涨分</h2>
            </div>
            <Radar size={18} />
          </header>
          <div className="riser-list">
            {data.risingOpportunities.slice(0, 4).map((item, index) => (
              <button key={item.id} onClick={() => navigate(`/radar/${item.id}`)}>
                <span className="mono riser-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.changeSummary}</span>
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
            <span className="eyebrow">PORTFOLIO CONTEXT</span>
            <h2>已经上线了什么</h2>
          </div>
          <button className="text-button" onClick={() => navigate("/products")}>
            管理产品 <ArrowRight size={14} />
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
                <small>{productStatusLabels[product.status]}</small>
              </div>
            </button>
          ))}
          <button className="product-strip__signal" onClick={() => navigate("/radar")}>
            <Radar size={18} />
            <div>
              <strong>继续比较全部候选产品</strong>
              <span>按评分和最新变化决定下一步</span>
            </div>
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
