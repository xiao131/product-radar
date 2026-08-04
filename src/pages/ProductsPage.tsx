import {
  ArrowRight,
  BadgeCheck,
  CircleHelp,
  ExternalLink,
  FileUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { CsvImportResult, Product } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal, PlatformBadge } from "../components";
import { CsvImportModal } from "../CsvImportModal";
import { ProductForm } from "../forms";
import { formatDate, productStatusName, useI18n } from "../i18n";
import { useNavigate } from "../router";

type ProductView = "active" | "trashed";

export function ProductsPage() {
  const { locale, t } = useI18n();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [view, setView] = useState<ProductView>("active");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const navigate = useNavigate();

  function load() {
    setError("");
    setProducts(null);
    api<Product[]>(`/api/products?trash=${view}`)
      .then(setProducts)
      .catch((caught) => setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load")));
  }

  useEffect(load, [view]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function importedCsv(result: CsvImportResult) {
    setFeedback(t(
      `已导入 ${result.imported} 个产品${result.skippedDuplicates ? `，跳过 ${result.skippedDuplicates} 个重复产品` : ""}。`,
      `Imported ${result.imported} products${result.skippedDuplicates ? `; skipped ${result.skippedDuplicates} duplicates` : ""}.`,
    ));
    load();
  }

  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <div>
      <section className="context-banner">
        <div>
          <span className="eyebrow">{t("为什么重要", "WHY THIS MATTERS")}</span>
          <h2>{t("产品是已经投入执行的资产，不是待开发的点子", "Products are execution assets, not undeveloped ideas")}</h2>
          <p>{t("开发中、已上线、暂停和归档产品会形成可复用资产与历史经验；未开发想法请进入原始证据和候选流程。", "Building, live, paused, and archived products preserve reusable assets and lessons. Undeveloped ideas belong in evidence and candidate research.")}</p>
        </div>
        {view === "active" && (
          <div className="context-banner__actions">
            <button className="button button--secondary" onClick={() => setImportOpen(true)}>
              <FileUp size={16} /> {t("导入 CSV", "Import CSV")}
            </button>
            <button className="button button--primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> {t("添加产品", "Add product")}
            </button>
          </div>
        )}
      </section>

      <div className="product-view-tabs" role="tablist" aria-label={t("产品视图", "Product views")}>
        <button
          className={view === "active" ? "filter-chip filter-chip--active" : "filter-chip"}
          role="tab"
          aria-selected={view === "active"}
          onClick={() => setView("active")}
        >
          {t("产品库", "Portfolio")}
        </button>
        <button
          className={view === "trashed" ? "filter-chip filter-chip--active" : "filter-chip"}
          role="tab"
          aria-selected={view === "trashed"}
          onClick={() => setView("trashed")}
        >
          <Trash2 size={14} /> {t("回收站", "Trash")}
        </button>
      </div>

      {!products ? (
        <LoadingState label={view === "active" ? t("正在读取产品库", "Loading product library") : t("正在读取回收站", "Loading trash")} />
      ) : products.length ? (
        <section className="product-table product-table--lifecycle">
          <div className="product-table__row product-table__head">
            <span>{t("产品", "Product")}</span>
            <span>{t("平台", "Platform")}</span>
            <span>{t("状态", "Status")}</span>
            <span>{t("当前重点", "Current focus")}</span>
            <span>{t("更新", "Updated")}</span>
            <span>{t("操作", "Action")}</span>
          </div>
          {products.map((product) => (
            <article className="product-table__row" key={product.id}>
              <div className="product-cell">
                <button className="product-name-button" onClick={() => navigate(`/products/${product.id}`)}>
                  {product.name}
                </button>
                <span>{product.description || t("尚未填写产品说明", "No product description")}</span>
                <div className="product-inline-meta">
                  {product.verificationStatus === "NEEDS_REVIEW" ? (
                    <span className="verification-badge verification-badge--review"><CircleHelp size={12} /> {t("待核实", "Needs review")}</span>
                  ) : (
                    <span className="verification-badge"><BadgeCheck size={12} /> {t("已确认", "Confirmed")}</span>
                  )}
                  {product.reclassifiedSignalId && <span>{t("已纠正为证据", "Reclassified as evidence")}</span>}
                  {product.mergedIntoProductId && <span>{t("已合并", "Merged")}</span>}
                </div>
              </div>
              <div data-label={t("平台", "Platform")}><PlatformBadge platform={product.platform} /></div>
              <div data-label={t("状态", "Status")}><span className={`product-status product-status--${product.status.toLowerCase()}`}>
                {productStatusName(product.status, locale)}
              </span></div>
              <p data-label={t("当前重点", "Current focus")}>{product.currentFocus || "—"}</p>
              <div className="product-updated" data-label={t("更新", "Updated")}>
                <span>{formatDate(product.updatedAt, locale)}</span>
                {product.url && (
                  <a href={product.url} target="_blank" rel="noreferrer" aria-label={`${t("打开", "Open")} ${product.name}`}>
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <div className="product-row-actions">
                <button
                  className="button button--secondary button--small"
                  onClick={() => navigate(`/products/${product.id}`)}
                >
                  {t("管理", "Manage")} <ArrowRight size={14} />
                </button>
                {view === "active" && (
                  <button
                    className="icon-button"
                    onClick={() => setEditing(product)}
                    aria-label={`${t("编辑", "Edit")} ${product.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title={view === "active" ? t("产品库还是空的", "The product library is empty") : t("回收站是空的", "Trash is empty")}
          description={view === "active"
            ? t("加入已经上线、正在开发、暂停或归档的产品；未开发想法请放到原始证据。", "Add products that are live, building, paused, or archived. Keep undeveloped ideas in raw evidence.")
            : t("删除、纠错或合并的产品会暂存在这里。", "Deleted, reclassified, or merged products appear here.")}
          action={view === "active" ? <button className="button button--primary" onClick={() => setCreating(true)}>{t("添加第一个产品", "Add the first product")}</button> : undefined}
        />
      )}

      <Modal
        title={editing ? `${t("编辑", "Edit")} ${editing.name}` : t("添加一个现有产品", "Add an existing product")}
        subtitle={t("产品必须已经进入实际开发；尚未开发的想法请添加为原始证据。", "Products must have entered actual execution; add undeveloped ideas as raw evidence.")}
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <ProductForm
          product={editing ?? undefined}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(product) => {
            setProducts((current) => {
              const existing = current?.some((item) => item.id === product.id);
              return existing
                ? (current ?? []).map((item) => item.id === product.id ? product : item)
                : [product, ...(current ?? [])];
            });
            setFeedback(editing ? t("产品已更新，相关候选已进入待重评状态。", "Product updated; related candidates now await reassessment.") : t("产品已加入组合，相关候选已进入待重评状态。", "Product added; related candidates now await reassessment."));
            setCreating(false);
            setEditing(null);
          }}
        />
      </Modal>
      <CsvImportModal
        kind="products"
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={importedCsv}
      />
      {feedback && (
        <div className="toast-inline" role="status" aria-live="polite">
          {feedback}
        </div>
      )}
    </div>
  );
}
