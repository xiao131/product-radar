import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface NavigateOptions {
  replace?: boolean;
}

interface RouterContextValue {
  path: string;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function currentPath() {
  return window.location.pathname;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    if (options?.replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    setPath(currentPath());
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [navigate, path]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const router = useContext(RouterContext);
  if (!router) throw new Error("Router hooks must be used inside RouterProvider");
  return router;
}

export function usePath() {
  return useRouter().path;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function NavLink({
  to,
  end = false,
  className,
  children,
}: {
  to: string;
  end?: boolean;
  className: string | ((state: { isActive: boolean }) => string);
  children: ReactNode;
}) {
  const { path, navigate } = useRouter();
  const isActive = end ? path === to : path === to || path.startsWith(`${to}/`);
  const resolvedClassName =
    typeof className === "function" ? className({ isActive }) : className;

  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return (
    <a
      href={to}
      className={resolvedClassName}
      aria-current={isActive ? "page" : undefined}
      onClick={follow}
    >
      {children}
    </a>
  );
}
