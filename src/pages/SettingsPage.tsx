import {
  Bot,
  CheckCircle2,
  Clock3,
  Coins,
  Globe2,
  KeyRound,
  LoaderCircle,
  Radar,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdminAccount,
  AdminAccountUpdate,
  AiConnectionTestResult,
  RuntimeSettings,
  RuntimeSettingsUpdate,
} from "../../shared/types";
import { MIN_ADMIN_PASSWORD_LENGTH } from "../../shared/auth";
import { api } from "../api";
import { LanguageSwitch, useI18n } from "../i18n";
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
  const { t } = useI18n();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [form, setForm] = useState<RuntimeSettingsUpdate | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [accountForm, setAccountForm] = useState({
    username: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [accountError, setAccountError] = useState("");
  const [accountFeedback, setAccountFeedback] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  function load() {
    setError("");
    api<RuntimeSettings>("/api/settings")
      .then((next) => {
        setSettings(next);
        setForm(settingsUpdate(next));
        setDirty(false);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : t("读取设置失败", "Failed to load settings")),
      );
  }

  function loadAccount() {
    setAccountError("");
    api<AdminAccount>("/api/auth/account")
      .then((next) => {
        setAccount(next);
        setAccountForm((current) => ({
          ...current,
          username: next.username ?? "",
        }));
      })
      .catch((caught) =>
        setAccountError(
          caught instanceof Error ? caught.message : t("读取账号失败", "Failed to load account"),
        ),
      );
  }

  useEffect(() => {
    load();
    loadAccount();
  }, []);

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
      setFeedback(t("设置已保存，将从下一次任务开始生效。", "Settings saved and will apply to the next job."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("保存失败", "Save failed"));
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
        t(
          `AI 连接成功：${result.provider} / ${result.model}，耗时 ${(result.elapsedMs / 1_000).toFixed(1)} 秒。`,
          `AI connection succeeded: ${result.provider} / ${result.model} in ${(result.elapsedMs / 1_000).toFixed(1)}s.`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("AI 连接测试失败", "AI connection test failed"));
    } finally {
      setTesting(false);
    }
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (accountForm.newPassword !== accountForm.confirmPassword) {
      setAccountError(t("两次输入的新密码不一致", "The new passwords do not match"));
      return;
    }
    setSavingAccount(true);
    setAccountError("");
    setAccountFeedback("");
    const update: AdminAccountUpdate = {
      username: accountForm.username,
      currentPassword: accountForm.currentPassword,
      ...(accountForm.newPassword
        ? { newPassword: accountForm.newPassword }
        : {}),
    };
    try {
      const saved = await api<AdminAccount>("/api/auth/account", {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      setAccount(saved);
      setAccountForm({
        username: saved.username ?? "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setAccountFeedback(t("账号信息已更新，旧登录会话已失效。", "Account updated; previous sessions have been invalidated."));
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : t("保存账号失败", "Failed to save account"));
    } finally {
      setSavingAccount(false);
    }
  }

  if (error && !form) return <ErrorState message={error} retry={load} />;
  if (!settings || !form) return <LoadingState label={t("正在读取运行设置", "Loading runtime settings")} />;

  const currentProviderKeyAvailable =
    form.aiProvider === settings.aiProvider && settings.aiKeyConfigured;

  return (
    <div className="settings-page">
      <div className="settings-main">
        <section className="settings-intro">
          <div>
            <span className="eyebrow">{t("运行控制", "RUNTIME CONTROL")}</span>
            <h2>{t("只调整会影响结果的参数", "Adjust only settings that affect results")}</h2>
            <p>
              {t("设置保存到本机数据库；已在运行的任务保持原参数，下一次任务使用新设置。", "Settings are stored in the local database. Running jobs keep their current values; new jobs use the saved settings.")}
            </p>
          </div>
          <span className={`mode-stamp mode-stamp--${settings.researchMode.toLowerCase()}`}>
            {settings.researchMode === "REAL" ? t("真实数据", "Live data") : t("演示数据", "Demo data")}
          </span>
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <UserRound size={19} />
            <div>
              <span className="eyebrow">{t("账号与安全", "ACCOUNT & SECURITY")}</span>
              <h2>{t("账号管理", "Account")}</h2>
              <p>{t("修改登录账号，或在需要时更换密码。", "Change the sign-in username or password when needed.")}</p>
            </div>
          </header>
          {account?.configured ? (
            <form className="account-settings" onSubmit={saveAccount}>
              <div className="settings-fields settings-fields--two">
                <Field
                  label={t("登录账号", "Username")}
                  hint={t("3-64 位，可使用字母、数字、点、下划线和连字符。", "3–64 characters: letters, numbers, dots, underscores, and hyphens.")}
                >
                  <input
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={3}
                    maxLength={64}
                    pattern="[A-Za-z0-9._-]+"
                    value={accountForm.username}
                    onChange={(event) => {
                      setAccountForm((current) => ({
                        ...current,
                        username: event.target.value,
                      }));
                      setAccountFeedback("");
                    }}
                    required
                  />
                </Field>
                <Field
                  label={t("当前密码", "Current password")}
                  hint={t("保存任何账号修改时都需要验证。", "Required to save any account change.")}
                >
                  <input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={accountForm.currentPassword}
                    onChange={(event) => {
                      setAccountForm((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }));
                      setAccountFeedback("");
                    }}
                    required
                  />
                </Field>
                <Field
                  label={t("新密码", "New password")}
                  hint={t(
                    `不修改密码时留空；至少 ${MIN_ADMIN_PASSWORD_LENGTH} 个字符。`,
                    `Leave blank to keep it unchanged; at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
                  )}
                >
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    maxLength={300}
                    value={accountForm.newPassword}
                    onChange={(event) => {
                      setAccountForm((current) => ({
                        ...current,
                        newPassword: event.target.value,
                      }));
                      setAccountFeedback("");
                    }}
                  />
                </Field>
                <Field label={t("确认新密码", "Confirm new password")}>
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={
                      accountForm.newPassword
                        ? MIN_ADMIN_PASSWORD_LENGTH
                        : undefined
                    }
                    maxLength={300}
                    value={accountForm.confirmPassword}
                    onChange={(event) => {
                      setAccountForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }));
                      setAccountFeedback("");
                    }}
                    required={Boolean(accountForm.newPassword)}
                  />
                </Field>
              </div>
              <div className="account-settings__actions">
                <div aria-live="polite">
                  {accountFeedback && (
                    <div className="form-success" role="status">
                      {accountFeedback}
                    </div>
                  )}
                  {accountError && (
                    <div className="form-error" role="alert">
                      {accountError}
                    </div>
                  )}
                </div>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={
                    savingAccount ||
                    !accountForm.currentPassword ||
                    (!accountForm.newPassword &&
                      accountForm.username.toLowerCase() === account.username)
                  }
                >
                  {savingAccount ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <KeyRound size={16} />
                  )}
                  {savingAccount ? t("正在保存…", "Saving…") : t("保存账号", "Save account")}
                </button>
              </div>
            </form>
          ) : account ? (
            <div className="account-settings__notice">
              {t("当前未启用账号登录。配置初始密码后，这里会显示账号管理表单。", "Account sign-in is not enabled. This form appears after the initial password is configured.")}
            </div>
          ) : accountError ? (
            <div className="form-error" role="alert">{accountError}</div>
          ) : (
            <LoadingState label={t("正在读取账号", "Loading account")} />
          )}
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <Globe2 size={19} />
            <div>
              <span className="eyebrow">{t("显示语言", "DISPLAY LANGUAGE")}</span>
              <h2>{t("界面语言", "Interface language")}</h2>
              <p>{t("这里只改变界面和已保存的双语内容，不改变候选范围、评分或调用成本。", "This changes only the interface and saved bilingual copy. It does not change candidates, scores, or API cost.")}</p>
            </div>
          </header>
          <LanguageSwitch />
        </section>

        <section className="panel settings-section">
          <header className="settings-section__header">
            <Bot size={19} />
            <div>
              <span className="eyebrow">{t("AI 引擎", "AI ENGINE")}</span>
              <h2>{t("判断模型与可靠性", "Decision model and reliability")}</h2>
              <p>{t("归并和调研都使用这里的 AI 配置；连接测试不会保存设置。", "Clustering and research use this AI configuration; connection tests do not save settings.")}</p>
            </div>
          </header>
          <div className="settings-fields settings-fields--two">
            <Field label={t("模型提供商", "Model provider")}>
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
                <option value="deepseek">{t("DeepSeek 官方 API", "DeepSeek API")}</option>
                <option value="anthropic">{t("Anthropic 协议", "Anthropic-compatible")}</option>
                <option value="openai">{t("OpenAI Responses 协议", "OpenAI Responses-compatible")}</option>
                <option value="gateway">Vercel AI Gateway</option>
              </select>
            </Field>
            <Field label={t("模型", "Model")} hint={t("可直接填写中转支持的模型 ID。", "Enter any model ID supported by the provider or relay.")}>
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
                    ? t("DeepSeek 官方地址为 https://api.deepseek.com。", "The official DeepSeek endpoint is https://api.deepseek.com.")
                    : t("Anthropic 地址会自动补齐 /v1。", "The Anthropic endpoint automatically appends /v1 when needed.")
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
                  ? t("已安全保存；留空表示继续使用现有 Key。", "Saved securely; leave blank to keep the existing key.")
                  : t("尚未检测到当前提供商的 Key。", "No key is configured for this provider.")
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                placeholder={currentProviderKeyAvailable ? t("••••••••（保持不变）", "•••••••• (unchanged)") : t("输入新的 API Key", "Enter a new API key")}
                value={form.aiApiKey ?? ""}
                onChange={(event) => change("aiApiKey", event.target.value)}
              />
            </Field>
            <Field label={t("AI 最长等待（分钟）", "AI timeout (minutes)")} hint={t("建议 10 分钟；中转若先断开，仍会提前失败。", "10 minutes is recommended; a relay can still fail earlier if it disconnects.")}>
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
            <Field label={t("失败重试次数", "Retry count")} hint={t("仅重试瞬时故障；0–3 次。", "Retries transient failures only; 0–3.")}>
              <input
                type="number"
                min="0"
                max="3"
                value={form.providerMaxRetries}
                onChange={(event) => change("providerMaxRetries", Number(event.target.value))}
              />
            </Field>
            <Field
              label={t("同时调研候选数", "Concurrent candidates")}
              hint={t("建议保持 1；中转服务不稳定时不要并发。", "Keep this at 1 when the relay is unstable.")}
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
              <h2>{t("自动发现与分批归并", "Automatic discovery and batched clustering")}</h2>
              <p>{t("减小单批不会减少总覆盖；系统会滚动处理并保留少量上下文。", "Smaller batches improve stability without reducing total coverage; a small overlap preserves context.")}</p>
            </div>
          </header>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={form.autoDiscoveryEnabled}
              onChange={(event) => change("autoDiscoveryEnabled", event.target.checked)}
            />
            <span>
              <strong>{t("启用每日自动发现", "Enable daily automatic discovery")}</strong>
              <small>{t("定时采集互联网信号，AI 自动生成候选产品。", "Collect internet signals on schedule and let AI create candidates.")}</small>
            </span>
          </label>
          <div className="settings-fields settings-fields--three">
            <Field label={t("每批信号数", "Signals per batch")} hint={t("建议 40–60，越小越稳定。", "40–60 is recommended; smaller batches are more stable.")}>
              <input
                type="number"
                min="20"
                max="300"
                value={form.discoveryAiSignalLimit}
                onChange={(event) => change("discoveryAiSignalLimit", Number(event.target.value))}
              />
            </Field>
            <Field label={t("每次最多批数", "Maximum batches per run")} hint={t(`当前最多覆盖约 ${estimatedSignals} 条新信号。`, `Currently covers up to about ${estimatedSignals} new signals.`)}>
              <input
                type="number"
                min="1"
                max="20"
                value={form.discoveryAiMaxBatchesPerRun}
                onChange={(event) => change("discoveryAiMaxBatchesPerRun", Number(event.target.value))}
              />
            </Field>
            <Field label={t("每批最多候选", "Maximum candidates per batch")} hint={t("宁缺毋滥，不是固定生成数量。", "A quality ceiling, not a generation target.")}>
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
              <h2>{t("市场与执行时间", "Markets and schedule")}</h2>
              <p>{t("时间使用服务器本地时区；至少保留一个市场。", "Times use the server timezone; keep at least one market enabled.")}</p>
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
                  <span>{t(market.languageCode === "zh" ? "中文" : "英文", market.languageCode === "zh" ? "Chinese" : "English")}</span>
                </label>
              );
            })}
          </div>
          <div className="settings-fields settings-fields--three">
            <Field label={t("自动发现时刻", "Discovery hour")}>
              <input type="number" min="0" max="23" value={form.schedulerDiscoveryHour} onChange={(event) => change("schedulerDiscoveryHour", Number(event.target.value))} />
            </Field>
            <Field label={t("到期调研时刻", "Research hour")}>
              <input type="number" min="0" max="23" value={form.schedulerResearchHour} onChange={(event) => change("schedulerResearchHour", Number(event.target.value))} />
            </Field>
            <Field label={t("自动备份时刻", "Backup hour")}>
              <input type="number" min="0" max="23" value={form.schedulerBackupHour} onChange={(event) => change("schedulerBackupHour", Number(event.target.value))} />
            </Field>
          </div>
        </section>

        <details className="panel settings-advanced">
          <summary>
            <Coins size={18} />
            <span><strong>{t("DataForSEO 成本与缓存", "DataForSEO cost and cache")}</strong><small>{t("低频调整，默认折叠", "Infrequent controls, collapsed by default")}</small></span>
          </summary>
          <div className="settings-fields settings-fields--three">
            <Field label={t("每日总上限（USD）", "Daily total limit (USD)")}>
              <input type="number" min="0" step="0.01" value={form.maxDataForSeoCostPerDayUsd} onChange={(event) => change("maxDataForSeoCostPerDayUsd", Number(event.target.value))} />
            </Field>
            <Field label={t("每日发现上限（USD）", "Daily discovery limit (USD)")}>
              <input type="number" min="0" step="0.01" value={form.maxDataForSeoDiscoveryCostPerDayUsd} onChange={(event) => change("maxDataForSeoDiscoveryCostPerDayUsd", Number(event.target.value))} />
            </Field>
            <Field label={t("每月总上限（USD）", "Monthly total limit (USD)")}>
              <input type="number" min="0" step="0.1" value={form.maxDataForSeoCostPerMonthUsd} onChange={(event) => change("maxDataForSeoCostPerMonthUsd", Number(event.target.value))} />
            </Field>
            <Field label={t("关键词调研缓存（天）", "Keyword cache (days)")}><input type="number" min="1" max="365" value={form.researchKeywordCacheDays} onChange={(event) => change("researchKeywordCacheDays", Number(event.target.value))} /></Field>
            <Field label={t("SERP 调研缓存（天）", "SERP research cache (days)")}><input type="number" min="1" max="365" value={form.researchSerpCacheDays} onChange={(event) => change("researchSerpCacheDays", Number(event.target.value))} /></Field>
            <Field label={t("App 调研缓存（天）", "App research cache (days)")}><input type="number" min="1" max="365" value={form.researchAppCacheDays} onChange={(event) => change("researchAppCacheDays", Number(event.target.value))} /></Field>
            <Field label={t("Labs 发现缓存（天）", "Labs discovery cache (days)")}><input type="number" min="1" max="365" value={form.discoveryLabsFreshnessDays} onChange={(event) => change("discoveryLabsFreshnessDays", Number(event.target.value))} /></Field>
            <Field label={t("SERP 发现缓存（天）", "SERP discovery cache (days)")}><input type="number" min="1" max="365" value={form.discoverySerpFreshnessDays} onChange={(event) => change("discoverySerpFreshnessDays", Number(event.target.value))} /></Field>
            <Field label={t("App 发现缓存（天）", "App discovery cache (days)")}><input type="number" min="1" max="365" value={form.discoveryAppFreshnessDays} onChange={(event) => change("discoveryAppFreshnessDays", Number(event.target.value))} /></Field>
          </div>
        </details>
      </div>

      <aside className="settings-summary">
        <span className="eyebrow">{t("当前方案", "CURRENT PLAN")}</span>
        <h2>{form.aiModel}</h2>
        <p>{t(`${form.aiProvider} · AI 最长等待 ${form.aiRequestTimeoutSeconds / 60} 分钟`, `${form.aiProvider} · AI timeout ${form.aiRequestTimeoutSeconds / 60} min`)}</p>
        <div className="settings-summary__metric">
          <span>{t("单次自动发现", "One discovery run")}</span>
          <strong>{estimatedSignals}</strong>
          <small>{t("最多覆盖的新信号（估算）", "maximum new signals (estimate)")}</small>
        </div>
        <ul>
          {form.aiProvider === "deepseek" && (
            <li><Bot size={15} />{t("思考模式开启，推理强度 max · 1M 上下文 / 384K 最大输出", "Reasoning enabled at max · 1M context / 384K maximum output")}</li>
          )}
          <li><CheckCircle2 size={15} />{t(`${form.discoveryAiSignalLimit} 条/批，最多 ${form.discoveryAiMaxBatchesPerRun} 批`, `${form.discoveryAiSignalLimit} signals/batch, up to ${form.discoveryAiMaxBatchesPerRun} batches`)}</li>
          <li><ShieldCheck size={15} />{t("API Key 仅加密保存，不会返回浏览器", "API keys are encrypted at rest and never returned to the browser")}</li>
          <li><Coins size={15} />{t(`自动发现每日上限 $${form.maxDataForSeoDiscoveryCostPerDayUsd.toFixed(2)}`, `Daily discovery limit $${form.maxDataForSeoDiscoveryCostPerDayUsd.toFixed(2)}`)}</li>
        </ul>
        {feedback && <div className="form-success" role="status">{feedback}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button--secondary button--full" disabled={testing || saving} onClick={() => void testAi()}>
          {testing ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}
          {testing ? t("正在测试连接…", "Testing connection…") : t("测试 AI 连接", "Test AI connection")}
        </button>
        <button className="button button--primary button--full" disabled={!dirty || saving || testing} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
          {saving ? t("正在保存…", "Saving…") : dirty ? t("保存设置", "Save settings") : t("已保存", "Saved")}
        </button>
      </aside>
    </div>
  );
}
