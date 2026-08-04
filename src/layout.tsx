import {
  Boxes,
  Database,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Radar,
  Settings2,
  Activity,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LanguageSwitch, useI18n } from "./i18n";
import { NavLink, usePath } from "./router";

interface Settings {
  researchMode: "DEMO" | "REAL";
  aiProvider: "gateway" | "openai" | "anthropic" | "deepseek";
  aiModel: string;
  aiConfigured: boolean;
  searchConfigured: boolean;
}

const primaryNavigation = [
  { to: "/", zh: "今日结论", en: "Today's decision", icon: LayoutDashboard },
  { to: "/radar", zh: "候选产品", en: "Opportunities", icon: Radar },
  { to: "/products", zh: "我的产品", en: "My products", icon: Boxes },
];

const systemNavigation = [
  { to: "/signals", zh: "原始证据", en: "Raw evidence", icon: Inbox },
  { to: "/operations", zh: "运行状态", en: "Operations", icon: Activity },
  { to: "/settings", zh: "设置", en: "Settings", icon: Settings2 },
];

const pageTitles: Record<string, { zh: [string, string]; en: [string, string] }> = {
  "/": { zh: ["今天，下一步做什么？", "直接查看当前最值得开发的产品及判断依据。"], en: ["What should I build next?", "See the strongest current product opportunity and the evidence behind it."] },
  "/radar": { zh: ["候选产品库", "按评分比较所有候选、证据和判断变化。"], en: ["Opportunity library", "Compare every candidate by score, evidence, and decision changes."] },
  "/products": { zh: ["我的产品", "查看已上线与在建产品，让推荐避开重复建设。"], en: ["My products", "Track live and in-progress products so recommendations avoid duplicate work."] },
  "/signals": { zh: ["原始证据库", "系统自动归并并保留可追溯来源；无需逐条处理。"], en: ["Raw evidence library", "The system deduplicates signals while preserving traceable sources."] },
  "/operations": { zh: ["数据与运行状态", "查看采集成本、任务、备份与证据新鲜度。"], en: ["Data and operations", "Monitor collection cost, jobs, backups, and evidence freshness."] },
  "/settings": { zh: ["设置", "配置 AI、自动发现、市场、成本与数据缓存。"], en: ["Settings", "Configure AI, discovery, markets, cost limits, and caching."] },
};

export function AppLayout({
  children,
  onQuickAdd,
  onLogout,
  authRequired,
}: {
  children: ReactNode;
  onQuickAdd: () => void;
  onLogout: () => void;
  authRequired: boolean;
}) {
  const { locale, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia("(max-width: 900px)").matches,
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const path = usePath();
  const titleCopy = pageTitles[path]?.[locale === "zh-CN" ? "zh" : "en"] ??
    (path.startsWith("/radar/")
      ? locale === "zh-CN"
        ? ["机会调研档案", "查看结论、证据与每次重新评分。"]
        : ["Opportunity research", "Review conclusions, evidence, and every reassessment."]
        : path.startsWith("/products/")
          ? locale === "zh-CN"
            ? ["产品档案", "查看产品状态、证据反馈与关联候选。"]
            : ["Product record", "Review product status, feedback evidence, and related candidates."]
          : [t("产品雷达", "Product Radar"), ""]);
  const title = { title: titleCopy[0], subtitle: titleCopy[1] };

  const loadSettings = useCallback(() => {
    setSettingsError(false);
    api<Settings>("/api/settings")
      .then(setSettings)
      .catch(() => setSettingsError(true));
  }, []);

  useEffect(loadSettings, [loadSettings]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setMenuOpen((wasOpen) => {
      if (wasOpen) {
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
      return false;
    });
  }, [path]);

  function openMenu() {
    setMenuOpen(true);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  function closeMenu() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}
        aria-hidden={isMobile && !menuOpen ? true : undefined}
        inert={isMobile && !menuOpen ? true : undefined}
      >
        <div className="brand">
          <div className="brand__mark">
            <Radar size={22} strokeWidth={1.8} />
          </div>
          <div>
            <strong>PRODUCT RADAR</strong>
            <span>{t("百站计划 · 决策系统", "100-Site Plan · Decision System")}</span>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button mobile-only"
            aria-label={t("关闭菜单", "Close menu")}
            onClick={closeMenu}
          >
            <X size={19} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label={t("主导航", "Main navigation")}>
          <span className="nav-label">{t("结果", "Results")}</span>
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive ? "nav-item nav-item--active" : "nav-item")}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{t(item.zh, item.en)}</span>
              </NavLink>
            );
          })}
          <span className="nav-label">{t("数据与系统", "Data and system")}</span>
          {systemNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? "nav-item nav-item--active" : "nav-item"
                }
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{t(item.zh, item.en)}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__spacer" />
        <div className="system-card">
          <div className="system-card__top">
            <Database size={16} />
            <span>RESEARCH ENGINE</span>
          </div>
          <strong>
            {settings
              ? settings.researchMode === "REAL"
                ? t("真实数据模式", "Live data mode")
                : t("演示数据模式", "Demo data mode")
              : settingsError
                ? t("模式状态未知", "Mode unknown")
                : t("正在读取模式", "Loading mode")}
          </strong>
          <p>
            {settings
              ? settings.researchMode === "REAL"
                ? `${settings.aiProvider} / ${settings.aiModel} · ${t("数据源已连接", "data sources connected")}`
                : t("使用可重复的模拟证据，不冒充真实市场调研。", "Uses repeatable demo evidence and never presents it as live market research.")
              : settingsError
                ? t("设置读取失败，不能确认当前数据模式。", "Settings failed to load, so the current mode cannot be confirmed.")
                : t("正在读取研究引擎状态…", "Loading research engine status…")}
          </p>
          {settingsError && (
            <button className="system-card__retry" onClick={loadSettings}>
              {t("重试", "Retry")}
            </button>
          )}
          <i
            className={
              settings?.researchMode === "REAL"
                ? "status-dot status-dot--live"
                : settings
                  ? "status-dot"
                  : "status-dot status-dot--unknown"
            }
          />
        </div>
        {authRequired && (
          <button className="sidebar-logout" onClick={onLogout}>
            <LogOut size={15} />
            {t("退出安全会话", "Sign out")}
          </button>
        )}
      </aside>

      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label={t("关闭菜单", "Close menu")}
          onClick={closeMenu}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="icon-button mobile-only"
            aria-label={t("打开菜单", "Open menu")}
            aria-expanded={menuOpen}
            onClick={openMenu}
          >
            <Menu size={20} />
          </button>
          <div className="topbar__titles">
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>
          <LanguageSwitch compact />
          <button className="button button--primary quick-add" onClick={onQuickAdd}>
            <Plus size={16} />
            {t("添加线索", "Add signal")}
          </button>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
