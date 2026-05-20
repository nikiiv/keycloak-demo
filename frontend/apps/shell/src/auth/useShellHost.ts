import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ShellHost, ThemeKey } from 'shell-api';
import { useAuth } from './AuthProvider';

export function useShellHost(theme: ThemeKey): ShellHost {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMemo<ShellHost>(
    () => ({
      auth: {
        authenticated: auth.authenticated,
        username: auth.username,
        email: auth.email,
        roles: auth.roles,
        login: auth.login,
        logout: auth.logout,
        getToken: auth.getToken,
        loadProfile: auth.loadProfile
      },
      queryClient,
      navigate: (path: string) => navigate(path),
      theme
    }),
    [
      auth.authenticated,
      auth.username,
      auth.email,
      auth.roles,
      auth.login,
      auth.logout,
      auth.getToken,
      auth.loadProfile,
      queryClient,
      navigate,
      theme
    ]
  );
}
