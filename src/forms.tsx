import { type FormEvent, useState } from "react";
import { api } from "./api";
import { Field, FormActions } from "./components";
import type { Opportunity, Product, Signal } from "../shared/types";
import { useI18n } from "./i18n";

export function SignalForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (signal: Signal) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const signal = await api<Signal>("/api/signals", {
        method: "POST",
        body: JSON.stringify({
          sourceType: data.get("sourceType"),
          title: data.get("title"),
          content: data.get("content"),
          sourceUrl: data.get("sourceUrl"),
          tags: String(data.get("tags") ?? "")
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          market: data.get("market") || undefined,
          originalLanguage: data.get("originalLanguage") || undefined,
        }),
      });
      onSaved(signal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("保存失败", "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label={t("信号类型", "Signal type")}>
        <select name="sourceType" defaultValue="IDEA">
          <option value="IDEA">{t("手工点子", "Manual idea")}</option>
          <option value="REDDIT">{t("Reddit 抱怨", "Reddit complaint")}</option>
          <option value="X">X / Twitter</option>
          <option value="APP_REVIEW">{t("App Store 评论", "App Store review")}</option>
          <option value="APP_STORE">{t("App Store 市场", "App Store market")}</option>
          <option value="SEARCH">{t("搜索数据", "Search data")}</option>
          <option value="TREND">{t("趋势数据", "Trend data")}</option>
          <option value="FORUM">{t("论坛讨论", "Forum discussion")}</option>
          <option value="CUSTOMER">{t("用户反馈", "Customer feedback")}</option>
          <option value="OTHER">{t("其他", "Other")}</option>
        </select>
      </Field>
      <div className="form-row">
        <Field label={t("目标市场", "Target market")}>
          <select name="market" defaultValue="">
            <option value="">{t("暂未指定", "Not specified")}</option>
            <option value="CN/zh-CN">{t("中国市场", "China")}</option>
            <option value="US/en">{t("海外英语市场", "English-speaking market")}</option>
          </select>
        </Field>
        <Field label={t("原始语言", "Original language")}>
          <select name="originalLanguage" defaultValue="">
            <option value="">{t("自动识别", "Detect automatically")}</option>
            <option value="zh-CN">{t("中文", "Chinese")}</option>
            <option value="en">{t("英文", "English")}</option>
            <option value="mixed">{t("中英混合", "Mixed")}</option>
          </select>
        </Field>
      </div>
      <Field label={t("一句话标题", "One-line title")}>
        <input
          name="title"
          required
          minLength={2}
          maxLength={140}
          placeholder={t("例如：分享截图前自动隐藏隐私", "Example: Automatically hide private data before sharing screenshots")}
        />
      </Field>
      <Field label={t("原始内容", "Original content")} hint={t("保留用户原话或你的完整想法，之后会作为调研证据。", "Keep the user's original wording or your full idea; it will become research evidence.")}>
        <textarea
          name="content"
          required
          minLength={3}
          rows={5}
          placeholder={t("粘贴评论、抱怨，或描述谁在什么场景下遇到什么问题。", "Paste a review or complaint, or describe who faces what problem in which context.")}
        />
      </Field>
      <div className="form-row">
        <Field label={t("来源链接（可选）", "Source URL (optional)")}>
          <input name="sourceUrl" type="url" placeholder="https://…" />
        </Field>
        <Field label={t("标签（可选）", "Tags (optional)")}>
          <input name="tags" placeholder={t("隐私, 图片, 创作者", "privacy, images, creators")} />
        </Field>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={t("加入收件箱", "Add to inbox")} />
    </form>
  );
}

