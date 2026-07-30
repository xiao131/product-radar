import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Opportunity, Paginated } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, OpportunityRow } from "../components";
import { useNavigate } from "../router";

const defaultResult: Paginated<Opportunity> = {
  items: [],
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
};

export function RadarPage() {
  const [result, setResult] = useState(defaultResult);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [verdict, setVerdict] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const navigate = useNavigate();

  const url = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "10",
      sortBy,
      sortDirection: sortBy === "name" ? "asc" : "desc",
    });
    if (query.trim()) params.set("query", query.trim());
    if (platform) params.set("platform", platform);
    if (verdict) params.set("verdict", verdict);
    return `/api/opportunities?${params}`;
  }, [page, platform, query, sortBy, verdict]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<Paginated<Opportunity>>(url, { signal: controller.signal })
        .then(setResult)
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "读取失败");
        })
        .finally(() => setLoading(false));
    }, query ? 220 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  function resetFilters() {
    setQuery("");
    setPlatform("");
    setVerdict("");
    setSortBy("score");
    setPage(1);
  }

  return (
    <div className="radar-page">
      <section className="radar-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索候选、用户或问题…"
            aria-label="搜索雷达库"
          />
        </div>
        <div className="filter-group">
          <SlidersHorizontal size={16} />
          <select
            value={platform}
            onChange={(event) => {
              setPlatform(event.target.value);
              setPage(1);
            }}
            aria-label="按平台筛选"
          >
            <option value="">全部平台</option>
            <option value="WEB">Web</option>
            <option value="IOS">iOS</option>
            <option value="WEB_AND_IOS">Web + iOS</option>
          </select>
          <select
            value={verdict}
            onChange={(event) => {
              setVerdict(event.target.value);
              setPage(1);
            }}
            aria-label="按结论筛选"
          >
            <option value="">全部结论</option>
            <option value="BUILD_NOW">现在开发</option>
            <option value="VALIDATE_FIRST">先验证</option>
            <option value="WATCH">继续观察</option>
            <option value="SKIP">暂不开发</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value);
              setPage(1);
            }}
            aria-label="排序方式"
          >
            <option value="score">评分从高到低</option>
            <option value="scoreDelta">最近涨分最多</option>
            <option value="confidence">置信度最高</option>
            <option value="updatedAt">最近更新</option>
            <option value="name">名称 A–Z</option>
          </select>
        </div>
      </section>

      <section className="table-panel">
        <header className="table-panel__header">
          <div>
            <span className="eyebrow">ALL OPPORTUNITIES</span>
            <h2>{result.total} 个候选产品</h2>
          </div>
          <span className="table-hint">单击任意候选查看完整证据</span>
        </header>
        {error ? (
          <ErrorState message={error} />
        ) : loading && !result.items.length ? (
          <LoadingState />
        ) : result.items.length ? (
          <>
            <div className={`table-scroll ${loading ? "table-scroll--loading" : ""}`}>
              <table>
                <thead>
                  <tr>
                    <th>评分</th>
                    <th>机会</th>
                    <th>判断</th>
                    <th>平台</th>
                    <th>变化</th>
                    <th>置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <OpportunityRow
                      key={item.id}
                      item={item}
                      onClick={() => navigate(`/radar/${item.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="pagination">
              <span>
                第 {result.page} / {result.totalPages} 页 · 共 {result.total} 条
              </span>
              <div>
                <button
                  className="icon-button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                  aria-label="上一页"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={page >= result.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  aria-label="下一页"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <EmptyState
            title="没有符合条件的候选"
            description="放宽筛选条件，或者把一条新信号转成候选。"
            action={
              <button className="button button--secondary" onClick={resetFilters}>
                清除筛选
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}
