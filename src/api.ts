export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface DataForSeoBudgetConfirmationDetails {
  usedTasks: number;
  taskLimit: number;
  estimatedAdditionalTasks: number;
  projectedTasks: number;
  currentCostUsd: number;
  estimatedAdditionalCostUsd: number;
  projectedCostUsd: number;
  dailyCostLimitUsd: number;
}

export function dataForSeoBudgetConfirmation(
  error: unknown,
): DataForSeoBudgetConfirmationDetails | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== "DATAFORSEO_TASK_BUDGET_CONFIRMATION_REQUIRED" ||
    !error.details ||
    typeof error.details !== "object"
  ) {
    return null;
  }
  return error.details as DataForSeoBudgetConfirmationDetails;
}

function cookieValue(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function messageForLocale(message: string, status: number) {
  if (document.documentElement.lang !== "en" || !/\p{Script=Han}/u.test(message)) {
    return message;
  }
  const known: Record<string, string> = {
    "账号或密码错误": "Incorrect username or password",
    "输入内容不符合要求": "The submitted data is invalid",
    "找不到这个候选产品": "Candidate not found",
    "找不到这条信号": "Signal not found",
    "找不到这个任务": "Job not found",
    "候选完成首次调研后才能更新人工决策": "Complete the first research run before changing the human decision",
    "服务器发生未知错误": "The server encountered an unknown error",
  };
  if (known[message]) return known[message];
  if (message.includes("任务已经在运行") || message.includes("正在调研")) {
    return "This job is already running";
  }
  if (message.includes("预算") || message.includes("上限")) {
    return "The configured usage budget has been reached";
  }
  if (message.includes("AI") || message.includes("中转")) {
    return "The AI request failed; review the job details and retry";
  }
  const fallbacks: Record<number, string> = {
    400: "The request is invalid",
    401: "Authentication is required or the credentials are incorrect",
    403: "This request is not allowed",
    404: "The requested item was not found",
    409: "The request conflicts with the current state",
    429: "Too many requests; try again later",
    500: "The server could not complete the request",
    502: "An upstream service could not complete the request",
    503: "The service is temporarily unavailable",
  };
  return fallbacks[status] ?? `Request failed (${status})`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const csrfToken = cookieValue("product_radar_csrf");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
        ? { "X-CSRF-Token": decodeURIComponent(csrfToken) }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = document.documentElement.lang === "en"
      ? `Request failed (${response.status})`
      : `请求失败（${response.status}）`;
    let code: string | undefined;
    let details: unknown;
    try {
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        details?: unknown;
      };
      if (body.error) message = body.error;
      code = body.code;
      details = body.details;
    } catch {
      // Keep the status-based fallback.
    }
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("product-radar:unauthorized"));
    }
    throw new ApiError(messageForLocale(message, response.status), response.status, code, details);
  }

  return response.json() as Promise<T>;
}
