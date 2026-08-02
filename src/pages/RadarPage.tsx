import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  BatchResearchResult,
  Opportunity,
  Paginated,
  ResearchQueuedResponse,
} from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, OpportunityRow } from "../components";
import { useNavigate, useSearch } from "../router";
import { useJobPolling } from "../use-job";

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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [batchError, setBatchError] = useState("");
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const navigate = useNavigate();
  const search = useSearch();
  const routeParams = useMemo(() => new URLSearchParams(search), [search]);
  const page = Math.max(1, Number(routeParams.get("page") ?? 1) || 1);
  const query = routeParams.get("query") ?? "";
  const platform = routeParams.get("platform") ?? "";
  const verdict = routeParams.get("verdict") ?? "";
  const researchStatus = routeParams.get("researchStatus") ?? "";
  const requestedSort = routeParams.get("sortBy") ?? "score";
  const sortBy = ["score", "scoreDelta", "confidence", "updatedAt", "name"].includes(
    requestedSort,
  )
    ? requestedSort
    : "score";
  const { job: batchJob, error: batchJobError } = useJobPolling(batchJobId);

  function updateRoute(
    updates: Record<string, string | number | null>,
    replace = true,
  ) {
    const next = new URLSearchParams(routeParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "" || (key === "page" && Number(value) === 1)) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    const queryString = next.toString();
    navigate(`/radar${queryString ? `?${queryString}` : ""}`, {
      replace,
      scroll: false,
    });
  }

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
    if (researchStatus) params.set("researchStatus", researchStatus);
    return `/api/opportunities?${params}`;
  }, [page, platform, query, researchStatus, sortBy, verdict]);

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
  }, [refreshVersion, url]);

  useEffect(() => {
    if (batchJob?.status === "COMPLETED") {
      setBatchMessage("后台批量调研已完成，候选列表已更新。");
      setBatchError("");
      setRefreshVersion((value) => value + 1);
    } else if (batchJob?.status === "PARTIAL") {
      setBatchMessage("后台批量调研已完成，但有部分候选失败；成功结果已经更新。");
      setBatchError(batchJob.error || "部分候选调研失败");
      setRefreshVersion((value) => value + 1);
    } else if (batchJob?.status === "FAILED") {
      setBatchError(batchJob.error || "后台批量调研失败");
    }
  }, [batchJob]);

  useEffect(() => {
    if (batchJobError) setBatchError(batchJobError);
  }, [batchJobError]);

  async function refreshDueOpportunities() {
    setBatchUpdating(true);
    setBatchMessage("");
    setBatchError("");
    try {
      const result = await api<BatchResearchResult | ResearchQueuedResponse>("/api/research/batch", {
        method: "POST",
        body: JSON.stringify({ delivery: "standard" }),
      });
      if ("queued" in result) {
        setBatchJobId(result.jobId);
        setBatchMessage(
          "已启动低成本后台批量调研，页面会持续跟踪到任务完成。",
        );
        return;
      }
      setBatchMessage(
        result.requested === 0
          ? "所有候选数据都在新鲜期内，本次没有调用付费数据。"
          : `已用低成本批量模式检查 ${result.requested} 个候选：${result.researched} 个重新评分，${result.unchanged} 个数据无明显变化，${result.failed} 个失败。`,
      );
      setRefreshVersion((value) => value + 1);
    } catch (caught) {
      setBatchError(caught instanceof Error ? caught.message : "批量更新失败");
    } finally {
      setBatchUpdating(false);
    }
  }

  function resetFilters() {
    navigate("/radar", { replace: true, scroll: false });
  }

  return (
    <div className="radar-page">
      <section className="radar-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => {
              updateRoute({ query: event.target.value, page: null });
            }}
            maxLength={120}
            placeholder="搜索候选、用户或问题…"
            aria-label="搜索雷达库"
          />
        </div>
        <div className="filter-group">
          <SlidersHorizontal size={16} />
          <select
            value={platform}
            onChange={(event) => {
              updateRoute({ platform: event.target.value, page: null });
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
              updateRoute({ verdict: event.target.value, page: null });
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
            value={researchStatus}
            onChange={(event) => {
              updateRoute({ researchStatus: event.target.value, page: null });
            }}
            aria-label="按调研状态筛选"
          >
            <option value="">全部调研状态</option>
            <option value="UNRESEARCHED">待调研</option>
            <option value="RUNNING">调研中</option>
            <option value="READY">结论有效</option>
            <option value="FAILED">调研失败</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => {
              updateRoute({ sortBy: event.target.value === "score" ? null : event.target.value, page: null });
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
        <button
          className="button button--secondary"
          onClick={refreshDueOpportunities}
          disabled={batchUpdating || batchJob?.status === "RUNNING"}
        >
          <RefreshCw className={batchUpdating || batchJob?.status === "RUNNING" ? "spin" : ""} size={16} />
          {batchUpdating || batchJob?.status === "RUNNING" ? "批量更新中…" : "更新到期数据"}
        </button>
      </section>
      {batchMessage && <div className="form-success batch-message" role="status">{batchMessage}</div>}
      {batchError && <div className="form-error batch-message" role="alert">{batchError}</div>}
      {batchJobId && (
        <button
          className="text-button batch-job-link"
          onClick={() => navigate(`/operations?job=${batchJobId}`)}
        >
          查看任务 {batchJobId.slice(0, 8)}
        </button>
      )}

      <section className="table-panel">
        <header className="table-panel__header">
          <div>
            <span className="eyebrow">ALL OPPORTUNITIES</span>
            <h2>{result.total} 个候选产品</h2>
          </div>
          <span className="table-hint">通过“下一步”进入调研或执行处理</span>
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
                    <th>下一步</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <OpportunityRow
                      key={item.id}
                      item={item}
                      onClick={() =>
                        navigate(
                          `/radar/${item.id}${search ? `?from=${encodeURIComponent(search)}` : ""}`,
                        )
                      }
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
                  onClick={() => updateRoute({ page: page - 1 }, false)}
                  aria-label="上一页"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={page >= result.totalPages}
                  onClick={() => updateRoute({ page: page + 1 }, false)}
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
