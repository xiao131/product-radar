import { type FormEvent, useState } from "react";
import { api } from "./api";
import { Field, FormActions } from "./components";
import type { Product, Signal } from "../shared/types";

export function SignalForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (signal: Signal) => void;
}) {
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
        }),
      });
      onSaved(signal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="信号类型">
        <select name="sourceType" defaultValue="IDEA">
          <option value="IDEA">手工点子</option>
          <option value="REDDIT">Reddit 抱怨</option>
          <option value="X">X / Twitter</option>
          <option value="APP_REVIEW">App Store 评论</option>
          <option value="FORUM">论坛讨论</option>
          <option value="CUSTOMER">用户反馈</option>
          <option value="OTHER">其他</option>
        </select>
      </Field>
      <Field label="一句话标题">
        <input
          name="title"
          required
          minLength={2}
          maxLength={140}
          placeholder="例如：分享截图前自动隐藏隐私"
        />
      </Field>
      <Field label="原始内容" hint="保留用户原话或你的完整想法，之后会作为调研证据。">
        <textarea
          name="content"
          required
          minLength={3}
          rows={5}
          placeholder="粘贴评论、抱怨，或描述谁在什么场景下遇到什么问题。"
        />
      </Field>
      <div className="form-row">
        <Field label="来源链接（可选）">
          <input name="sourceUrl" type="url" placeholder="https://…" />
        </Field>
        <Field label="标签（可选）">
          <input name="tags" placeholder="隐私, 图片, 创作者" />
        </Field>
      </div>
      {error && <div className="form-error">{error}</div>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="加入收件箱" />
    </form>
  );
}

export function ProductForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (product: Product) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const product = await api<Product>("/api/products", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          platform: data.get("platform"),
          status: data.get("status"),
          url: data.get("url"),
          description: data.get("description"),
          currentFocus: data.get("currentFocus"),
        }),
      });
      onSaved(product);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="产品名称">
        <input name="name" required minLength={2} maxLength={100} placeholder="例如：Photo GPS" />
      </Field>
      <div className="form-row">
        <Field label="平台">
          <select name="platform" defaultValue="WEB">
            <option value="WEB">Web</option>
            <option value="IOS">iOS</option>
            <option value="WEB_AND_IOS">Web + iOS</option>
          </select>
        </Field>
        <Field label="状态">
          <select name="status" defaultValue="LIVE">
            <option value="IDEA">想法</option>
            <option value="BUILDING">开发中</option>
            <option value="LIVE">已上线</option>
            <option value="PAUSED">暂停</option>
            <option value="ARCHIVED">归档</option>
          </select>
        </Field>
      </div>
      <Field label="产品说明">
        <textarea
          name="description"
          rows={3}
          maxLength={600}
          placeholder="它为谁解决什么问题？"
        />
      </Field>
      <Field label="当前重点">
        <input name="currentFocus" maxLength={300} placeholder="例如：验证英文自然搜索流量" />
      </Field>
      <Field label="网址（可选）">
        <input name="url" type="url" placeholder="https://…" />
      </Field>
      {error && <div className="form-error">{error}</div>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="保存产品" />
    </form>
  );
}
