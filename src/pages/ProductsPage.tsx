import { ExternalLink, FileUp, Pencil, Plus, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import type { CsvImportResult, Product } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal, PlatformBadge } from "../components";
import { CsvImportModal } from "../CsvImportModal";
import { ProductForm } from "../forms";
import { formatDate, productStatusName, useI18n } from "../i18n";
import { useNavigate } from "../router";

export function ProductsPage() {
  const { locale, t } = useI18n();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const navigate = useNavigate();

  function load() {
    setError("");
    api<Product[]>("/api/products")
      .then(setProducts)
      .catch((caught) => setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load")));
  }

  useEffect(load, []);

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
  if (!products) return <LoadingState label={t("正在读取产品库", "Loading product library")} />;

  return (
    <div>
      <section className="context-banner">
        <div>
          <span className="eyebrow">{t("为什么重要", "WHY THIS MATTERS")}</span>
          <h2>{t("推荐不应该脱离你已经做过的产品", "Recommendations should reflect what you have already built")}</h2>
          <p>{t("产品库会成为后续 AI 判断个人匹配度、复用资产和避免重复建设的上下文。", "The product library gives AI context for founder fit, asset reuse, and avoiding duplicate work.")}</p>
        </div>
        <div className="context-banner__actions">
          <button className="button button--secondary" onClick={() => setImportOpen(true)}>
            <FileUp size={16} /> {t("导入 CSV", "Import CSV")}
          </button>
          <button className="button button--primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> {t("添加产品", "Add product")}
          </button>
        </div>
      </section>

      {products.length ? (
        <section className="product-table">
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
                <strong>{product.name}</strong>
                <span>{product.description || t("尚未填写产品说明", "No product description")}</span>
                {product.sourceOpportunityId && (
                  <button
                    className="text-button product-source"
                    onClick={() => navigate(`/radar/${product.sourceOpportunityId}`)}
                  >
                    <Radar size={13} /> {t("来自候选", "From candidate")}
                  </button>
                )}
              </div>
              <div><PlatformBadge platform={product.platform} /></div>
              <div><span className={`product-status product-status--${product.status.toLowerCase()}`}>
                {productStatusName(product.status, locale)}
              </span></div>
              <p>{product.currentFocus || "—"}</p>
              <div className="product-updated">
                <span>{formatDate(product.updatedAt, locale)}</span>
                {product.url && (
                  <a href={product.url} target="_blank" rel="noreferrer" aria-label={`${t("打开", "Open")} ${product.name}`}>
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <button
                className="icon-button"
                onClick={() => setEditing(product)}
                aria-label={`${t("编辑", "Edit")} ${product.name}`}
              >
                <Pencil size={15} />
              </button>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title={t("产品库还是空的", "The product library is empty")}
          description={t("先加入你已经上线或正在开发的 Web / iOS 产品。", "Add the Web or iOS products you have already launched or are building.")}
          action={<button className="button button--primary" onClick={() => setCreating(true)}>{t("添加第一个产品", "Add the first product")}</button>}
        />
      )}

      <Modal
        title={editing ? `${t("编辑", "Edit")} ${editing.name}` : t("添加一个现有产品", "Add an existing product")}
        subtitle={t("上线、在建、暂停和归档状态都会影响后续个人匹配判断。", "Live, building, paused, and archived states all affect future founder-fit decisions.")}
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
