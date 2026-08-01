import { ZodError } from "zod";
import { createSignalSchema } from "../shared/schemas.js";
import type { SignalSource } from "../shared/types.js";

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
    recordLine = line;
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
      line += 1;
      pushRecord();
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
}

export function parseSignalCsv(csv: string): ImportedSignal[] {
  const records = parseRecords(csv);
  if (records.length < 2) throw new Error("CSV 至少需要表头和一行数据");

  const headers = records[0].cells.map((header) => header.trim().toLowerCase());
  for (const field of ["title", "content"]) {
    if (!headers.includes(field)) throw new Error(`CSV 缺少 ${field} 列`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV 表头包含重复列");
  }

  return records.slice(1).map((record) => {
    const values = Object.fromEntries(
      headers.map((header, index) => [header, record.cells[index] ?? ""]),
    );
    const sourceType = (values.source_type || values.source || "OTHER")
      .trim()
      .toUpperCase();
    try {
      const parsed = createSignalSchema.parse({
        sourceType,
        title: values.title,
        content: values.content,
        sourceUrl: values.source_url || values.url || null,
        tags: (values.tags ?? "")
          .split(/[|;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      return {
        sourceType: parsed.sourceType,
        title: parsed.title,
        content: parsed.content,
        sourceUrl: parsed.sourceUrl || null,
        tags: parsed.tags,
      };
    } catch (error) {
      const message =
        error instanceof ZodError
          ? error.issues[0]?.message ?? "内容不符合要求"
          : error instanceof Error
            ? error.message
            : "内容不符合要求";
      throw new Error(`CSV 第 ${record.line} 行：${message}`);
    }
  });
}
