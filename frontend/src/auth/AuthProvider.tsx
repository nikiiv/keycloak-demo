import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { keycloak } from './keycloak';

interface AuthContextValue {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// keycloak-js init() must run exactly once for the lifetime of the page. React
// 18 StrictMode double-fires effects in dev, and the SPA can be re-mounted by
// router transitions, so we gate behind a module-level promise.
let initPromise: Promise<boolean> | null = null;
function initOnce(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
      silentCheckSsoFallback: false,
      checkLoginIframe: false,
      pkceMethod: 'S256'
    });
  }
  return initPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initOnce()
      .then((ok) => {
        if (cancelled) return;
        setAuthenticated(ok);
        setReady(true);
      })
      .catch((err) => {
        console.error('Keycloak init error:', err);
        if (cancelled) return;
        setReady(true);
      });

    keycloak.onAuthSuccess = () => setAuthenticated(true);
    keycloak.onAuthLogout = () => setAuthenticated(false);
    keycloak.onAuthRefreshError = () => setAuthenticated(false);

    return () => {
      cancelled = true;
      keycloak.onAuthSuccess = undefined;
      keycloak.onAuthLogout = undefined;
      keycloak.onAuthRefreshError = undefined;
    };
  }, []);

  const value: AuthContextValue = {
    ready,
    authenticated,
    // Landing on /work after auth matches the old SPA behaviour; the redirect
    // is allowed by the client's redirectUris pattern in realm-export.json.
    login: () => keycloak.login({ redirectUri: window.location.origin + '/work' }),
    logout: () => keycloak.logout()
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function hasRole(role: string): boolean {
  return (keycloak.realmAccess?.roles ?? []).includes(role);
}
