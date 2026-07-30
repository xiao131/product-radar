import { useEffect, useState } from "react";
import { Modal } from "./components";
import { SignalForm } from "./forms";
import { AppLayout } from "./layout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OpportunityDetailPage } from "./pages/OpportunityDetailPage";
import { OperationsPage } from "./pages/OperationsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { RadarPage } from "./pages/RadarPage";
import { SignalsPage } from "./pages/SignalsPage";
import { useNavigate, usePath } from "./router";
import { api } from "./api";

interface AuthSession {
  authenticated: boolean;
  authRequired: boolean;
  csrfToken: string | null;
}

function RoutedPage() {
  const path = usePath();
  const navigate = useNavigate();
  const knownPath =
    path === "/" ||
    path === "/radar" ||
    path.startsWith("/radar/") ||
    path === "/products" ||
    path === "/signals" ||
    path === "/operations";

  useEffect(() => {
    if (!knownPath) navigate("/", { replace: true });
  }, [knownPath, navigate]);

  if (path === "/radar") return <RadarPage />;
  if (path.startsWith("/radar/")) return <OpportunityDetailPage />;
  if (path === "/products") return <ProductsPage />;
  if (path === "/signals") return <SignalsPage />;
  if (path === "/operations") return <OperationsPage />;
  return <DashboardPage />;
}

export default function App() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

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

  async function logout() {
    await api<AuthSession>("/api/auth/logout", { method: "POST" });
    setSession({ authenticated: false, authRequired: true, csrfToken: null });
  }

  if (!session) return <div className="app-loading">正在验证安全会话…</div>;
  if (!session.authenticated) {
    return <LoginPage onAuthenticated={setSession} />;
  }

  return (
    <AppLayout
      onQuickAdd={() => setQuickAddOpen(true)}
      onLogout={() => void logout()}
      authRequired={session.authRequired}
    >
      <RoutedPage />
      <Modal
        title="捕捉一条新信号"
        subtitle="先记录，再决定是否值得进入调研。"
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      >
        <SignalForm
          onCancel={() => setQuickAddOpen(false)}
          onSaved={() => setQuickAddOpen(false)}
        />
      </Modal>
    </AppLayout>
  );
}
