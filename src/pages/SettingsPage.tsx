import {
  Bot,
  CheckCircle2,
  Clock3,
  Coins,
  LoaderCircle,
  Radar,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AiConnectionTestResult,
  RuntimeSettings,
  RuntimeSettingsUpdate,
} from "../../shared/types";
import { api } from "../api";
import { ErrorState, Field, LoadingState } from "../components";

function settingsUpdate(
  settings: RuntimeSettings,
  aiApiKey = "",
): RuntimeSettingsUpdate {
  return {
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    aiBaseUrl: settings.aiBaseUrl,
    aiApiKey,
    aiRequestTimeoutSeconds: settings.aiRequestTimeoutSeconds,
    researchAiConcurrency: settings.researchAiConcurrency,
    providerMaxRetries: settings.providerMaxRetries,
    discoveryAiSignalLimit: settings.discoveryAiSignalLimit,
    discoveryAiMaxBatchesPerRun: settings.discoveryAiMaxBatchesPerRun,
    autoDiscoveryEnabled: settings.autoDiscoveryEnabled,
    discoveryMaxCandidatesPerRun: settings.discoveryMaxCandidatesPerRun,
    schedulerDiscoveryHour: settings.schedulerDiscoveryHour,
    schedulerResearchHour: settings.schedulerResearchHour,
    schedulerBackupHour: settings.schedulerBackupHour,
    enabledMarketCodes: settings.markets
      .filter((market) => market.enabled)
      .map((market) => market.countryCode),
    maxDataForSeoCostPerDayUsd: settings.maxDataForSeoCostPerDayUsd,
    maxDataForSeoDiscoveryCostPerDayUsd:
      settings.maxDataForSeoDiscoveryCostPerDayUsd,
    maxDataForSeoCostPerMonthUsd: settings.maxDataForSeoCostPerMonthUsd,
    researchKeywordCacheDays: settings.researchKeywordCacheDays,
    researchSerpCacheDays: settings.researchSerpCacheDays,
    researchAppCacheDays: settings.researchAppCacheDays,
    discoveryLabsFreshnessDays: settings.discoveryLabsFreshnessDays,
    discoverySerpFreshnessDays: settings.discoverySerpFreshnessDays,
    discoveryAppFreshnessDays: settings.discoveryAppFreshnessDays,
  };
}

const modelSuggestions = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  anthropic: ["claude-opus-5", "claude-sonnet-4-5"],
  openai: ["gpt-5.6-sol", "gpt-5.6-terra"],
  gateway: ["openai/gpt-5.6-sol", "anthropic/claude-opus-5"],
} as const;

