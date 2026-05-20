import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ShellHost, ThemeKey } from 'shell-api';
import { useAuth } from './AuthProvider';
import { keycloak } from './keycloak';

export function useShellHost(theme: ThemeKey): ShellHost {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMemo<ShellHost>(
    () => ({
      auth: {
        authenticated: auth.authenticated,
        username: (keycloak.tokenParsed as any)?.preferred_username ?? null,
        login: auth.login,
        logout: auth.logout,
        getToken: async () => {
          if (!keycloak.authenticated) return null;
          try {
            await keycloak.updateToken(30);
          } catch {
            return null;
          }
          return keycloak.token ?? null;
        }
      },
      queryClient,
      navigate: (path: string) => navigate(path),
      theme
    }),
    [auth.authenticated, auth.login, auth.logout, queryClient, navigate, theme]
  );
}
