import { lazy, Suspense, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AuthSession, Signal } from "../shared/types";
import { LoadingState, Modal } from "./components";
import { SignalForm } from "./forms";
import { AppLayout } from "./layout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { RadarPage } from "./pages/RadarPage";
import { useNavigate, usePath } from "./router";
import { api } from "./api";
import { useI18n } from "./i18n";

const OpportunityDetailPage = lazy(() =>
  import("./pages/OpportunityDetailPage").then((module) => ({
    default: module.OpportunityDetailPage,
  })),
);
const OperationsPage = lazy(() =>
  import("./pages/OperationsPage").then((module) => ({ default: module.OperationsPage })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage").then((module) => ({ default: module.ProductsPage })),
);
const ProductDetailPage = lazy(() =>
  import("./pages/ProductDetailPage").then((module) => ({ default: module.ProductDetailPage })),
);
const SignalsPage = lazy(() =>
  import("./pages/SignalsPage").then((module) => ({ default: module.SignalsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

function RoutedPage() {
  const path = usePath();
  const navigate = useNavigate();
  const knownPath =
    path === "/" ||
    path === "/radar" ||
    path.startsWith("/radar/") ||
    path === "/products" ||
    path.startsWith("/products/") ||
    path === "/signals" ||
    path === "/operations" ||
    path === "/settings";

  useEffect(() => {
    if (!knownPath) navigate("/", { replace: true });
  }, [knownPath, navigate]);

  if (path === "/radar") return <RadarPage />;
  if (path.startsWith("/radar/")) return <OpportunityDetailPage />;
  if (path.startsWith("/products/")) return <ProductDetailPage />;
  if (path === "/products") return <ProductsPage />;
  if (path === "/signals") return <SignalsPage />;
  if (path === "/operations") return <OperationsPage />;
  if (path === "/settings") return <SettingsPage />;
  return <DashboardPage />;
}

export default function App() {
  const { t } = useI18n();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [quickAddNotice, setQuickAddNotice] = useState<Signal | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadSession = () => {
      api<AuthSession>("/api/auth/session")
        .then(setSession)
        .catch(() =>
          setSession({ authenticated: false, authRequired: true, csrfToken: null }),
        );
    };
    loadSession();
    window.addEventListener("product-radar:unauthorized", loadSession);
    return () =>
      window.removeEventListener("product-radar:unauthorized", loadSession);
  }, []);

  useEffect(() => {
    if (!quickAddNotice) return;
    const timer = window.setTimeout(() => setQuickAddNotice(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [quickAddNotice]);

  async function logout() {
    await api<AuthSession>("/api/auth/logout", { method: "POST" });
    setSession({ authenticated: false, authRequired: true, csrfToken: null });
  }

  if (!session) return <div className="app-loading">{t("正在验证安全会话…", "Checking secure session…")}</div>;
  if (!session.authenticated) {
    return <LoginPage onAuthenticated={setSession} />;
  }

  return (
    <AppLayout
      onQuickAdd={() => setQuickAddOpen(true)}
      onLogout={() => void logout()}
      authRequired={session.authRequired}
    >
      <Suspense fallback={<LoadingState label={t("正在加载页面", "Loading page")} />}>
        <RoutedPage />
      </Suspense>
      <Modal
        title={t("捕捉一条新信号", "Capture a new signal")}
        subtitle={t("先记录，再决定是否值得进入调研。", "Capture it first, then decide whether it deserves research.")}
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      >
        <SignalForm
          onCancel={() => setQuickAddOpen(false)}
          onSaved={(signal) => {
            setQuickAddOpen(false);
            setQuickAddNotice(signal);
          }}
        />
      </Modal>
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {quickAddNotice && (
          <div className="toast" role="status">
            <div>
              <strong>{t("线索已保存", "Signal saved")}</strong>
              <span>{quickAddNotice.title}</span>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setQuickAddNotice(null);
                navigate("/signals");
              }}
            >
              {t("查看证据", "View evidence")}
            </button>
            <button
              className="icon-button"
              aria-label={t("关闭通知", "Close notification")}
              onClick={() => setQuickAddNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
