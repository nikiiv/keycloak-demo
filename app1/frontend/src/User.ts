import keycloak from './Keycloak';

export interface User {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  token: string;
}

export async function getUser(): Promise<User | null> {
  if (!keycloak.authenticated) return null;

  const profile = await keycloak.loadUserProfile();
  const token = keycloak.token || '';
  const roles = keycloak.realmAccess?.roles ?? [];

  return {
    username: profile.username || '',
    email: profile.email || '',
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    roles,
    token
  };
}

export async function getBffUser(): Promise<User | null> {
  const token = keycloak.token;
  if (!token) return null;

  try {
    const response = await fetch(`/api/user`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function login() {
  keycloak.login();
}

export function logout() {
  keycloak.logout();
}

export function register() {
  keycloak.register();
}

export function isAuthenticated(): boolean {
  return keycloak.authenticated || false;
}