import type { SignalSource } from "../shared/types.js";

function parseLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

const validSources = new Set<SignalSource>([
  "IDEA",
  "REDDIT",
  "X",
  "APP_REVIEW",
  "FORUM",
  "CUSTOMER",
  "OTHER",
]);

export interface ImportedSignal {
  sourceType: SignalSource;
  title: string;
  content: string;
  sourceUrl: string | null;
  tags: string[];
}

export function parseSignalCsv(csv: string): ImportedSignal[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");

  const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
  const required = ["title", "content"];
  required.forEach((field) => {
    if (!headers.includes(field)) throw new Error(`CSV 缺少 ${field} 列`);
  });

  return lines.slice(1).map((line, index) => {
    const cells = parseLine(line);
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const source = (record.source_type || record.source || "OTHER").toUpperCase() as SignalSource;
    if (!record.title || !record.content) {
      throw new Error(`CSV 第 ${index + 2} 行缺少 title 或 content`);
    }
    return {
      sourceType: validSources.has(source) ? source : "OTHER",
      title: record.title.slice(0, 140),
      content: record.content.slice(0, 10_000),
      sourceUrl: record.source_url || record.url || null,
      tags: (record.tags ?? "")
        .split(/[|;]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12),
    };
  });
}
