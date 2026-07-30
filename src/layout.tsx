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
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "./api";
import { NavLink, usePath } from "./router";

interface Settings {
  researchMode: "DEMO" | "REAL";
  aiProvider: "gateway" | "openai";
  aiModel: string;
  aiConfigured: boolean;
  searchConfigured: boolean;
}

const navigation = [
  { to: "/", label: "今日决策", icon: LayoutDashboard },
  { to: "/radar", label: "雷达库", icon: Radar },
  { to: "/products", label: "产品库", icon: Boxes },
  { to: "/signals", label: "信号收件箱", icon: Inbox },
  { to: "/operations", label: "系统状态", icon: Settings2 },
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "今天，下一步做什么？", subtitle: "从全部机会中找出最值得投入的一件事。" },
  "/radar": { title: "产品雷达库", subtitle: "完整保存每个候选、证据、评分与判断变化。" },
  "/products": { title: "已上线与在建产品", subtitle: "让推荐考虑你已经拥有的产品资产。" },
  "/signals": { title: "信号收件箱", subtitle: "把点子、抱怨与评论变成可调研的候选产品。" },
  "/operations": { title: "生产运行状态", subtitle: "检查数据源、预算、任务、备份与证据新鲜度。" },
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
  const path = usePath();
  const title =
    pageTitles[path] ??
    (path.startsWith("/radar/")
      ? { title: "机会调研档案", subtitle: "查看结论、证据与每次重新评分。" }
      : { title: "产品雷达", subtitle: "" });

  useEffect(() => {
    api<Settings>("/api/settings").then(setSettings).catch(() => null);
    setMenuOpen(false);
  }, [path]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand__mark">
            <Radar size={22} strokeWidth={1.8} />
          </div>
          <div>
            <strong>PRODUCT RADAR</strong>
            <span>百站计划 · 决策系统</span>
          </div>
          <button
            className="icon-button mobile-only"
            aria-label="关闭菜单"
            onClick={() => setMenuOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="主导航">
          <span className="nav-label">WORKSPACE</span>
          {navigation.map((item) => {
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
        </nav>

        <div className="sidebar__spacer" />
        <div className="system-card">
          <div className="system-card__top">
            <Database size={16} />
            <span>RESEARCH ENGINE</span>
          </div>
          <strong>{settings?.researchMode === "REAL" ? "真实数据模式" : "演示数据模式"}</strong>
          <p>
            {settings?.researchMode === "REAL"
              ? `${settings.aiProvider} / ${settings.aiModel} · 数据源已连接`
              : "使用可重复的模拟证据，不冒充真实市场调研。"}
          </p>
          <i className={settings?.researchMode === "REAL" ? "status-dot status-dot--live" : "status-dot"} />
        </div>
        {authRequired && (
          <button className="sidebar-logout" onClick={onLogout}>
            <LogOut size={15} />
            退出安全会话
          </button>
        )}
      </aside>

      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="打开菜单"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="topbar__titles">
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>
          <button className="button button--primary quick-add" onClick={onQuickAdd}>
            <Plus size={16} />
            添加信号
          </button>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
