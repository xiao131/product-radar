import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type LogLevel = "info" | "warn" | "error";

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
) {
  const record = {
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const output = JSON.stringify(record);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export function requestLogger(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const requestId = request.get("X-Request-ID")?.slice(0, 120) || randomUUID();
  const startedAt = performance.now();
  response.setHeader("X-Request-ID", requestId);
  response.locals.requestId = requestId;
  response.on("finish", () => {
    logEvent("info", "http_request", {
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      clientIp: request.ip,
    });
  });
  next();
}
