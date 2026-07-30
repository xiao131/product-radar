import { type FormEvent, type ReactNode, useEffect } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, X } from "lucide-react";
import type { Opportunity, Platform, Verdict } from "../shared/types";
import { platformLabels, verdictLabels } from "./format";

export function Score({ value, size = "normal" }: { value: number; size?: "normal" | "large" }) {
  return (
    <div className={`score score--${size}`} aria-label={`评分 ${value}`}>
      <span>{value}</span>
      <small>/100</small>
    </div>
  );
}

export function Delta({ value }: { value: number }) {
  if (!value) return <span className="delta delta--flat">— 0</span>;
  const positive = value > 0;
  return (
    <span className={`delta ${positive ? "delta--up" : "delta--down"}`}>
      {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(value)}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`verdict verdict--${verdict.toLowerCase()}`}>
      {verdictLabels[verdict]}
    </span>
  );
}

export function PlatformBadge({ platform }: { platform: Platform }) {
  return <span className="platform-badge">{platformLabels[platform]}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark">0</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "正在读取雷达数据" }: { label?: string }) {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state">
      <strong>这次读取没有成功</strong>
      <span>{message}</span>
      {retry && (
        <button className="button button--secondary button--small" onClick={retry}>
          重新加载
        </button>
      )}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  open,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <span className="eyebrow">ADD TO RADAR</span>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function OpportunityRow({
  item,
  onClick,
  compact = false,
}: {
  item: Opportunity;
  onClick: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button className="opportunity-compact" onClick={onClick}>
        <Score value={item.score} />
        <div className="opportunity-compact__body">
          <strong>{item.name}</strong>
          <span>{item.oneLiner}</span>
        </div>
        <div className="opportunity-compact__meta">
          <Delta value={item.scoreDelta} />
          <VerdictBadge verdict={item.verdict} />
        </div>
      </button>
    );
  }

  return (
    <tr className="clickable-row" onClick={onClick}>
      <td>
        <Score value={item.score} />
      </td>
      <td className="opportunity-name">
        <strong>{item.name}</strong>
        <span>{item.oneLiner}</span>
      </td>
      <td>
        <VerdictBadge verdict={item.verdict} />
      </td>
      <td>
        <PlatformBadge platform={item.recommendedPlatform} />
      </td>
      <td>
        <Delta value={item.scoreDelta} />
      </td>
      <td className="mono muted">{item.confidence}%</td>
    </tr>
  );
}

export function FormActions({
  saving,
  onCancel,
  submitLabel,
}: {
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="form-actions">
      <button type="button" className="button button--ghost" onClick={onCancel}>
        取消
      </button>
      <button type="submit" className="button button--primary" disabled={saving}>
        {saving && <LoaderCircle className="spin" size={16} />}
        {saving ? "保存中" : submitLabel}
      </button>
    </div>
  );
}

export function stopInvalidForm(event: FormEvent<HTMLFormElement>) {
  if (!event.currentTarget.checkValidity()) {
    event.preventDefault();
    event.currentTarget.reportValidity();
    return true;
  }
  return false;
}
