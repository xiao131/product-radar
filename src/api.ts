export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
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
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based fallback.
    }
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("product-radar:unauthorized"));
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}
