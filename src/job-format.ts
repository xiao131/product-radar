const jobTypeLabels: Record<string, string> = {
  DISCOVERY: "自动发现",
  RESEARCH: "多维调研",
  BACKUP: "数据备份",
};

const jobTriggerLabels: Record<string, string> = {
  manual: "手动执行",
  scheduled: "定时执行",
  cli: "命令行执行",
};

const jobStatusLabels: Record<string, string> = {
  RUNNING: "运行中",
  COMPLETED: "已完成",
  PARTIAL: "部分失败",
  FAILED: "失败",
};

export function jobTypeLabel(value: string) {
  return jobTypeLabels[value] ?? value;
}

export function jobTriggerLabel(value: string) {
  return jobTriggerLabels[value] ?? value;
}

export function jobStatusLabel(value: string) {
  return jobStatusLabels[value] ?? value;
}

export function jobErrorLabel(value: string) {
  if (!value.trim() || value.trim() === "<none>" || value.includes("AI_APICallError: <none>")) {
    return "AI 中转在生成过程中断开，未返回可读错误；请减小每批信号数后重试";
  }
  if (value.includes("Billing service temporarily unavailable")) {
    return "AI 中转计费服务暂时不可用，重试后仍然失败";
  }
  if (value.includes("Service temporarily unavailable")) {
    return "AI 服务暂时不可用，重试后仍然失败";
  }
  if (value.includes("rate limit")) {
    return "AI 上游请求过多，重试后仍被限流";
  }
  if (value.includes("timeout") || value.includes("aborted")) {
    return "AI 请求超时，尚未完成归并";
  }
  if (value.includes("AI budget") || value.includes("AI 调研预算")) {
    return "今日 AI 调用预算已用完";
  }
  return value;
}
