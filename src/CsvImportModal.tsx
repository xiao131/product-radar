import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  LoaderCircle,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  CsvImportKind,
  CsvImportPreview,
  CsvImportResult,
} from "../shared/types";
import { api, ApiError } from "./api";
import { Modal } from "./components";
import { useI18n } from "./i18n";

const maxFileSize = 1_500_000;

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  const spreadsheetSafe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isImportPreview(value: unknown): value is CsvImportPreview {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CsvImportPreview>;
  return (
    typeof candidate.totalRows === "number" &&
    typeof candidate.errorRows === "number" &&
    Array.isArray(candidate.rows) &&
    Array.isArray(candidate.issues)
  );
}

export function CsvImportModal({
  kind,
  open,
  onClose,
  onImported,
}: {
  kind: CsvImportKind;
  open: boolean;
  onClose: () => void;
  onImported: (result: CsvImportResult) => void;
}) {
  const { t } = useI18n();
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const isSignals = kind === "signals";

  const config = useMemo(() => ({
    title: isSignals
      ? t("导入原始证据", "Import raw evidence")
      : t("导入已有产品", "Import existing products"),
    subtitle: isSignals
      ? t("先预检格式、重复项和字段错误，确认后再一次性写入。", "Validate format, duplicates, and field errors before anything is written.")
      : t("批量补齐你的产品组合；重复产品默认跳过，不覆盖现有内容。", "Add your portfolio in bulk; duplicates are skipped without overwriting existing products."),
    templatePath: isSignals
      ? "/api/signals/import/template"
      : "/api/products/import/template",
    previewPath: isSignals
      ? "/api/signals/import/preview"
      : "/api/products/import/preview",
    importPath: isSignals ? "/api/signals/import" : "/api/products/import",
    required: isSignals ? "title, content" : "name, platform",
    optional: isSignals
      ? "source_type, source_url, tags, market, original_language, source_name, collected_at, external_id"
      : "status, url, description, current_focus, verification_status",
    rules: isSignals
      ? t(
          "source_type 支持 IDEA、REDDIT、X、APP_REVIEW、APP_STORE、SEARCH、TREND、FORUM、CUSTOMER、OTHER；tags 用英文分号分隔。",
          "source_type supports IDEA, REDDIT, X, APP_REVIEW, APP_STORE, SEARCH, TREND, FORUM, CUSTOMER, and OTHER; separate tags with semicolons.",
        )
      : t(
          "platform 支持 UNKNOWN、WEB、IOS、WEB_AND_IOS；status 支持 BUILDING、LIVE、PAUSED、ARCHIVED。未开发想法请导入原始证据。",
          "platform supports UNKNOWN, WEB, IOS, and WEB_AND_IOS; status supports BUILDING, LIVE, PAUSED, and ARCHIVED. Import undeveloped ideas as raw evidence.",
        ),
    previewColumns: isSignals
      ? ["title", "source_type", "market", "collected_at"]
      : ["name", "platform", "status", "url"],
  }), [isSignals, t]);

  useEffect(() => {
    if (open) return;
    setFileName("");
    setCsv("");
    setPreview(null);
    setReading(false);
    setImporting(false);
    setError("");
  }, [open]);

  async function inspectFile(file: File) {
    setError("");
    setPreview(null);
    setCsv("");
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setError(t("请选择 .csv 文件。", "Choose a .csv file."));
      return;
    }
    if (file.size > maxFileSize) {
      setError(t("CSV 文件不能超过 1.5 MB。", "CSV files must be 1.5 MB or smaller."));
      return;
    }
    setReading(true);
    setFileName(file.name);
    try {
      const content = await file.text();
      const result = await api<CsvImportPreview>(config.previewPath, {
        method: "POST",
        body: JSON.stringify({ csv: content }),
      });
      setCsv(content);
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("预检失败", "Validation failed"));
    } finally {
      setReading(false);
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void inspectFile(file);
  }

  function dropFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void inspectFile(file);
  }

  async function commitImport() {
    if (!preview?.canImport || !csv) return;
    setImporting(true);
    setError("");
    try {
      const result = await api<CsvImportResult>(config.importPath, {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      onImported(result);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && isImportPreview(caught.details)) {
        setPreview(caught.details);
      }
      setError(caught instanceof Error ? caught.message : t("导入失败", "Import failed"));
    } finally {
      setImporting(false);
    }
  }

  function downloadErrorReport() {
    if (!preview) return;
    const lines = [
      ["line", "field", "message"].map(csvCell).join(","),
      ...preview.issues.map((issue) =>
        [issue.line ?? "", issue.field ?? "", issue.message]
          .map(csvCell)
          .join(","),
      ),
    ];
    downloadText(
      isSignals
        ? "product-radar-evidence-import-errors.csv"
        : "product-radar-products-import-errors.csv",
      lines.join("\r\n"),
    );
  }

  const visibleColumns = config.previewColumns.filter((column) =>
    preview?.columns.includes(column),
  );

  return (
    <Modal
      title={config.title}
      subtitle={config.subtitle}
      open={open}
      size="wide"
      onClose={() => {
        if (!importing) onClose();
      }}
    >
      <div className="csv-import">
        <section className="csv-import__guide" aria-label={t("CSV 字段说明", "CSV field guide")}>
          <div>
            <strong>{t("必填字段", "Required fields")}</strong>
            <code>{config.required}</code>
          </div>
          <div>
            <strong>{t("可选字段", "Optional fields")}</strong>
            <code>{config.optional}</code>
          </div>
          <p>{config.rules}</p>
          <p>
            {t(
              "模板包含一行有效示例；填写时请替换或删除示例数据。",
              "The template includes one valid example row; replace or remove it before importing.",
            )}
          </p>
          <a className="button button--secondary button--small" href={config.templatePath} download>
            <Download size={15} /> {t("下载示例模板", "Download example template")}
          </a>
        </section>

        <label
          className={`csv-dropzone ${reading ? "csv-dropzone--busy" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFile}
        >
          <input
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            onChange={selectFile}
            disabled={reading || importing}
          />
          {reading ? <LoaderCircle className="spin" size={24} /> : <FileUp size={24} />}
          <span>
            <strong>{reading ? t("正在预检…", "Validating…") : t("选择或拖入 CSV 文件", "Choose or drop a CSV file")}</strong>
            <small>{fileName || t("UTF-8 编码，最大 1.5 MB、5000 行", "UTF-8, up to 1.5 MB and 5,000 rows")}</small>
          </span>
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        {preview && (
          <section className="csv-preview" aria-live="polite">
            <div className="csv-preview__summary">
              <span><FileSpreadsheet size={16} /> {preview.totalRows} {t("行", "rows")}</span>
              <span className="csv-count csv-count--valid"><CheckCircle2 size={15} /> {preview.validRows} {t("可导入", "valid")}</span>
              <span className="csv-count csv-count--duplicate">{preview.duplicateRows} {t("重复", "duplicates")}</span>
              <span className={`csv-count ${preview.errorRows || preview.issues.length ? "csv-count--error" : ""}`}>
                {preview.issues.length} {t("项错误", "errors")}
              </span>
            </div>

            {(preview.issues.length > 0 || preview.errorRows > 0) && (
              <div className="csv-preview__errors" role="alert">
                <AlertTriangle size={17} />
                <div>
                  <strong>{t("请先修复 CSV，再重新选择文件", "Fix the CSV and choose it again")}</strong>
                  <ul>
                    {preview.issues.slice(0, 4).map((issue, index) => (
                      <li key={`${issue.line}-${issue.field}-${index}`}>
                        {issue.line ? `${t("第", "Line ")}${issue.line}${t(" 行", "")}: ` : ""}{issue.message}
                      </li>
                    ))}
                  </ul>
                  {preview.issues.length > 4 && (
                    <small>{t(`另有 ${preview.issues.length - 4} 项错误`, `${preview.issues.length - 4} more errors`)}</small>
                  )}
                </div>
                <button className="button button--secondary button--small" type="button" onClick={downloadErrorReport}>
                  <Download size={14} /> {t("下载错误报告", "Download error report")}
                </button>
              </div>
            )}

            {preview.rows.length > 0 && visibleColumns.length > 0 && (
              <div className="csv-preview__table-wrap">
                <table className="csv-preview__table">
                  <thead>
                    <tr>
                      <th>{t("行", "Line")}</th>
                      <th>{t("状态", "Status")}</th>
                      {visibleColumns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.line} className={`csv-preview__row--${row.status}`}>
                        <td>{row.line}</td>
                        <td>
                          {row.status === "valid"
                            ? t("可导入", "Valid")
                            : row.status === "duplicate"
                              ? t("重复", "Duplicate")
                              : t("错误", "Error")}
                        </td>
                        {visibleColumns.map((column) => (
                          <td key={column} title={row.values[column]}>{row.values[column] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.truncated && <small>{t("仅预览前 20 行。", "Showing the first 20 rows.")}</small>}
              </div>
            )}

            {!preview.canImport && preview.errorRows === 0 && preview.issues.length === 0 && (
              <div className="form-warning">{t("没有新的数据可以导入。", "There is no new data to import.")}</div>
            )}
          </section>
        )}

        <div className="form-actions csv-import__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={importing}>
            {t("取消", "Cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={commitImport}
            disabled={!preview?.canImport || importing}
          >
            {importing && <LoaderCircle className="spin" size={16} />}
            {importing
              ? t("正在导入…", "Importing…")
              : t(`确认导入 ${preview?.validRows ?? 0} 行`, `Import ${preview?.validRows ?? 0} rows`)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
