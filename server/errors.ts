export function readableAiError(error: unknown) {
  const raw = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  const name = error instanceof Error ? error.name : "";
  const normalized = raw.toLowerCase();

  if (
    !raw ||
    raw === "<none>" ||
    normalized === "ai_apicallerror: <none>" ||
    normalized.includes("no response body")
  ) {
    return "AI 中转在生成过程中断开，未返回可读错误；系统已保留原始信号，请减小每批信号数后重试。";
  }
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("aborted")
  ) {
    return "AI 请求超时，尚未完成归并；系统已保留原始信号，可在调整超时或批次后重试。";
  }
  if (normalized.includes("billing service temporarily unavailable")) {
    return "AI 中转计费服务暂时不可用，重试后仍然失败。";
  }
  if (normalized.includes("service temporarily unavailable")) {
    return "AI 服务暂时不可用，重试后仍然失败。";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "AI 上游请求过多，重试后仍被限流。";
  }
  return raw;
}
