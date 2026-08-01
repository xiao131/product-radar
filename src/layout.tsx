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
import { NavLink, usePath } from "./router";

interface Settings {
  researchMode: "DEMO" | "REAL";
  aiProvider: "gateway" | "openai" | "anthropic" | "deepseek";
  aiModel: string;
  aiConfigured: boolean;
  searchConfigured: boolean;
}

const primaryNavigation = [
  { to: "/", label: "今日结论", icon: LayoutDashboard },
  { to: "/radar", label: "候选产品", icon: Radar },
  { to: "/products", label: "我的产品", icon: Boxes },
];

const systemNavigation = [
  { to: "/signals", label: "原始证据", icon: Inbox },
  { to: "/operations", label: "运行状态", icon: Activity },
  { to: "/settings", label: "设置", icon: Settings2 },
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "今天，下一步做什么？", subtitle: "直接查看当前最值得开发的产品及判断依据。" },
  "/radar": { title: "候选产品库", subtitle: "按评分比较所有候选、证据和判断变化。" },
  "/products": { title: "我的产品", subtitle: "查看已上线与在建产品，让推荐避开重复建设。" },
  "/signals": { title: "原始证据库", subtitle: "系统自动归并并保留可追溯来源；无需逐条处理。" },
  "/operations": { title: "数据与运行状态", subtitle: "查看采集成本、任务、备份与证据新鲜度。" },
  "/settings": { title: "设置", subtitle: "配置 AI、自动发现、市场、成本与数据缓存。" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia("(max-width: 900px)").matches,
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const path = usePath();
  const title =
    pageTitles[path] ??
    (path.startsWith("/radar/")
      ? { title: "机会调研档案", subtitle: "查看结论、证据与每次重新评分。" }
      : { title: "产品雷达", subtitle: "" });

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
            <span>百站计划 · 决策系统</span>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button mobile-only"
            aria-label="关闭菜单"
            onClick={closeMenu}
          >
            <X size={19} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="主导航">
          <span className="nav-label">结果</span>
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
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          <span className="nav-label">数据与系统</span>
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
                <span>{item.label}</span>
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
                ? "真实数据模式"
                : "演示数据模式"
              : settingsError
                ? "模式状态未知"
                : "正在读取模式"}
          </strong>
          <p>
            {settings
              ? settings.researchMode === "REAL"
                ? `${settings.aiProvider} / ${settings.aiModel} · 数据源已连接`
                : "使用可重复的模拟证据，不冒充真实市场调研。"
              : settingsError
                ? "设置读取失败，不能确认当前数据模式。"
                : "正在读取研究引擎状态…"}
          </p>
          {settingsError && (
            <button className="system-card__retry" onClick={loadSettings}>
              重试
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
            退出安全会话
          </button>
        )}
      </aside>

      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭菜单"
          onClick={closeMenu}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="icon-button mobile-only"
            aria-label="打开菜单"
            aria-expanded={menuOpen}
            onClick={openMenu}
          >
            <Menu size={20} />
          </button>
          <div className="topbar__titles">
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>
          <button className="button button--primary quick-add" onClick={onQuickAdd}>
            <Plus size={16} />
            添加线索
          </button>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
