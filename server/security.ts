import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { logEvent } from "./logger.js";

const scrypt = promisify(scryptCallback);
const sessionCookie = "product_radar_session";
const csrfCookie = "product_radar_csrf";
const passwordSchema = z.object({
  password: z.string().min(1).max(300),
});

interface SessionPayload {
  version: 1;
  expiresAt: number;
  csrfToken: string;
}

interface RateState {
  count: number;
  resetAt: number;
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function cookies(request: Request) {
  const parsed = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      parsed.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed untrusted cookie values.
    }
  }
  return parsed;
}

export async function hashPassword(password: string) {
  if (password.length < 12) {
    throw new Error("生产管理员密码至少需要 12 个字符");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${encode(salt)}$${encode(derived)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  try {
    const [algorithm, encodedSalt, encodedDerived] = encodedHash.split("$");
    if (algorithm !== "scrypt" || !encodedSalt || !encodedDerived) return false;
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedDerived, "base64url");
    if (!salt.length || !expected.length) return false;
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function signSession(payload: SessionPayload, secret: string) {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readSession(request: Request, secret: string | undefined) {
  if (!secret) return null;
  const token = cookies(request).get(sessionCookie);
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      payload.version !== 1 ||
      !payload.csrfToken ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookies(
  response: Response,
  config: AppConfig,
  payload: SessionPayload,
) {
  const secure = config.appEnv === "production";
  const common = {
    secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.max(0, payload.expiresAt - Date.now()),
  };
  response.cookie(
    sessionCookie,
    signSession(payload, config.sessionSecret!),
    { ...common, httpOnly: true },
  );
  response.cookie(csrfCookie, payload.csrfToken, {
    ...common,
    httpOnly: false,
  });
}

function clearSessionCookies(response: Response, config: AppConfig) {
  const options = {
    secure: config.appEnv === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  response.clearCookie(sessionCookie, options);
  response.clearCookie(csrfCookie, options);
}

export function fixedWindowRateLimiter(
  limit: number,
  windowMs: number,
  scope: string,
) {
  const clients = new Map<string, RateState>();
  return (request: Request, response: Response, next: NextFunction) => {
    const currentTime = Date.now();
    const key = `${scope}:${request.ip || request.socket.remoteAddress || "unknown"}`;
    const existing = clients.get(key);
    const state =
      !existing || existing.resetAt <= currentTime
        ? { count: 0, resetAt: currentTime + windowMs }
        : existing;
    state.count += 1;
    clients.set(key, state);
    if (clients.size > 1_000) {
      for (const [client, entry] of clients) {
        if (entry.resetAt <= currentTime) clients.delete(client);
      }
    }
    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, limit - state.count)),
    );
    if (state.count > limit) {
      response.setHeader(
        "Retry-After",
        String(Math.ceil((state.resetAt - currentTime) / 1_000)),
      );
      response.status(429).json({ error: "请求过于频繁，请稍后再试" });
      return;
    }
    next();
  };
}

export function createSecurity(config: AppConfig) {
  const loginRateLimiter = fixedWindowRateLimiter(
    config.loginRateLimitPer15Minutes,
    15 * 60 * 1_000,
    "login",
  );
  const requestRateLimiter = fixedWindowRateLimiter(
    config.requestRateLimitPerMinute,
    60 * 1_000,
    "api",
  );

  function sessionResponse(request: Request, response: Response) {
    if (!config.authRequired) {
      response.json({
        authenticated: true,
        authRequired: false,
        csrfToken: null,
      });
      return;
    }
    const session = readSession(request, config.sessionSecret);
    response.json({
      authenticated: Boolean(session),
      authRequired: true,
      csrfToken: session?.csrfToken ?? null,
      expiresAt: session?.expiresAt ?? null,
    });
  }

  async function login(request: Request, response: Response) {
    if (!config.authRequired) {
      response.json({ authenticated: true, authRequired: false, csrfToken: null });
      return;
    }
    const { password } = passwordSchema.parse(request.body);
    const valid =
      Boolean(config.adminPasswordHash) &&
      (await verifyPassword(password, config.adminPasswordHash!));
    if (!valid) {
      logEvent("warn", "login_failed", {
        requestId: response.locals.requestId,
        clientIp: request.ip,
      });
      response.status(401).json({ error: "密码不正确" });
      return;
    }
    const payload: SessionPayload = {
      version: 1,
      expiresAt: Date.now() + config.sessionTtlHours * 60 * 60 * 1_000,
      csrfToken: randomBytes(24).toString("base64url"),
    };
    setSessionCookies(response, config, payload);
    response.json({
      authenticated: true,
      authRequired: true,
      csrfToken: payload.csrfToken,
      expiresAt: payload.expiresAt,
    });
  }

  function requireAuthentication(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (!config.authRequired) {
      next();
      return;
    }
    const session = readSession(request, config.sessionSecret);
    if (!session) {
      response.status(401).json({ error: "请先登录" });
      return;
    }
    response.locals.session = session;
    next();
  }

  function requireCsrf(request: Request, response: Response, next: NextFunction) {
    if (!config.authRequired || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }
    const session = response.locals.session as SessionPayload | undefined;
    const csrfHeader = request.get("X-CSRF-Token");
    const csrfCookieValue = cookies(request).get(csrfCookie);
    const origin = request.get("Origin");
    if (
      !session ||
      !csrfHeader ||
      !csrfCookieValue ||
      !safeEqual(csrfHeader, session.csrfToken) ||
      !safeEqual(csrfCookieValue, session.csrfToken) ||
      (origin && origin !== config.publicOrigin)
    ) {
      response.status(403).json({ error: "请求安全校验失败，请刷新页面后重试" });
      return;
    }
    next();
  }

  function logout(request: Request, response: Response) {
    clearSessionCookies(response, config);
    response.json({ authenticated: false, authRequired: config.authRequired });
  }

  return {
    loginRateLimiter,
    requestRateLimiter,
    sessionResponse,
    login,
    logout,
    requireAuthentication,
    requireCsrf,
  };
}
