import type { UiLocale } from "../shared/types";

const jobTypeLabels: Record<string, [string, string]> = {
  DISCOVERY: ["自动发现", "Automatic discovery"],
  RESEARCH: ["多维调研", "Multi-dimensional research"],
  BACKUP: ["数据备份", "Data backup"],
};

const jobTriggerLabels: Record<string, [string, string]> = {
  manual: ["手动执行", "Manual"],
  scheduled: ["定时执行", "Scheduled"],
  cli: ["命令行执行", "Command line"],
};

const jobStatusLabels: Record<string, [string, string]> = {
  RUNNING: ["运行中", "Running"],
  COMPLETED: ["已完成", "Completed"],
  PARTIAL: ["部分失败", "Partially failed"],
  FAILED: ["失败", "Failed"],
  SKIPPED: ["已跳过", "Skipped"],
};

function localized(value: [string, string] | undefined, fallback: string, locale: UiLocale) {
  return value?.[locale === "zh-CN" ? 0 : 1] ?? fallback;
}

export function jobTypeLabel(value: string, locale: UiLocale = "zh-CN") {
  return localized(jobTypeLabels[value], value, locale);
}

export function jobTriggerLabel(value: string, locale: UiLocale = "zh-CN") {
  return localized(jobTriggerLabels[value], value, locale);
}

export function jobStatusLabel(value: string, locale: UiLocale = "zh-CN") {
  return localized(jobStatusLabels[value], value, locale);
}

export function jobErrorLabel(value: string, locale: UiLocale = "zh-CN") {
  const text = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  if (!value.trim() || value.trim() === "<none>" || value.includes("AI_APICallError: <none>")) {
    return text("AI 中转在生成过程中断开，未返回可读错误；请减小每批信号数后重试", "The AI relay disconnected during generation without a readable error. Reduce the batch size and retry.");
  }
  if (value.includes("Billing service temporarily unavailable")) {
    return text("AI 中转计费服务暂时不可用，重试后仍然失败", "The AI relay billing service remained unavailable after retries.");
  }
  if (value.includes("Service temporarily unavailable")) {
    return text("AI 服务暂时不可用，重试后仍然失败", "The AI service remained unavailable after retries.");
  }
  if (value.includes("rate limit")) {
    return text("AI 上游请求过多，重试后仍被限流", "The upstream AI service is still rate-limiting requests after retries.");
  }
  if (value.includes("timeout") || value.includes("aborted")) {
    return text("AI 请求超时，尚未完成归并", "The AI request timed out before clustering completed.");
  }
  if (value.includes("AI budget") || value.includes("AI 调研预算")) {
    return text("今日 AI 调用预算已用完", "Today's AI request budget has been exhausted.");
  }
  return value;
}
