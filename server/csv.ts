import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { createSignalSchema } from "../shared/schemas.js";
import type {
  ContentLanguage,
  Platform,
  Product,
  SignalSource,
} from "../shared/types.js";
import { languageFromMarket } from "../shared/localization.js";

interface CsvRecord {
  cells: string[];
  line: number;
}

function parseRecords(csv: string): CsvRecord[] {
  const source = csv.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const pushRecord = () => {
    cells.push(value);
    if (cells.some((cell) => cell.trim())) {
      records.push({ cells, line: recordLine });
    }
    cells = [];
    value = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      cells.push(value);
      value = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      value += "\n";
      line += 1;
      continue;
    }
    value += character;
  }

  if (quoted) throw new Error(`CSV 第 ${recordLine} 行存在未闭合的引号`);
  if (cells.length || value) pushRecord();
  return records;
}

export interface ImportedSignal {
  sourceType: SignalSource;
  title: string;
  content: string;
  sourceUrl: string | null;
  tags: string[];
  market: string | null;
  originalLanguage: ContentLanguage;
  sourceName: string | null;
  collectedAt: string | null;
  externalId: string | null;
  fingerprint: string;
  contentFingerprint: string;
}

export interface ImportedProduct {
  name: string;
  platform: Platform;
  status: Product["status"];
  url: string | null;
  description: string;
  currentFocus: string;
}

export interface ParsedCsvRow<T> {
  line: number;
  values: Record<string, string>;
  value: T | null;
  messages: string[];
}

export interface ParsedCsv<T> {
  columns: string[];
  rows: ParsedCsvRow<T>[];
  issues: Array<{ line: number | null; field?: string; message: string }>;
}

const signalHeaders = new Map([
  ["title", "title"],
  ["content", "content"],
  ["source_type", "source_type"],
  ["source", "source_type"],
  ["source_url", "source_url"],
  ["url", "source_url"],
  ["tags", "tags"],
  ["market", "market"],
  ["original_language", "original_language"],
  ["language", "original_language"],
  ["source_name", "source_name"],
  ["collected_at", "collected_at"],
  ["external_id", "external_id"],
]);

const productHeaders = new Map([
  ["name", "name"],
  ["platform", "platform"],
  ["status", "status"],
  ["url", "url"],
  ["description", "description"],
  ["current_focus", "current_focus"],
  ["focus", "current_focus"],
]);

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseTable(
  csv: string,
  allowedHeaders: Map<string, string>,
  requiredHeaders: string[],
): ParsedCsv<never> {
  let records: CsvRecord[];
  try {
    records = parseRecords(csv);
  } catch (error) {
    return {
      columns: [],
      rows: [],
      issues: [{
        line: null,
        message: error instanceof Error ? error.message : "CSV 无法解析",
      }],
    };
  }
  if (!records.length) {
    return {
      columns: [],
      rows: [],
      issues: [{ line: null, message: "CSV 不能为空" }],
    };
  }

  const issues: ParsedCsv<never>["issues"] = [];
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const header of records[0].cells) {
    const normalized = normalizeHeader(header);
    const canonical = allowedHeaders.get(normalized);
    if (!normalized) {
      issues.push({ line: records[0].line, message: "CSV 表头包含空列" });
      columns.push("");
      continue;
    }
    if (!canonical) {
      issues.push({
        line: records[0].line,
        field: normalized,
        message: `CSV 包含不支持的列：${normalized}`,
      });
      columns.push(normalized);
      continue;
    }
    if (seen.has(canonical)) {
      issues.push({
        line: records[0].line,
        field: canonical,
        message: `CSV 表头包含重复列：${canonical}`,
      });
    }
    seen.add(canonical);
    columns.push(canonical);
  }
  for (const field of requiredHeaders) {
    if (!seen.has(field)) {
      issues.push({ line: records[0].line, field, message: `CSV 缺少 ${field} 列` });
    }
  }
  if (records.length < 2) {
    issues.push({ line: null, message: "CSV 至少需要一行数据" });
  }
  if (records.length - 1 > 5_000) {
    issues.push({ line: null, message: "单次最多导入 5000 行数据" });
  }

  const rows = records.slice(1, 5_001).map((record): ParsedCsvRow<never> => {
    const values = Object.fromEntries(
      columns
        .map((column, index) => [column, record.cells[index] ?? ""] as const)
        .filter(([column]) => Boolean(column)),
    );
    const messages: string[] = [];
    if (record.cells.length > columns.length) {
      messages.push("数据列数超过表头列数");
    }
    return { line: record.line, values, value: null, messages };
  });
  return { columns: [...seen], rows, issues };
}

