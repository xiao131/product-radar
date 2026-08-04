import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CircleHelp,
  FileSearch,
  Inbox,
  LoaderCircle,
  Merge,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Opportunity, Product, ProductDetail, Signal } from "../../shared/types";
import { api } from "../api";
import { ErrorState, LoadingState, Modal, PlatformBadge, ResearchStatusBadge } from "../components";
import { ProductForm } from "../forms";
import { formatDate, productStatusName, useI18n } from "../i18n";
import { useNavigate, usePath } from "../router";

export function ProductDetailPage() {
  const { locale, t } = useI18n();
  const id = usePath().split("/")[2];
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargets, setMergeTargets] = useState<Product[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    setError("");
    api<ProductDetail>(`/api/products/${id}`)
      .then(setDetail)
      .catch((caught) => setError(caught instanceof Error ? caught.message : t("读取失败", "Failed to load")));
  }, [id, t]);

  useEffect(load, [load]);

  async function updateProductStatus(status: Product["status"]) {
    if (!detail) return;
    setBusy(true);
    setActionError("");
    try {
      await api<Product>(`/api/products/${detail.product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setMessage(status === "ARCHIVED" ? t("产品已归档。", "Product archived.") : t("产品已恢复为暂停状态。", "Product restored to paused."));
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("更新失败", "Update failed"));
    } finally {
      setBusy(false);
    }
  }

  async function moveToTrash() {
    if (!detail || !window.confirm(t("产品会移入回收站，关联候选和证据不会被删除。继续吗？", "Move this product to trash? Related candidates and evidence will be preserved."))) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<ProductDetail>(`/api/products/${detail.product.id}`, { method: "DELETE" });
      setDetail(result);
      setMessage(t("产品已移入回收站，可以恢复。", "Product moved to trash and can be restored."));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("删除失败", "Delete failed"));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!detail) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<ProductDetail>(`/api/products/${detail.product.id}/restore`, { method: "POST" });
      setDetail(result);
      setMessage(t("产品已恢复到产品库。", "Product restored to the portfolio."));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("恢复失败", "Restore failed"));
    } finally {
      setBusy(false);
    }
  }

  async function permanentDelete() {
    if (!detail || !window.confirm(t("永久删除后无法恢复。只有没有有效关联的数据才能删除，确定继续吗？", "Permanent deletion cannot be undone. Continue?"))) return;
    setBusy(true);
    setActionError("");
    try {
      await api<void>(`/api/products/${detail.product.id}/permanent`, { method: "DELETE" });
      navigate("/products");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("永久删除失败", "Permanent deletion failed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    try {
      const signal = await api<Signal>(`/api/products/${detail.product.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          title: data.get("title"),
          content: data.get("content"),
          sourceUrl: data.get("sourceUrl"),
          opportunityId: data.get("opportunityId") || undefined,
        }),
      });
      setFeedbackOpen(false);
      setMessage(signal.opportunityId
        ? t("反馈已写入原始证据和关联候选，候选已等待重新调研。", "Feedback added to raw evidence and the candidate now awaits reassessment.")
        : t("反馈已保存到原始证据。", "Feedback saved to raw evidence."));
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("反馈保存失败", "Failed to save feedback"));
    } finally {
      setBusy(false);
    }
  }

  async function submitResearchCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    try {
      const opportunity = await api<Opportunity>(`/api/products/${detail.product.id}/research-candidate`, {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          oneLiner: data.get("oneLiner"),
          targetUser: data.get("targetUser"),
          recommendedPlatform: data.get("recommendedPlatform"),
        }),
      });
      navigate(`/radar/${opportunity.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("候选创建失败", "Failed to create candidate"));
    } finally {
      setBusy(false);
    }
  }

  async function submitReclassification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    try {
      await api<{ signal: Signal }>(`/api/products/${detail.product.id}/reclassify-to-signal`, {
        method: "POST",
        body: JSON.stringify({ title: data.get("title"), content: data.get("content") }),
      });
      setReclassifyOpen(false);
      setMessage(t("已纠正为原始证据；原产品进入回收站，证据可以继续转为候选。", "Reclassified as raw evidence; the original product is now in trash."));
      load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("纠正失败", "Reclassification failed"));
    } finally {
      setBusy(false);
    }
  }

  async function openMerge() {
    if (!detail) return;
    setActionError("");
    try {
      const products = await api<Product[]>("/api/products?trash=active");
      setMergeTargets(products.filter((product) => product.id !== detail.product.id));
      setMergeOpen(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("产品读取失败", "Failed to load products"));
    }
  }

  async function submitMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    try {
      const result = await api<ProductDetail>(`/api/products/${detail.product.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetProductId: data.get("targetProductId") }),
      });
      setDetail(result);
      setMergeOpen(false);
      setMessage(t("重复产品已合并，候选和证据关系已迁移。", "Duplicate merged; candidate and evidence links were transferred."));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("合并失败", "Merge failed"));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!detail) return <LoadingState label={t("正在读取产品档案", "Loading product record")} />;

  const { product, relatedOpportunities, dependencies } = detail;
  const isTrashed = Boolean(product.trashedAt);

  return (
    <div className="product-detail-page">
      <button className="text-button back-link" onClick={() => navigate("/products")}>
        <ArrowLeft size={15} /> {t("返回产品库", "Back to products")}
      </button>

      <section className="product-detail-hero">
        <div>
          <span className="eyebrow">{isTrashed ? t("回收站产品", "TRASHED PRODUCT") : t("产品档案", "PRODUCT RECORD")}</span>
          <h1>{product.name}</h1>
          <p>{product.description || t("尚未填写产品说明。", "No product description yet.")}</p>
          <div className="product-detail-badges">
            <PlatformBadge platform={product.platform} />
            <span className={`product-status product-status--${product.status.toLowerCase()}`}>{productStatusName(product.status, locale)}</span>
            {product.verificationStatus === "NEEDS_REVIEW" ? (
              <span className="verification-badge verification-badge--review"><CircleHelp size={12} /> {t("待核实", "Needs review")}</span>
            ) : (
              <span className="verification-badge"><BadgeCheck size={12} /> {t("已确认", "Confirmed")}</span>
            )}
          </div>
        </div>
        {!isTrashed && (
          <button className="button button--secondary" onClick={() => setEditing(true)}>
            <Pencil size={15} /> {t("编辑资料", "Edit")}
          </button>
        )}
      </section>

      {message && <div className="form-success standalone-error" role="status">{message}</div>}
      {actionError && <div className="form-error standalone-error" role="alert">{actionError}</div>}

      <div className="product-detail-grid">
        <main>
          <section className="detail-section">
            <span className="eyebrow">{t("当前执行", "CURRENT EXECUTION")}</span>
            <h2>{t("当前重点", "Current focus")}</h2>
            <p>{product.currentFocus || t("尚未记录当前重点。", "No current focus recorded.")}</p>
            <small>{t("最后更新", "Last updated")}：{formatDate(product.updatedAt, locale)}</small>
          </section>

          <section className="detail-section">
            <div className="section-heading-row">
              <div>
                <span className="eyebrow">{t("研究关系", "RESEARCH LINKS")}</span>
                <h2>{t("关联候选", "Related candidates")}</h2>
              </div>
              {!isTrashed && <button className="button button--secondary button--small" onClick={() => setResearchOpen(true)}><FileSearch size={14} /> {t("继续调研", "Continue research")}</button>}
            </div>
            {relatedOpportunities.length ? (
              <div className="product-related-list">
                {relatedOpportunities.map(({ opportunity, relationType }) => (
                  <button key={opportunity.id} onClick={() => navigate(`/radar/${opportunity.id}`)}>
                    <div>
                      <strong>{opportunity.localizedContent?.[locale]?.name ?? opportunity.name}</strong>
                      <span>{relationType === "ORIGIN" ? t("原始来源", "Origin") : relationType === "RESEARCH" ? t("继续调研", "Follow-up research") : t("已有产品关联", "Existing product")}</span>
                    </div>
                    <ResearchStatusBadge status={opportunity.researchStatus} />
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{t("还没有关联候选。可以从这个产品发起重新定位、下一版本或市场验证。", "No related candidates yet. Start research for a repositioning, next version, or market validation.")}</p>
            )}
          </section>

          {isTrashed && (
            <section className="detail-section product-trash-summary">
              <span className="eyebrow">{t("删除原因", "TRASH CONTEXT")}</span>
              <h2>{product.reclassifiedSignalId ? t("已纠正为原始证据", "Reclassified as raw evidence") : product.mergedIntoProductId ? t("已合并到其他产品", "Merged into another product") : t("已移入回收站", "Moved to trash")}</h2>
              <p>{t(`关联候选 ${dependencies.candidateLinks} 个，产品信号 ${dependencies.feedbackSignals} 条，产品证据 ${dependencies.evidenceItems} 条。`, `${dependencies.candidateLinks} candidate links, ${dependencies.feedbackSignals} signals, and ${dependencies.evidenceItems} evidence items remain.`)}</p>
              {detail.reclassifiedSignal && <button className="text-button" onClick={() => navigate("/signals")}><Inbox size={14} /> {t("查看原始证据", "View raw evidence")}</button>}
              {detail.mergedIntoProduct && <button className="text-button" onClick={() => navigate(`/products/${detail.mergedIntoProduct?.id}`)}><Merge size={14} /> {t("打开合并后的产品", "Open merged product")}</button>}
            </section>
          )}
        </main>

        <aside className="product-detail-actions">
          <section className="action-card">
            <span className="eyebrow">{t("下一步", "NEXT ACTION")}</span>
            {isTrashed ? (
              <>
                <button className="button button--primary button--full" disabled={busy} onClick={() => void restore()}><RotateCcw size={15} /> {t("恢复到产品库", "Restore")}</button>
                <button className="button button--ghost button--full danger-text" disabled={busy} onClick={() => void permanentDelete()}><Trash2 size={15} /> {t("永久删除", "Delete permanently")}</button>
                <small>{t("存在有效候选或证据关联时，系统会阻止永久删除。", "Permanent deletion is blocked while candidate or evidence links remain.")}</small>
              </>
            ) : (
              <>
                <button className="button button--orange button--full" onClick={() => setResearchOpen(true)}><FileSearch size={15} /> {t("继续调研", "Continue research")}</button>
                <button className="button button--secondary button--full" onClick={() => setFeedbackOpen(true)}><MessageSquarePlus size={15} /> {t("记录反馈证据", "Record feedback")}</button>
                <button className="button button--secondary button--full" onClick={() => setReclassifyOpen(true)}><Inbox size={15} /> {t("纠正为原始证据", "Reclassify as evidence")}</button>
                <button className="button button--ghost button--full" disabled={busy} onClick={() => void updateProductStatus(product.status === "ARCHIVED" ? "PAUSED" : "ARCHIVED")}><Archive size={15} /> {product.status === "ARCHIVED" ? t("取消归档", "Unarchive") : t("归档产品", "Archive")}</button>
                <button className="button button--ghost button--full" onClick={() => void openMerge()}><Merge size={15} /> {t("合并重复产品", "Merge duplicate")}</button>
                <button className="button button--ghost button--full danger-text" disabled={busy} onClick={() => void moveToTrash()}><Trash2 size={15} /> {t("移到回收站", "Move to trash")}</button>
              </>
            )}
            {busy && <span className="action-progress"><LoaderCircle className="spin" size={14} /> {t("正在处理…", "Working…")}</span>}
          </section>
        </aside>
      </div>

      <Modal title={`${t("编辑", "Edit")} ${product.name}`} open={editing} onClose={() => setEditing(false)}>
        <ProductForm product={product} onCancel={() => setEditing(false)} onSaved={(saved) => {
          setDetail((current) => current ? { ...current, product: saved } : current);
          setEditing(false);
          setMessage(t("产品资料已更新。", "Product updated."));
        }} />
      </Modal>

      <Modal title={t("记录产品反馈", "Record product feedback")} subtitle={t("反馈先保存为原始证据；选择候选后会同时进入该候选证据账本。", "Feedback is saved as raw evidence and can also be added to a candidate ledger.")} open={feedbackOpen} onClose={() => setFeedbackOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void submitFeedback(event)}>
          <label>{t("证据标题", "Evidence title")}<input name="title" required minLength={2} maxLength={140} defaultValue={`${product.name} ${t("产品反馈", "feedback")}`} /></label>
          <label>{t("原始反馈", "Original feedback")}<textarea name="content" required minLength={3} maxLength={10_000} rows={5} /></label>
          <label>{t("来源链接（可选）", "Source URL (optional)")}<input name="sourceUrl" type="url" placeholder="https://…" /></label>
          <label>{t("立即加入候选（可选）", "Add to candidate now (optional)")}<select name="opportunityId"><option value="">{t("只保存原始证据", "Raw evidence only")}</option>{relatedOpportunities.map(({ opportunity }) => <option key={opportunity.id} value={opportunity.id}>{opportunity.localizedContent?.[locale]?.name ?? opportunity.name}</option>)}</select></label>
          <div className="form-actions"><button type="button" className="button button--ghost" onClick={() => setFeedbackOpen(false)}>{t("取消", "Cancel")}</button><button className="button button--primary" disabled={busy}>{t("保存反馈", "Save feedback")}</button></div>
        </form>
      </Modal>

      <Modal title={t("从产品发起继续调研", "Start follow-up research")} subtitle={t("系统会保留产品，并创建一个带产品历史证据的新候选。", "The product stays in place while a linked candidate is created with product-history evidence.")} open={researchOpen} onClose={() => setResearchOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void submitResearchCandidate(event)}>
          <label>{t("候选名称", "Candidate name")}<input name="name" required minLength={2} maxLength={140} defaultValue={`${product.name} ${t("重新评估", "reassessment")}`} /></label>
          <label>{t("一句话方向", "One-line direction")}<textarea name="oneLiner" required minLength={3} maxLength={500} rows={3} defaultValue={product.description} /></label>
          <label>{t("目标用户", "Target user")}<input name="targetUser" required minLength={2} maxLength={300} placeholder={t("谁会为什么问题使用它？", "Who would use it, and for what problem?")} /></label>
          <label>{t("推荐平台", "Recommended platform")}<select name="recommendedPlatform" defaultValue={product.platform === "UNKNOWN" ? "WEB" : product.platform}><option value="WEB">Web</option><option value="IOS">iOS</option><option value="WEB_AND_IOS">Web + iOS</option></select></label>
          <div className="form-actions"><button type="button" className="button button--ghost" onClick={() => setResearchOpen(false)}>{t("取消", "Cancel")}</button><button className="button button--primary" disabled={busy}>{t("创建候选", "Create candidate")}</button></div>
        </form>
      </Modal>

      <Modal title={t("纠正为原始证据", "Reclassify as raw evidence")} subtitle={t("适用于从未开发、被误放入产品库的记录。原产品会进入回收站。", "Use this only for records that were never developed. The original product moves to trash.")} open={reclassifyOpen} onClose={() => setReclassifyOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void submitReclassification(event)}>
          <label>{t("证据标题", "Evidence title")}<input name="title" required minLength={2} maxLength={140} defaultValue={product.name} /></label>
          <label>{t("原始想法内容", "Original idea")}<textarea name="content" required minLength={3} maxLength={10_000} rows={6} defaultValue={[product.description, product.currentFocus].filter(Boolean).join("\n\n")} /></label>
          <div className="warning-note">{t("确认后，这条记录不再作为已开发产品参与组合判断。", "After confirmation, this record will no longer be treated as a developed product.")}</div>
          <div className="form-actions"><button type="button" className="button button--ghost" onClick={() => setReclassifyOpen(false)}>{t("取消", "Cancel")}</button><button className="button button--orange" disabled={busy}>{t("确认纠正", "Confirm reclassification")}</button></div>
        </form>
      </Modal>

      <Modal title={t("合并重复产品", "Merge duplicate product")} subtitle={t("候选、信号和证据关系会迁移到目标产品，当前产品进入回收站。", "Candidate, signal, and evidence links move to the target product.")} open={mergeOpen} onClose={() => setMergeOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void submitMerge(event)}>
          <label>{t("目标产品", "Target product")}<select name="targetProductId" required><option value="">{t("请选择…", "Choose…")}</option>{mergeTargets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <div className="form-actions"><button type="button" className="button button--ghost" onClick={() => setMergeOpen(false)}>{t("取消", "Cancel")}</button><button className="button button--orange" disabled={busy}>{t("确认合并", "Merge")}</button></div>
        </form>
      </Modal>
    </div>
  );
}
