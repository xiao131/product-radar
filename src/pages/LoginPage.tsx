import { LockKeyhole, Radar, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { AuthSession } from "../../shared/types";
import { api } from "../api";

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (session: AuthSession) => void;
}) {
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
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-manifesto">
        <div className="login-brand">
          <span><Radar size={24} /></span>
          <div>
            <strong>PRODUCT RADAR</strong>
            <small>百站计划 · 决策系统</small>
          </div>
        </div>
        <div className="login-copy">
          <span className="eyebrow">PRIVATE RESEARCH WORKSPACE</span>
          <h1>把市场噪音，变成下一步产品决策。</h1>
          <p>你的信号、API 预算和调研结论只向授权操作者开放。</p>
        </div>
        <div className="login-proof">
          <ShieldCheck size={18} />
          <span>HttpOnly 会话 · CSRF 保护 · 费用限额</span>
        </div>
      </section>
      <section className="login-rail">
        <form onSubmit={submit}>
          <LockKeyhole size={22} />
          <span className="eyebrow">OPERATOR ACCESS</span>
          <h2>进入产品雷达</h2>
          <label>
            账号
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
            密码
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
            {submitting ? "验证中…" : "安全进入"}
          </button>
        </form>
      </section>
    </main>
  );
}