export function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [form, setForm] = useState<RuntimeSettingsUpdate | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);

  function load() {
    setError("");
    api<RuntimeSettings>("/api/settings")
      .then((next) => {
        setSettings(next);
        setForm(settingsUpdate(next));
        setDirty(false);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "读取设置失败"),
      );
  }

  useEffect(load, []);

  const estimatedSignals = useMemo(() => {
    if (!form) return 0;
    const context = Math.min(
      12,
      Math.max(2, Math.floor(form.discoveryAiSignalLimit * 0.2)),
    );
    return (
      form.discoveryAiSignalLimit +
      Math.max(0, form.discoveryAiMaxBatchesPerRun - 1) *
        (form.discoveryAiSignalLimit - context)
    );
  }, [form]);

  function change<K extends keyof RuntimeSettingsUpdate>(
    key: K,
    value: RuntimeSettingsUpdate[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setFeedback("");
  }

  function toggleMarket(code: string) {
    if (!form) return;
    const selected = form.enabledMarketCodes.includes(code);
    if (selected && form.enabledMarketCodes.length === 1) return;
    change(
      "enabledMarketCodes",
      selected
        ? form.enabledMarketCodes.filter((item) => item !== code)
        : [...form.enabledMarketCodes, code],
    );
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const saved = await api<RuntimeSettings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setSettings(saved);
      setForm(settingsUpdate(saved));
      setDirty(false);
      setFeedback("设置已保存，将从下一次任务开始生效。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function testAi() {
    if (!form) return;
    setTesting(true);
    setError("");
    setFeedback("");
    try {
      const result = await api<AiConnectionTestResult>(
        "/api/settings/test-ai",
        { method: "POST", body: JSON.stringify(form) },
      );
      setFeedback(
        `AI 连接成功：${result.provider} / ${result.model}，耗时 ${(result.elapsedMs / 1_000).toFixed(1)} 秒。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  if (error && !form) return <ErrorState message={error} retry={load} />;
  if (!settings || !form) return <LoadingState label="正在读取运行设置" />;

  const currentProviderKeyAvailable =
    form.aiProvider === settings.aiProvider && settings.aiKeyConfigured;

  return (
    <div className="settings-page">
      <div className="settings-main">
        <section className="settings-intro">
          <div>
            <span className="eyebrow">RUNTIME CONTROL</span>
            <h2>只调整会影响结果的参数</h2>
            <p>
              设置保存到本机数据库；已在运行的任务保持原参数，下一次任务使用新设置。
            </p>
          </div>
          <span className={`mode-stamp mode-stamp--${settings.researchMode.toLowerCase()}`}>
            {settings.researchMode === "REAL" ? "真实数据" : "演示数据"}
          </span>
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <Bot size={19} />
            <div>
              <span className="eyebrow">AI ENGINE</span>
              <h2>判断模型与可靠性</h2>
              <p>归并和调研都使用这里的 AI 配置；连接测试不会保存设置。</p>
            </div>
          </header>
          <div className="settings-fields settings-fields--two">
            <Field label="模型提供商">
              <select
                value={form.aiProvider}
                onChange={(event) => {
                  const provider = event.target.value as RuntimeSettingsUpdate["aiProvider"];
                  change("aiProvider", provider);
                  change("aiModel", modelSuggestions[provider][0]);
                  if (provider === "anthropic") change("aiBaseUrl", "https://api.anthropic.com/v1");
                  if (provider === "openai") change("aiBaseUrl", "https://api.openai.com/v1");
                  if (provider === "deepseek") change("aiBaseUrl", "https://api.deepseek.com");
                  if (provider === "gateway") change("aiBaseUrl", "");
                }}
              >
                <option value="deepseek">DeepSeek 官方 API</option>
                <option value="anthropic">Anthropic 协议</option>
                <option value="openai">OpenAI Responses 协议</option>
                <option value="gateway">Vercel AI Gateway</option>
              </select>
            </Field>
            <Field label="模型" hint="可直接填写中转支持的模型 ID。">
              <input
                value={form.aiModel}
                list="settings-models"
                onChange={(event) => change("aiModel", event.target.value)}
              />
              <datalist id="settings-models">
                {modelSuggestions[form.aiProvider].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </Field>
            {form.aiProvider !== "gateway" && (
              <Field
                label="Base URL"
                hint={
                  form.aiProvider === "deepseek"
                    ? "DeepSeek 官方地址为 https://api.deepseek.com。"
                    : "Anthropic 地址会自动补齐 /v1。"
                }
              >
                <input
                  type="url"
                  value={form.aiBaseUrl}
                  onChange={(event) => change("aiBaseUrl", event.target.value)}
                />
              </Field>
            )}
            <Field
              label="API Key"
              hint={
                currentProviderKeyAvailable
                  ? "已安全保存；留空表示继续使用现有 Key。"
                  : "尚未检测到当前提供商的 Key。"
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                placeholder={currentProviderKeyAvailable ? "••••••••（保持不变）" : "输入新的 API Key"}
                value={form.aiApiKey ?? ""}
                onChange={(event) => change("aiApiKey", event.target.value)}
              />
            </Field>
            <Field label="AI 最长等待（分钟）" hint="建议 10 分钟；中转若先断开，仍会提前失败。">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={form.aiRequestTimeoutSeconds / 60}
                onChange={(event) =>
                  change("aiRequestTimeoutSeconds", Number(event.target.value) * 60)
                }
              />
            </Field>
            <Field label="失败重试次数" hint="仅重试瞬时故障；0–3 次。">
              <input
                type="number"
                min="0"
                max="3"
                value={form.providerMaxRetries}
                onChange={(event) => change("providerMaxRetries", Number(event.target.value))}
              />
            </Field>
            <Field
              label="同时调研候选数"
              hint="建议保持 1；中转服务不稳定时不要并发。"
            >
              <input
                type="number"
                min="1"
                max="3"
                value={form.researchAiConcurrency}
                onChange={(event) =>
                  change("researchAiConcurrency", Number(event.target.value))
                }
              />
            </Field>
          </div>
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <Radar size={19} />
            <div>
              <span className="eyebrow">DISCOVERY</span>
              <h2>自动发现与分批归并</h2>
              <p>减小单批不会减少总覆盖；系统会滚动处理并保留少量上下文。</p>
            </div>
          </header>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={form.autoDiscoveryEnabled}
              onChange={(event) => change("autoDiscoveryEnabled", event.target.checked)}
            />
            <span>
              <strong>启用每日自动发现</strong>
              <small>定时采集互联网信号，AI 自动生成候选产品。</small>
            </span>
          </label>
          <div className="settings-fields settings-fields--three">
            <Field label="每批信号数" hint="建议 40–60，越小越稳定。">
              <input
                type="number"
                min="20"
                max="300"
                value={form.discoveryAiSignalLimit}
                onChange={(event) => change("discoveryAiSignalLimit", Number(event.target.value))}
              />
            </Field>
            <Field label="每次最多批数" hint={`当前最多覆盖约 ${estimatedSignals} 条新信号。`}>
              <input
                type="number"
                min="1"
                max="20"
                value={form.discoveryAiMaxBatchesPerRun}
                onChange={(event) => change("discoveryAiMaxBatchesPerRun", Number(event.target.value))}
              />
            </Field>
            <Field label="每批最多候选" hint="宁缺毋滥，不是固定生成数量。">
              <input
                type="number"
                min="1"
                max="20"
                value={form.discoveryMaxCandidatesPerRun}
                onChange={(event) => change("discoveryMaxCandidatesPerRun", Number(event.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <Clock3 size={19} />
            <div>
              <span className="eyebrow">SCHEDULE & MARKET</span>
              <h2>市场与执行时间</h2>
              <p>时间使用服务器本地时区；至少保留一个市场。</p>
            </div>
          </header>
          <div className="market-selector">
            {settings.markets.map((market) => {
              const checked = form.enabledMarketCodes.includes(market.countryCode);
              return (
                <label key={market.countryCode} className={checked ? "market-option market-option--selected" : "market-option"}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMarket(market.countryCode)}
                  />
                  <strong>{market.countryCode}</strong>
                  <span>{market.languageCode}</span>
                </label>
              );
            })}
          </div>
          <div className="settings-fields settings-fields--three">
            <Field label="自动发现时刻">
              <input type="number" min="0" max="23" value={form.schedulerDiscoveryHour} onChange={(event) => change("schedulerDiscoveryHour", Number(event.target.value))} />
            </Field>
            <Field label="到期调研时刻">
              <input type="number" min="0" max="23" value={form.schedulerResearchHour} onChange={(event) => change("schedulerResearchHour", Number(event.target.value))} />
            </Field>
            <Field label="自动备份时刻">
              <input type="number" min="0" max="23" value={form.schedulerBackupHour} onChange={(event) => change("schedulerBackupHour", Number(event.target.value))} />
            </Field>
          </div>
        </section>

        <details className="panel settings-advanced">
          <summary>
            <Coins size={18} />
            <span><strong>DataForSEO 成本与缓存</strong><small>低频调整，默认折叠</small></span>
          </summary>
          <div className="settings-fields settings-fields--three">
            <Field label="每日总上限（USD）">
              <input type="number" min="0" step="0.01" value={form.maxDataForSeoCostPerDayUsd} onChange={(event) => change("maxDataForSeoCostPerDayUsd", Number(event.target.value))} />
            </Field>
            <Field label="每日发现上限（USD）">
              <input type="number" min="0" step="0.01" value={form.maxDataForSeoDiscoveryCostPerDayUsd} onChange={(event) => change("maxDataForSeoDiscoveryCostPerDayUsd", Number(event.target.value))} />
            </Field>
            <Field label="每月总上限（USD）">
              <input type="number" min="0" step="0.1" value={form.maxDataForSeoCostPerMonthUsd} onChange={(event) => change("maxDataForSeoCostPerMonthUsd", Number(event.target.value))} />
            </Field>
            <Field label="关键词调研缓存（天）"><input type="number" min="1" max="365" value={form.researchKeywordCacheDays} onChange={(event) => change("researchKeywordCacheDays", Number(event.target.value))} /></Field>
            <Field label="SERP 调研缓存（天）"><input type="number" min="1" max="365" value={form.researchSerpCacheDays} onChange={(event) => change("researchSerpCacheDays", Number(event.target.value))} /></Field>
            <Field label="App 调研缓存（天）"><input type="number" min="1" max="365" value={form.researchAppCacheDays} onChange={(event) => change("researchAppCacheDays", Number(event.target.value))} /></Field>
            <Field label="Labs 发现缓存（天）"><input type="number" min="1" max="365" value={form.discoveryLabsFreshnessDays} onChange={(event) => change("discoveryLabsFreshnessDays", Number(event.target.value))} /></Field>
            <Field label="SERP 发现缓存（天）"><input type="number" min="1" max="365" value={form.discoverySerpFreshnessDays} onChange={(event) => change("discoverySerpFreshnessDays", Number(event.target.value))} /></Field>
            <Field label="App 发现缓存（天）"><input type="number" min="1" max="365" value={form.discoveryAppFreshnessDays} onChange={(event) => change("discoveryAppFreshnessDays", Number(event.target.value))} /></Field>
          </div>
        </details>
      </div>

      <aside className="settings-summary">
        <span className="eyebrow">CURRENT PLAN</span>
        <h2>{form.aiModel}</h2>
        <p>{form.aiProvider} · AI 最长等待 {form.aiRequestTimeoutSeconds / 60} 分钟</p>
        <div className="settings-summary__metric">
          <span>单次自动发现</span>
          <strong>{estimatedSignals}</strong>
          <small>最多覆盖的新信号（估算）</small>
        </div>
        <ul>
          {form.aiProvider === "deepseek" && (
            <li><Bot size={15} />思考模式开启，推理强度 max</li>
          )}
          <li><CheckCircle2 size={15} />{form.discoveryAiSignalLimit} 条/批，最多 {form.discoveryAiMaxBatchesPerRun} 批</li>
          <li><ShieldCheck size={15} />API Key 仅加密保存，不会返回浏览器</li>
          <li><Coins size={15} />自动发现每日上限 ${form.maxDataForSeoDiscoveryCostPerDayUsd.toFixed(2)}</li>
        </ul>
        {feedback && <div className="form-success" role="status">{feedback}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button--secondary button--full" disabled={testing || saving} onClick={() => void testAi()}>
          {testing ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}
          {testing ? "正在测试连接…" : "测试 AI 连接"}
        </button>
        <button className="button button--primary button--full" disabled={!dirty || saving || testing} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
          {saving ? "正在保存…" : dirty ? "保存设置" : "已保存"}
        </button>
      </aside>
    </div>
  );
}
