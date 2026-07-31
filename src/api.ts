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
    let message = `请求失败（${response.status}）`;
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
    throw new ApiError(message, response.status, code, details);
  }

  return response.json() as Promise<T>;
}
