import { ExternalLink, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, Modal, PlatformBadge } from "../components";
import { ProductForm } from "../forms";
import { productStatusLabels, shortDate } from "../format";

export function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  function load() {
    setError("");
    api<Product[]>("/api/products")
      .then(setProducts)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取失败"));
  }

  useEffect(load, []);

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
        <button className="button button--primary" onClick={() => setModalOpen(true)}>
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
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="产品库还是空的"
          description="先加入你已经上线或正在开发的 Web / iOS 产品。"
          action={<button className="button button--primary" onClick={() => setModalOpen(true)}>添加第一个产品</button>}
        />
      )}

      <Modal
        title="添加一个现有产品"
        subtitle="上线、在建和暂停的产品都可以纳入管理。"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <ProductForm
          onCancel={() => setModalOpen(false)}
          onSaved={(product) => {
            setProducts((current) => [product, ...(current ?? [])]);
            setModalOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
