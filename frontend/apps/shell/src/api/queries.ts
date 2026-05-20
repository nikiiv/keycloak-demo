import { useQuery } from '@tanstack/react-query';
import type { WhoAmI } from 'shell-api';
import { keycloak } from '../auth/keycloak';
import { fetchBff, type BffResult } from './client';

export interface KeycloakUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  token: string;
}

export function useKeycloakProfile(enabled: boolean) {
  return useQuery<KeycloakUser>({
    queryKey: ['keycloak', 'profile'],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const profile = await keycloak.loadUserProfile();
      return {
        username: profile.username ?? '',
        email: profile.email ?? '',
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        roles: keycloak.realmAccess?.roles ?? [],
        token: keycloak.token ?? ''
      };
    }
  });
}

export function useBffUser(enabled: boolean) {
  return useQuery<BffResult>({
    queryKey: ['bff', 'user'],
    enabled,
    queryFn: () => fetchBff('/api/user')
  });
}

export function useWhoAmI(enabled: boolean) {
  return useQuery<WhoAmI | null>({
    queryKey: ['bff', 'whoami'],
    enabled,
    queryFn: async () => {
      const r = await fetchBff('/api/whoami');
      if (!r.ok) return null;
      return r.body as WhoAmI;
    }
  });
}
