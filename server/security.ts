import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { MIN_ADMIN_PASSWORD_LENGTH } from "../shared/auth.js";
import type { AppConfig } from "./config.js";
import type { RadarDatabase } from "./db.js";
import { logEvent } from "./logger.js";

const scrypt = promisify(scryptCallback);
const sessionCookie = "product_radar_session";
const csrfCookie = "product_radar_csrf";
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, "账号只能包含字母、数字、点、下划线或连字符")
  .transform((value) => value.toLowerCase());
const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(300),
});
const accountUpdateSchema = z.object({
  username: usernameSchema,
  currentPassword: z.string().min(1).max(300),
  newPassword: z.string().min(MIN_ADMIN_PASSWORD_LENGTH).max(300).optional(),
});

interface SessionPayload {
  version: 2;
  userId: number;
  sessionVersion: number;
  expiresAt: number;
  csrfToken: string;
}

interface AdminAccountRow {
  id: number;
  username: string;
  password_hash: string;
  session_version: number;
  created_at: string;
  updated_at: string;
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

export function normalizeAdminUsername(username: string) {
  return usernameSchema.parse(username);
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
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `生产管理员密码至少需要 ${MIN_ADMIN_PASSWORD_LENGTH} 个字符`,
    );
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
      payload.version !== 2 ||
      payload.userId !== 1 ||
      !Number.isInteger(payload.sessionVersion) ||
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

export function createSecurity(config: AppConfig, db: RadarDatabase) {
  function account() {
    return db
      .prepare("SELECT * FROM admin_account WHERE id = 1")
      .get() as AdminAccountRow | undefined;
  }

  function ensureAccount() {
    let current = account();
    if (!current && config.adminPasswordHash) {
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO admin_account (
           id, username, password_hash, session_version, created_at, updated_at
         ) VALUES (1, ?, ?, 1, ?, ?)`,
      ).run(
        normalizeAdminUsername(config.adminUsername),
        config.adminPasswordHash,
        createdAt,
        createdAt,
      );
      current = account();
    }
    if (config.authRequired && !current) {
      throw new Error(
        "尚未创建管理员账号，请先配置 ADMIN_PASSWORD_HASH 或运行 npm run auth:reset",
      );
    }
    if (config.authRequired && !config.sessionSecret) {
      throw new Error("启用账号登录时必须配置 SESSION_SECRET");
    }
    return current;
  }

  ensureAccount();

  function authenticatedSession(request: Request) {
    const payload = readSession(request, config.sessionSecret);
    if (!payload) return null;
    const current = account();
    if (
      !current ||
      current.id !== payload.userId ||
      current.session_version !== payload.sessionVersion
    ) {
      return null;
    }
    return { payload, account: current };
  }

  function newSessionPayload(current: AdminAccountRow): SessionPayload {
    return {
      version: 2,
      userId: current.id,
      sessionVersion: current.session_version,
      expiresAt: Date.now() + config.sessionTtlHours * 60 * 60 * 1_000,
      csrfToken: randomBytes(24).toString("base64url"),
    };
  }

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
    const session = authenticatedSession(request);
    response.json({
      authenticated: Boolean(session),
      authRequired: true,
      csrfToken: session?.payload.csrfToken ?? null,
      expiresAt: session?.payload.expiresAt ?? null,
      username: session?.account.username ?? null,
    });
  }

  async function login(request: Request, response: Response) {
    if (!config.authRequired) {
      response.json({ authenticated: true, authRequired: false, csrfToken: null });
      return;
    }
    const { username, password } = loginSchema.parse(request.body);
    const current = account();
    const passwordValid = current
      ? await verifyPassword(password, current.password_hash)
      : false;
    const valid = current?.username.toLowerCase() === username && passwordValid;
    if (!valid) {
      logEvent("warn", "login_failed", {
        requestId: response.locals.requestId,
        clientIp: request.ip,
      });
      response.status(401).json({ error: "账号或密码不正确" });
      return;
    }
    const payload = newSessionPayload(current!);
    setSessionCookies(response, config, payload);
    response.json({
      authenticated: true,
      authRequired: true,
      csrfToken: payload.csrfToken,
      expiresAt: payload.expiresAt,
      username: current!.username,
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
    const session = authenticatedSession(request);
    if (!session) {
      response.status(401).json({ error: "请先登录" });
      return;
    }
    response.locals.session = session.payload;
    response.locals.account = session.account;
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

  function accountResponse(_request: Request, response: Response) {
    const current = account();
    const configured = config.authRequired && Boolean(current);
    response.json({
      configured,
      username: configured ? current!.username : null,
      updatedAt: configured ? current!.updated_at : null,
    });
  }

  async function updateAccount(request: Request, response: Response) {
    const current = response.locals.account as AdminAccountRow | undefined;
    if (!current) {
      response.status(409).json({ error: "账号登录尚未启用" });
      return;
    }
    const input = accountUpdateSchema.parse(request.body);
    if (!(await verifyPassword(input.currentPassword, current.password_hash))) {
      response.status(400).json({ error: "当前密码不正确" });
      return;
    }
    const changedUsername = input.username !== current.username.toLowerCase();
    if (!changedUsername && !input.newPassword) {
      response.status(400).json({ error: "账号或密码没有变化" });
      return;
    }
    const passwordHash = input.newPassword
      ? await hashPassword(input.newPassword)
      : current.password_hash;
    const updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE admin_account
       SET username = ?, password_hash = ?,
           session_version = session_version + 1, updated_at = ?
       WHERE id = 1`,
    ).run(input.username, passwordHash, updatedAt);
    const updated = account()!;
    const payload = newSessionPayload(updated);
    setSessionCookies(response, config, payload);
    logEvent("info", "admin_account_updated", {
      requestId: response.locals.requestId,
      usernameChanged: changedUsername,
      passwordChanged: Boolean(input.newPassword),
    });
    response.json({
      configured: true,
      username: updated.username,
      updatedAt: updated.updated_at,
    });
  }

  return {
    loginRateLimiter,
    requestRateLimiter,
    sessionResponse,
    login,
    logout,
    accountResponse,
    updateAccount,
    requireAuthentication,
    requireCsrf,
  };
}
