import { ExternalLink, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal, PlatformBadge } from "../components";
import { ProductForm } from "../forms";
import { productStatusLabels, shortDate } from "../format";

export function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [feedback, setFeedback] = useState("");

  function load() {
    setError("");
    api<Product[]>("/api/products")
      .then(setProducts)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取失败"));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!products) return <LoadingState label="正在读取产品库" />;

  return (
    <div>
      <section className="context-banner">
        <div>
          <span className="eyebrow">WHY THIS MATTERS</span>
          <h2>推荐不应该脱离你已经做过的产品</h2>
          <p>产品库会成为后续 AI 判断个人匹配度、复用资产和避免重复建设的上下文。</p>
        </div>
        <button className="button button--primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> 添加产品
        </button>
      </section>

      {products.length ? (
        <section className="product-table">
          <div className="product-table__row product-table__head">
            <span>产品</span>
            <span>平台</span>
            <span>状态</span>
            <span>当前重点</span>
            <span>更新</span>
            <span>操作</span>
          </div>
          {products.map((product) => (
            <article className="product-table__row" key={product.id}>
              <div className="product-cell">
                <strong>{product.name}</strong>
                <span>{product.description || "尚未填写产品说明"}</span>
              </div>
              <div><PlatformBadge platform={product.platform} /></div>
              <div><span className={`product-status product-status--${product.status.toLowerCase()}`}>
                {productStatusLabels[product.status]}
              </span></div>
              <p>{product.currentFocus || "—"}</p>
              <div className="product-updated">
                <span>{shortDate(product.updatedAt)}</span>
                {product.url && (
                  <a href={product.url} target="_blank" rel="noreferrer" aria-label={`打开 ${product.name}`}>
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <button
                className="icon-button"
                onClick={() => setEditing(product)}
                aria-label={`编辑 ${product.name}`}
              >
                <Pencil size={15} />
              </button>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="产品库还是空的"
          description="先加入你已经上线或正在开发的 Web / iOS 产品。"
          action={<button className="button button--primary" onClick={() => setCreating(true)}>添加第一个产品</button>}
        />
      )}

      <Modal
        title={editing ? `编辑 ${editing.name}` : "添加一个现有产品"}
        subtitle="上线、在建、暂停和归档状态都会影响后续个人匹配判断。"
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
            setFeedback(editing ? "产品已更新，相关候选已进入待重评状态。" : "产品已加入组合，相关候选已进入待重评状态。");
            setCreating(false);
            setEditing(null);
          }}
        />
      </Modal>
      {feedback && (
        <div className="toast-inline" role="status" aria-live="polite">
          {feedback}
        </div>
      )}
    </div>
  );
}
