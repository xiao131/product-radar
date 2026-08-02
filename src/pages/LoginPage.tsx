import { LockKeyhole, Radar, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { AuthSession } from "../../shared/types";
import { api } from "../api";
import { LanguageSwitch, useI18n } from "../i18n";

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (session: AuthSession) => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const session = await api<AuthSession>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onAuthenticated(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("登录失败", "Sign-in failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-language"><LanguageSwitch /></div>
      <section className="login-manifesto">
        <div className="login-brand">
          <span><Radar size={24} /></span>
          <div>
            <strong>PRODUCT RADAR</strong>
            <small>{t("百站计划 · 决策系统", "100-Site Plan · Decision System")}</small>
          </div>
        </div>
        <div className="login-copy">
          <span className="eyebrow">{t("私有调研工作区", "PRIVATE RESEARCH WORKSPACE")}</span>
          <h1>{t("把市场噪音，变成下一步产品决策。", "Turn market noise into your next product decision.")}</h1>
          <p>{t("你的信号、API 预算和调研结论只向授权操作者开放。", "Your signals, API budget, and research conclusions stay private to the authorized operator.")}</p>
        </div>
        <div className="login-proof">
          <ShieldCheck size={18} />
          <span>{t("安全会话 · 请求保护 · 费用限额", "Secure session · Request protection · Cost limits")}</span>
        </div>
      </section>
      <section className="login-rail">
        <form onSubmit={submit}>
          <LockKeyhole size={22} />
          <span className="eyebrow">{t("操作者登录", "OPERATOR ACCESS")}</span>
          <h2>{t("进入产品雷达", "Enter Product Radar")}</h2>
          <label>
            {t("账号", "Username")}
            <span className="login-input">
              <UserRound size={16} />
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
                required
              />
            </span>
          </label>
          <label>
            {t("密码", "Password")}
            <span className="login-input">
              <LockKeyhole size={16} />
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button
            className="button button--primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? t("验证中…", "Signing in…") : t("安全进入", "Sign in securely")}
          </button>
        </form>
      </section>
    </main>
  );
}