function normalizedIdentityText(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

function hashIdentity(values: string[]) {
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

export function signalImportFingerprint(input: {
  sourceType: string;
  title: string;
  content: string;
  sourceUrl?: string | null;
  externalId?: string | null;
}) {
  if (input.externalId?.trim()) {
    return hashIdentity([
      "CSV_EXTERNAL",
      input.sourceType,
      normalizedIdentityText(input.externalId),
    ]);
  }
  return hashIdentity([
    input.sourceType,
    input.sourceUrl ?? "",
    normalizedIdentityText(input.title).replace(/[^\p{Letter}\p{Number}]+/gu, ""),
    normalizedIdentityText(input.content),
  ]);
}

export function productImportKey(input: {
  name: string;
  platform: string;
  url?: string | null;
}) {
  if (input.url?.trim()) {
    try {
      const url = new URL(input.url);
      url.hash = "";
      return `url:${url.toString().replace(/\/$/, "").toLocaleLowerCase()}`;
    } catch {
      return `url:${normalizedIdentityText(input.url)}`;
    }
  }
  return `name:${input.platform}:${normalizedIdentityText(input.name)}`;
}

function collectedAt(value: string) {
  const input = value.trim();
  if (!input) return { value: null, message: "" };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T00:00:00.000Z`)
    : new Date(input);
  if (!Number.isFinite(date.getTime())) {
    return { value: null, message: "collected_at 必须是 YYYY-MM-DD 或 ISO 8601 日期" };
  }
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1_000) {
    return { value: null, message: "collected_at 不能是未来日期" };
  }
  return { value: date.toISOString(), message: "" };
}

function csvZodMessages(error: ZodError) {
  return error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "内容");
    if (field === "sourceType") {
      return "source_type 不在支持范围内";
    }
    if (field === "originalLanguage") {
      return "original_language 仅支持 zh-CN、en、mixed、und";
    }
    const labels: Record<string, string> = {
      title: "title",
      content: "content",
      sourceUrl: "source_url",
      tags: "tags",
      market: "market",
    };
    return `${labels[field] ?? field}：${issue.message}`;
  });
}

export function analyzeSignalCsv(csv: string): ParsedCsv<ImportedSignal> {
  const table = parseTable(csv, signalHeaders, ["title", "content"]);
  const rows = table.rows.map((row): ParsedCsvRow<ImportedSignal> => {
    const sourceType = (row.values.source_type || "OTHER").trim().toUpperCase();
    const language = (row.values.original_language ?? "").trim() || undefined;
    const parsed = createSignalSchema.safeParse({
      sourceType,
      title: row.values.title ?? "",
      content: row.values.content ?? "",
      sourceUrl: row.values.source_url || null,
      tags: (row.values.tags ?? "")
        .split(/[|;；]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      market: (row.values.market ?? "").trim() || undefined,
      originalLanguage: language,
    });
    const messages = [...row.messages];
    if (!parsed.success) messages.push(...csvZodMessages(parsed.error));

    const sourceName = (row.values.source_name ?? "").trim();
    if (sourceName.length > 140) messages.push("source_name 最多 140 个字符");
    const externalId = (row.values.external_id ?? "").trim();
    if (externalId.length > 200) messages.push("external_id 最多 200 个字符");
    const collected = collectedAt(row.values.collected_at ?? "");
    if (collected.message) messages.push(collected.message);
    if (!parsed.success || messages.length) {
      return { ...row, value: null, messages };
    }
    const originalLanguage = parsed.data.originalLanguage ?? languageFromMarket(
      parsed.data.market,
      parsed.data.title,
      parsed.data.content,
    );
    const value: ImportedSignal = {
      sourceType: parsed.data.sourceType,
      title: parsed.data.title,
      content: parsed.data.content,
      sourceUrl: parsed.data.sourceUrl || null,
      tags: parsed.data.tags,
      market: parsed.data.market || null,
      originalLanguage,
      sourceName: sourceName || null,
      collectedAt: collected.value,
      externalId: externalId || null,
      fingerprint: signalImportFingerprint({
        sourceType: parsed.data.sourceType,
        title: parsed.data.title,
        content: parsed.data.content,
        sourceUrl: parsed.data.sourceUrl || null,
        externalId: externalId || null,
      }),
      contentFingerprint: signalImportFingerprint({
        sourceType: parsed.data.sourceType,
        title: parsed.data.title,
        content: parsed.data.content,
        sourceUrl: parsed.data.sourceUrl || null,
      }),
    };
    return { ...row, value, messages };
  });
  return { ...table, rows };
}

export function parseSignalCsv(csv: string): ImportedSignal[] {
  const parsed = analyzeSignalCsv(csv);
  const issue = parsed.issues[0];
  const invalidRow = parsed.rows.find((row) => row.messages.length);
  if (issue) {
    const prefix = issue.line ? `CSV 第 ${issue.line} 行：` : "CSV ";
    throw new Error(`${prefix}${issue.message.replace(/^CSV\s*/, "")}`);
  }
  if (invalidRow) {
    throw new Error(`CSV 第 ${invalidRow.line} 行：${invalidRow.messages[0]}`);
  }
  return parsed.rows.flatMap((row) => row.value ? [row.value] : []);
}

export function analyzeProductCsv(csv: string): ParsedCsv<ImportedProduct> {
  const table = parseTable(csv, productHeaders, ["name", "platform"]);
  const rows = table.rows.map((row): ParsedCsvRow<ImportedProduct> => {
    const parsed = (() => {
      try {
        const name = (row.values.name ?? "").trim();
        const platform = (row.values.platform ?? "").trim().toUpperCase();
        const status = (row.values.status || "LIVE").trim().toUpperCase();
        const url = (row.values.url ?? "").trim();
        const description = (row.values.description ?? "").trim();
        const currentFocus = (row.values.current_focus ?? "").trim();
        const messages = [...row.messages];
        if (name.length < 2 || name.length > 100) messages.push("name 需要 2–100 个字符");
        if (!["WEB", "IOS", "WEB_AND_IOS"].includes(platform)) {
          messages.push("platform 仅支持 WEB、IOS、WEB_AND_IOS");
        }
        if (!["IDEA", "BUILDING", "LIVE", "PAUSED", "ARCHIVED"].includes(status)) {
          messages.push("status 仅支持 IDEA、BUILDING、LIVE、PAUSED、ARCHIVED");
        }
        if (description.length > 600) messages.push("description 最多 600 个字符");
        if (currentFocus.length > 300) messages.push("current_focus 最多 300 个字符");
        if (url) {
          try {
            const parsedUrl = new URL(url);
            if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
              messages.push("url 仅支持不含用户名或密码的 HTTP/HTTPS 链接");
            }
          } catch {
            messages.push("url 不是有效链接");
          }
        }
        if (messages.length) return { value: null, messages };
        return {
          value: {
            name,
            platform: platform as Platform,
            status: status as Product["status"],
            url: url || null,
            description,
            currentFocus,
          },
          messages,
        };
      } catch {
        return { value: null, messages: ["这一行无法解析"] };
      }
    })();
    return { ...row, ...parsed };
  });
  return { ...table, rows };
}
