import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';

export type ThemeKey = 'a' | 'b' | 'c';

export type MfeKey = 'client' | 'ops' | 'admin';

export interface ShellProfile {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ShellAuth {
  authenticated: boolean;
  username: string | null;
  email: string | null;
  roles: string[];
  login: () => void;
  logout: () => void;
  getToken: () => Promise<string | null>;
  loadProfile: () => Promise<ShellProfile | null>;
}

export interface ShellHost {
  auth: ShellAuth;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  theme: ThemeKey;
}

export interface MfeProps {
  host: ShellHost;
}

export type MfeComponent = ComponentType<MfeProps>;

export interface WhoAmI {
  username: string;
  email: string;
  roles: string[];
  allowedMfes: MfeKey[];
}
