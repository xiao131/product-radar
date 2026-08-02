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
  WorkflowStatus,
} from "../shared/types";
import { platformLabels } from "./format";
import {
  marketName,
  opportunityForLocale,
  useI18n,
} from "./i18n";

export function Score({
  value,
  status = "READY",
  size = "normal",
}: {
  value: number;
  status?: ResearchStatus;
  size?: "normal" | "large";
}) {
  const { t } = useI18n();
  if (status !== "READY") {
    const label: string = {
      UNRESEARCHED: t("待调研", "Not researched"),
      RUNNING: t("调研中", "Researching"),
      FAILED: t("调研失败", "Research failed"),
      READY: t("结论有效", "Decision current"),
    }[status];
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
    <div className={`score score--${size}`} aria-label={`${t("评分", "Score")} ${value}`}>
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
  const { t } = useI18n();
  const labels: Record<Verdict, string> = {
    BUILD_NOW: t("现在开发", "Build now"),
    VALIDATE_FIRST: t("先验证", "Validate first"),
    WATCH: t("继续观察", "Watch"),
    SKIP: t("暂不开发", "Skip"),
  };
  return (
    <span className={`verdict verdict--${verdict.toLowerCase()}`}>
      {labels[verdict]}
    </span>
  );
}

export function ResearchStatusBadge({ status }: { status: ResearchStatus }) {
  const { t } = useI18n();
  const labels: Record<ResearchStatus, string> = {
    UNRESEARCHED: t("待调研", "Not researched"),
    RUNNING: t("调研中", "Researching"),
    FAILED: t("调研失败", "Research failed"),
    READY: t("结论有效", "Decision current"),
  };
  return (
    <span className={`research-status research-status--${status.toLowerCase()}`}>
      {labels[status]}
    </span>
  );
}

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  const { t } = useI18n();
  const labels: Record<WorkflowStatus, string> = {
    UNDECIDED: t("待决定", "Undecided"),
    VALIDATING: t("验证中", "Validating"),
    APPROVED: t("已批准开发", "Approved"),
    WATCHING: t("观察中", "Watching"),
    REJECTED: t("已放弃", "Rejected"),
  };
  return (
    <span className={`workflow-status workflow-status--${status.toLowerCase()}`}>
      {labels[status]}
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

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={20} />
      <span>{label ?? t("正在读取雷达数据", "Loading radar data")}</span>
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
  const { t } = useI18n();
  return (
    <div className="error-state" role="alert">
      <strong>{t("这次读取没有成功", "This request did not succeed")}</strong>
      <span>{message}</span>
      {retry && (
        <button className="button button--secondary button--small" onClick={retry}>
          {t("重新加载", "Reload")}
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
  const { t } = useI18n();
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
            <span className="eyebrow">{t("加入雷达", "ADD TO RADAR")}</span>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={descriptionId}>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t("关闭", "Close")}>
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
  const { locale, t } = useI18n();
  const copy = opportunityForLocale(item, locale);
  const marketAssessmentMissing = Boolean(
    item.selectedMarketCode && !item.selectedMarketAssessment,
  );
  const score = item.selectedMarketAssessment?.score ?? item.score;
  const confidence = item.selectedMarketAssessment?.confidence ?? item.confidence;
  if (compact) {
    return (
      <button className="opportunity-compact" onClick={onClick}>
        <Score
          value={score}
          status={marketAssessmentMissing ? "UNRESEARCHED" : item.decisionCurrent ? "READY" : item.researchStatus}
        />
        <div className="opportunity-compact__body">
          <strong>{copy.name}</strong>
          <span>{copy.oneLiner}</span>
        </div>
        <div className="opportunity-compact__meta">
          {item.decisionCurrent && !marketAssessmentMissing ? <Delta value={item.scoreDelta} /> : null}
          {item.decisionCurrent && !marketAssessmentMissing ? (
            <VerdictBadge verdict={item.selectedMarketAssessment?.verdict ?? item.verdict} />
          ) : (
            <ResearchStatusBadge
              status={marketAssessmentMissing ? "UNRESEARCHED" : item.researchStatus}
            />
          )}
        </div>
      </button>
    );
  }

  return (
    <tr className="clickable-row">
      <td>
        <Score
          value={score}
          status={marketAssessmentMissing ? "UNRESEARCHED" : item.decisionCurrent ? "READY" : item.researchStatus}
        />
      </td>
      <td className="opportunity-name">
        <button className="opportunity-name-button" onClick={onClick}>
          <strong>{copy.name}</strong>
          <span>{copy.oneLiner}</span>
          {item.selectedMarketCode && (
            <small className="opportunity-market-name">
              {marketName(item.selectedMarketCode, locale)}
              {marketAssessmentMissing ? ` · ${t("待市场调研", "market research pending")}` : ""}
            </small>
          )}
        </button>
      </td>
      <td>
        {item.decisionCurrent && !marketAssessmentMissing ? (
          <VerdictBadge verdict={item.selectedMarketAssessment?.verdict ?? item.verdict} />
        ) : (
          <ResearchStatusBadge
            status={marketAssessmentMissing ? "UNRESEARCHED" : item.researchStatus}
          />
        )}
      </td>
      <td>
        <PlatformBadge platform={item.recommendedPlatform} />
      </td>
      <td>
        {item.decisionCurrent && !marketAssessmentMissing ? <Delta value={item.scoreDelta} /> : <span className="muted">—</span>}
      </td>
      <td className="mono muted">
        {item.decisionCurrent && !marketAssessmentMissing ? `${confidence}%` : "—"}
      </td>
      <td>
        <button className="button button--secondary button--small" onClick={onClick}>
          {marketAssessmentMissing
            ? t("调研该市场", "Research market")
            : item.workflowStatus !== "UNDECIDED"
            ? t("查看执行", "View execution")
            : item.researchStatus === "RUNNING"
              ? t("查看进度", "View progress")
              : item.researchStatus === "FAILED"
                ? t("重试调研", "Retry research")
                : item.researchStatus === "UNRESEARCHED"
                  ? t("去调研", "Research")
                  : t("处理决策", "Decide")}
        </button>
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
  const { t } = useI18n();
  return (
    <div className="form-actions">
      <button type="button" className="button button--ghost" onClick={onCancel}>
        {t("取消", "Cancel")}
      </button>
      <button type="submit" className="button button--primary" disabled={saving}>
        {saving && <LoaderCircle className="spin" size={16} />}
        {saving ? t("保存中", "Saving") : submitLabel}
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
