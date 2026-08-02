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
import { useI18n } from "../i18n";

const defaultResult: Paginated<Opportunity> = {
  items: [],
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
};

export function RadarPage() {
  const { t } = useI18n();
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
  const market = routeParams.get("market") ?? "";
  const language = routeParams.get("language") ?? "";
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
    if (market) params.set("market", market);
    if (language) params.set("language", language);
    if (verdict) params.set("verdict", verdict);
    if (researchStatus) params.set("researchStatus", researchStatus);
    return `/api/opportunities?${params}`;
  }, [language, market, page, platform, query, researchStatus, sortBy, verdict]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<Paginated<Opportunity>>(url, { signal: controller.signal })
        .then(setResult)
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load"));
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
      setBatchMessage(t("后台批量调研已完成，候选列表已更新。", "Background batch research is complete and the list has been updated."));
      setBatchError("");
      setRefreshVersion((value) => value + 1);
    } else if (batchJob?.status === "PARTIAL") {
      setBatchMessage(t("后台批量调研已完成，但有部分候选失败；成功结果已经更新。", "Batch research finished with some failures; successful results were saved."));
      setBatchError(batchJob.error || t("部分候选调研失败", "Some candidates failed"));
      setRefreshVersion((value) => value + 1);
    } else if (batchJob?.status === "FAILED") {
      setBatchError(batchJob.error || t("后台批量调研失败", "Background batch research failed"));
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
          t("已启动低成本后台批量调研，页面会持续跟踪到任务完成。", "Low-cost batch research has started and this page will track it to completion."),
        );
        return;
      }
      setBatchMessage(
        result.requested === 0
          ? t("所有候选数据都在新鲜期内，本次没有调用付费数据。", "All candidate data is still fresh; no paid data was requested.")
          : t(
              `已用低成本批量模式检查 ${result.requested} 个候选：${result.researched} 个重新评分，${result.unchanged} 个数据无明显变化，${result.failed} 个失败。`,
              `Low-cost batch mode checked ${result.requested} candidates: ${result.researched} rescored, ${result.unchanged} unchanged, ${result.failed} failed.`,
            ),
      );
      setRefreshVersion((value) => value + 1);
    } catch (caught) {
      setBatchError(caught instanceof Error ? caught.message : t("批量更新失败", "Batch update failed"));
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
            placeholder={t("搜索候选、用户或问题…", "Search candidates, users, or problems…")}
            aria-label={t("搜索雷达库", "Search opportunity library")}
          />
        </div>
        <div className="filter-group">
          <SlidersHorizontal size={16} />
          <select
            value={market}
            onChange={(event) => {
              updateRoute({ market: event.target.value, page: null });
            }}
            aria-label={t("按市场筛选", "Filter by market")}
          >
            <option value="">{t("全部市场", "All markets")}</option>
            <option value="CN">{t("中国市场", "China")}</option>
            <option value="US">{t("海外英语市场", "English-speaking market")}</option>
          </select>
          <select
            value={language}
            onChange={(event) => {
              updateRoute({ language: event.target.value, page: null });
            }}
            aria-label={t("按原始语言筛选", "Filter by original language")}
          >
            <option value="">{t("全部来源语言", "All source languages")}</option>
            <option value="zh-CN">{t("中文来源", "Chinese source")}</option>
            <option value="en">{t("英文来源", "English source")}</option>
            <option value="mixed">{t("中英混合来源", "Mixed-language source")}</option>
            <option value="und">{t("未识别语言", "Unknown language")}</option>
          </select>
          <select
            value={platform}
            onChange={(event) => {
              updateRoute({ platform: event.target.value, page: null });
            }}
            aria-label={t("按平台筛选", "Filter by platform")}
          >
            <option value="">{t("全部平台", "All platforms")}</option>
            <option value="WEB">Web</option>
            <option value="IOS">iOS</option>
            <option value="WEB_AND_IOS">Web + iOS</option>
          </select>
          <select
            value={verdict}
            onChange={(event) => {
              updateRoute({ verdict: event.target.value, page: null });
            }}
            aria-label={t("按结论筛选", "Filter by decision")}
          >
            <option value="">{t("全部结论", "All decisions")}</option>
            <option value="BUILD_NOW">{t("现在开发", "Build now")}</option>
            <option value="VALIDATE_FIRST">{t("先验证", "Validate first")}</option>
            <option value="WATCH">{t("继续观察", "Watch")}</option>
            <option value="SKIP">{t("暂不开发", "Skip")}</option>
          </select>
          <select
            value={researchStatus}
            onChange={(event) => {
              updateRoute({ researchStatus: event.target.value, page: null });
            }}
            aria-label={t("按调研状态筛选", "Filter by research status")}
          >
            <option value="">{t("全部调研状态", "All research states")}</option>
            <option value="UNRESEARCHED">{t("待调研", "Not researched")}</option>
            <option value="RUNNING">{t("调研中", "Researching")}</option>
            <option value="READY">{t("结论有效", "Decision current")}</option>
            <option value="FAILED">{t("调研失败", "Research failed")}</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => {
              updateRoute({ sortBy: event.target.value === "score" ? null : event.target.value, page: null });
            }}
            aria-label={t("排序方式", "Sort order")}
          >
            <option value="score">{t("评分从高到低", "Highest score")}</option>
            <option value="scoreDelta">{t("最近涨分最多", "Largest recent gain")}</option>
            <option value="confidence">{t("置信度最高", "Highest confidence")}</option>
            <option value="updatedAt">{t("最近更新", "Recently updated")}</option>
            <option value="name">{t("名称 A–Z", "Name A–Z")}</option>
          </select>
        </div>
        <button
          className="button button--secondary"
          onClick={refreshDueOpportunities}
          disabled={batchUpdating || batchJob?.status === "RUNNING"}
        >
          <RefreshCw className={batchUpdating || batchJob?.status === "RUNNING" ? "spin" : ""} size={16} />
          {batchUpdating || batchJob?.status === "RUNNING" ? t("批量更新中…", "Updating…") : t("更新到期数据", "Update due data")}
        </button>
      </section>
      {batchMessage && <div className="form-success batch-message" role="status">{batchMessage}</div>}
      {batchError && <div className="form-error batch-message" role="alert">{batchError}</div>}
      {batchJobId && (
        <button
          className="text-button batch-job-link"
          onClick={() => navigate(`/operations?job=${batchJobId}`)}
        >
          {t("查看任务", "View job")} {batchJobId.slice(0, 8)}
        </button>
      )}

      <section className="table-panel">
        <header className="table-panel__header">
          <div>
            <span className="eyebrow">{t("全部候选", "ALL OPPORTUNITIES")}</span>
            <h2>{result.total} {t("个候选产品", "product candidates")}</h2>
          </div>
          <span className="table-hint">{t("通过“下一步”进入调研或执行处理", "Use “Next step” to research or act on a candidate")}</span>
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
                    <th>{t("评分", "Score")}</th>
                    <th>{t("机会", "Opportunity")}</th>
                    <th>{t("判断", "Decision")}</th>
                    <th>{t("平台", "Platform")}</th>
                    <th>{t("变化", "Change")}</th>
                    <th>{t("置信度", "Confidence")}</th>
                    <th>{t("下一步", "Next step")}</th>
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
                {t("第", "Page")} {result.page} / {result.totalPages} {t("页 · 共", "·")} {result.total} {t("条", "items")}
              </span>
              <div>
                <button
                  className="icon-button"
                  disabled={page <= 1}
                  onClick={() => updateRoute({ page: page - 1 }, false)}
                  aria-label={t("上一页", "Previous page")}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={page >= result.totalPages}
                  onClick={() => updateRoute({ page: page + 1 }, false)}
                  aria-label={t("下一页", "Next page")}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <EmptyState
            title={t("没有符合条件的候选", "No matching candidates")}
            description={t("放宽筛选条件，或者把一条新信号转成候选。", "Relax the filters or turn a new signal into a candidate.")}
            action={
              <button className="button button--secondary" onClick={resetFilters}>
                {t("清除筛选", "Clear filters")}
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}
