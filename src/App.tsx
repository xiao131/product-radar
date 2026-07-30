import { useEffect, useState } from "react";
import { Modal } from "./components";
import { SignalForm } from "./forms";
import { AppLayout } from "./layout";
import { DashboardPage } from "./pages/DashboardPage";
import { OpportunityDetailPage } from "./pages/OpportunityDetailPage";
import { ProductsPage } from "./pages/ProductsPage";
import { RadarPage } from "./pages/RadarPage";
import { SignalsPage } from "./pages/SignalsPage";
import { useNavigate, usePath } from "./router";

function RoutedPage() {
  const path = usePath();
  const navigate = useNavigate();
  const knownPath =
    path === "/" ||
    path === "/radar" ||
    path.startsWith("/radar/") ||
    path === "/products" ||
    path === "/signals";

  useEffect(() => {
    if (!knownPath) navigate("/", { replace: true });
  }, [knownPath, navigate]);

  if (path === "/radar") return <RadarPage />;
  if (path.startsWith("/radar/")) return <OpportunityDetailPage />;
  if (path === "/products") return <ProductsPage />;
  if (path === "/signals") return <SignalsPage />;
  return <DashboardPage />;
}

export default function App() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <AppLayout onQuickAdd={() => setQuickAddOpen(true)}>
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
