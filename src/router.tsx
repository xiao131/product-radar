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
  scroll?: boolean;
}

interface RouterContextValue {
  path: string;
  search: string;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function currentLocation() {
  return `${window.location.pathname}${window.location.search}`;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    if (options?.replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    setLocation(currentLocation());
    if (options?.scroll !== false) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, []);

  const queryIndex = location.indexOf("?");
  const path = queryIndex >= 0 ? location.slice(0, queryIndex) : location;
  const search = queryIndex >= 0 ? location.slice(queryIndex) : "";
  const value = useMemo(
    () => ({ path, search, navigate }),
    [navigate, path, search],
  );
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

export function useSearch() {
  return useRouter().search;
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
