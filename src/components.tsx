import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, LoaderCircle, X } from "lucide-react";
import type {
  Opportunity,
  Platform,
  ResearchStatus,
  Verdict,
} from "../shared/types";
import { platformLabels, verdictLabels } from "./format";

export function Score({
  value,
  status = "READY",
  size = "normal",
}: {
  value: number;
  status?: ResearchStatus;
  size?: "normal" | "large";
}) {
  if (status !== "READY") {
    const label = researchStatusLabels[status];
    return (
      <div
        className={`score score--${size} score--pending`}
        aria-label={label}
      >
        <span>—</span>
        <small>{label}</small>
      </div>
    );
  }
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

const researchStatusLabels: Record<ResearchStatus, string> = {
  UNRESEARCHED: "待调研",
  RUNNING: "调研中",
  FAILED: "调研失败",
  READY: "结论有效",
};

export function ResearchStatusBadge({ status }: { status: ResearchStatus }) {
  return (
    <span className={`research-status research-status--${status.toLowerCase()}`}>
      {researchStatusLabels[status]}
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
    <div className="loading-state" role="status" aria-live="polite">
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
    <div className="error-state" role="alert">
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
  const titleId = useId();
  const descriptionId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    document.body.classList.add("modal-open");
    const focusFrame = window.requestAnimationFrame(() => {
      const formField = modalRef.current?.querySelector<HTMLElement>(
        "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), [autofocus]",
      );
      const fallback = modalRef.current?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      (formField ?? fallback ?? modalRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hidden);
      if (!focusable.length) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("modal-open");
      if (root) root.inert = false;
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>
            <span className="eyebrow">ADD TO RADAR</span>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={descriptionId}>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
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
        <Score
          value={item.score}
          status={item.decisionCurrent ? "READY" : item.researchStatus}
        />
        <div className="opportunity-compact__body">
          <strong>{item.name}</strong>
          <span>{item.oneLiner}</span>
        </div>
        <div className="opportunity-compact__meta">
          {item.decisionCurrent ? <Delta value={item.scoreDelta} /> : null}
          {item.decisionCurrent ? (
            <VerdictBadge verdict={item.verdict} />
          ) : (
            <ResearchStatusBadge status={item.researchStatus} />
          )}
        </div>
      </button>
    );
  }

  return (
    <tr className="clickable-row">
      <td>
        <Score
          value={item.score}
          status={item.decisionCurrent ? "READY" : item.researchStatus}
        />
      </td>
      <td className="opportunity-name">
        <button className="opportunity-name-button" onClick={onClick}>
          <strong>{item.name}</strong>
          <span>{item.oneLiner}</span>
        </button>
      </td>
      <td>
        {item.decisionCurrent ? (
          <VerdictBadge verdict={item.verdict} />
        ) : (
          <ResearchStatusBadge status={item.researchStatus} />
        )}
      </td>
      <td>
        <PlatformBadge platform={item.recommendedPlatform} />
      </td>
      <td>
        {item.decisionCurrent ? <Delta value={item.scoreDelta} /> : <span className="muted">—</span>}
      </td>
      <td className="mono muted">
        {item.decisionCurrent ? `${item.confidence}%` : "—"}
      </td>
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