export function ProductForm({
  onCancel,
  onSaved,
  product,
}: {
  onCancel: () => void;
  onSaved: (product: Product) => void;
  product?: Product;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const savedProduct = await api<Product>(
        product ? `/api/products/${product.id}` : "/api/products",
        {
          method: product ? "PATCH" : "POST",
          body: JSON.stringify({
            name: data.get("name"),
            platform: data.get("platform"),
            status: data.get("status"),
            url: data.get("url"),
            description: data.get("description"),
            currentFocus: data.get("currentFocus"),
            verificationStatus: data.get("verificationStatus"),
          }),
        },
      );
      onSaved(savedProduct);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("保存失败", "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label={t("产品名称", "Product name")}>
        <input name="name" required minLength={2} maxLength={100} defaultValue={product?.name} placeholder="例如：Photo GPS" />
      </Field>
      <div className="form-row">
        <Field label={t("平台", "Platform")}>
          <select name="platform" defaultValue={product?.platform ?? "UNKNOWN"}>
            <option value="UNKNOWN">{t("待确认", "Unknown")}</option>
            <option value="WEB">Web</option>
            <option value="IOS">iOS</option>
            <option value="WEB_AND_IOS">Web + iOS</option>
          </select>
        </Field>
        <Field label={t("状态", "Status")}>
          <select name="status" defaultValue={product?.status ?? "LIVE"}>
            <option value="BUILDING">{t("开发中", "Building")}</option>
            <option value="LIVE">{t("已上线", "Live")}</option>
            <option value="PAUSED">{t("暂停", "Paused")}</option>
            <option value="ARCHIVED">{t("归档", "Archived")}</option>
          </select>
        </Field>
      </div>
      <Field
        label={t("资料可信度", "Verification")}
        hint={t("待核实产品不会参与 AI 的资产复用和个人匹配判断。", "Products awaiting review are excluded from AI portfolio-fit context.")}
      >
        <select name="verificationStatus" defaultValue={product?.verificationStatus ?? "CONFIRMED"}>
          <option value="CONFIRMED">{t("已确认", "Confirmed")}</option>
          <option value="NEEDS_REVIEW">{t("待核实", "Needs review")}</option>
        </select>
      </Field>
      <Field label={t("产品说明", "Product description")}>
        <textarea
          name="description"
          rows={3}
          maxLength={600}
          defaultValue={product?.description}
          placeholder={t("它为谁解决什么问题？", "Who does it help, and what problem does it solve?")}
        />
      </Field>
      <Field label={t("当前重点", "Current focus")}>
        <input name="currentFocus" maxLength={300} defaultValue={product?.currentFocus} placeholder={t("例如：验证英文自然搜索流量", "Example: Validate English organic search traffic")} />
      </Field>
      <Field label={t("网址（可选）", "URL (optional)")}>
        <input name="url" type="url" defaultValue={product?.url ?? ""} placeholder="https://…" />
      </Field>
      {error && <div className="form-error" role="alert">{error}</div>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={product ? t("保存修改", "Save changes") : t("保存产品", "Save product")} />
    </form>
  );
}

export function OpportunityForm({
  opportunity,
  onCancel,
  onSaved,
}: {
  opportunity: Opportunity;
  onCancel: () => void;
  onSaved: (opportunity: Opportunity) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const zhName = String(data.get("nameZh") ?? "").trim();
      const enName = String(data.get("nameEn") ?? "").trim();
      const zhOneLiner = String(data.get("oneLinerZh") ?? "").trim();
      const enOneLiner = String(data.get("oneLinerEn") ?? "").trim();
      const zhTargetUser = String(data.get("targetUserZh") ?? "").trim();
      const enTargetUser = String(data.get("targetUserEn") ?? "").trim();
      const zhComplete = Boolean(zhName && zhOneLiner && zhTargetUser);
      const enComplete = Boolean(enName && enOneLiner && enTargetUser);
      const zhPartial = Boolean(zhName || zhOneLiner || zhTargetUser);
      const enPartial = Boolean(enName || enOneLiner || enTargetUser);
      const targetMarkets = data.getAll("targetMarkets").map(String);
      if ((zhPartial && !zhComplete) || (enPartial && !enComplete)) {
        setError(t("同一种语言的名称、机会描述和目标用户需要填写完整。", "Complete the name, opportunity, and target user for each language you use."));
        return;
      }
      if (!zhComplete && !enComplete) {
        setError(t("至少填写一套完整的中文或英文候选信息。", "Enter at least one complete Chinese or English candidate description."));
        return;
      }
      if (!targetMarkets.length) {
        setError(t("至少选择一个目标市场。", "Select at least one target market."));
        return;
      }
      const saved = await api<Opportunity>(
        `/api/opportunities/${opportunity.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: zhName || enName,
            oneLiner: zhOneLiner || enOneLiner,
            targetUser: zhTargetUser || enTargetUser,
            recommendedPlatform: data.get("recommendedPlatform"),
            originalLanguage: data.get("originalLanguage"),
            targetMarkets,
            localizedContent: {
              ...(zhComplete
                ? { "zh-CN": { name: zhName, oneLiner: zhOneLiner, targetUser: zhTargetUser } }
                : {}),
              ...(enComplete
                ? { en: { name: enName, oneLiner: enOneLiner, targetUser: enTargetUser } }
                : {}),
            },
          }),
        },
      );
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("保存失败", "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <div className="form-section-label">{t("中文展示", "Chinese display copy")}</div>
      <Field label={t("中文候选名称", "Chinese candidate name")}>
        <input name="nameZh" minLength={2} maxLength={140} defaultValue={opportunity.localizedContent["zh-CN"]?.name ?? (opportunity.originalLanguage !== "en" ? opportunity.name : "")} />
      </Field>
      <Field label={t("中文一句话机会", "Chinese one-line opportunity")}>
        <textarea name="oneLinerZh" minLength={3} maxLength={500} rows={3} defaultValue={opportunity.localizedContent["zh-CN"]?.oneLiner ?? (opportunity.originalLanguage !== "en" ? opportunity.oneLiner : "")} />
      </Field>
      <Field label={t("中文目标用户", "Chinese target user")}>
        <textarea name="targetUserZh" minLength={2} maxLength={300} rows={2} defaultValue={opportunity.localizedContent["zh-CN"]?.targetUser ?? (opportunity.originalLanguage !== "en" ? opportunity.targetUser : "")} />
      </Field>
      <div className="form-section-label">{t("英文展示", "English display copy")}</div>
      <Field label={t("英文候选名称", "English candidate name")}>
        <input name="nameEn" minLength={2} maxLength={140} defaultValue={opportunity.localizedContent.en?.name ?? (opportunity.originalLanguage === "en" ? opportunity.name : "")} />
      </Field>
      <Field label={t("英文一句话机会", "English one-line opportunity")}>
        <textarea name="oneLinerEn" minLength={3} maxLength={500} rows={3} defaultValue={opportunity.localizedContent.en?.oneLiner ?? (opportunity.originalLanguage === "en" ? opportunity.oneLiner : "")} />
      </Field>
      <Field label={t("英文目标用户", "English target user")}>
        <textarea name="targetUserEn" minLength={2} maxLength={300} rows={2} defaultValue={opportunity.localizedContent.en?.targetUser ?? (opportunity.originalLanguage === "en" ? opportunity.targetUser : "")} />
      </Field>
      <div className="form-row">
      <Field label={t("原始语言", "Original language")}>
        <select name="originalLanguage" defaultValue={opportunity.originalLanguage}>
          <option value="zh-CN">{t("中文", "Chinese")}</option>
          <option value="en">{t("英文", "English")}</option>
          <option value="mixed">{t("中英混合", "Mixed")}</option>
          <option value="und">{t("未识别", "Unknown")}</option>
        </select>
      </Field>
      <Field label={t("建议平台", "Recommended platform")}>
        <select name="recommendedPlatform" defaultValue={opportunity.recommendedPlatform}>
          <option value="WEB">Web</option>
          <option value="IOS">iOS</option>
          <option value="WEB_AND_IOS">Web + iOS</option>
        </select>
      </Field>
      </div>
      <fieldset className="market-checkboxes">
        <legend>{t("目标市场", "Target markets")}</legend>
        <label><input type="checkbox" name="targetMarkets" value="CN" defaultChecked={opportunity.targetMarkets.includes("CN")} /> {t("中国", "China")}</label>
        <label><input type="checkbox" name="targetMarkets" value="US" defaultChecked={opportunity.targetMarkets.includes("US")} /> {t("海外英语市场", "English-speaking market")}</label>
      </fieldset>
      <div className="form-warning">
        {t("修改候选定义后，当前结论会进入待更新状态；历史报告不会被删除。", "Changing the candidate definition marks the current decision for refresh; history is preserved.")}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={t("保存并等待重评", "Save and queue reassessment")} />
    </form>
  );
}
