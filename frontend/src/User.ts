import keycloak from './Keycloak';

export interface User {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  token: string;
}

export interface BffResult {
  status: number;
  ok: boolean;
  body: any;
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

export async function getBffUser(): Promise<BffResult | null> {
  const token = keycloak.token;
  if (!token) return null;

  try {
    const response = await fetch(`/api/user`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body };
  } catch {
    return null;
  }
}

export function login() {
  // Land on /work after a successful auth round-trip. Keycloak honors
  // redirectUri as long as it matches one of the client's redirectUris
  // patterns (configured as "http://localhost:<port>/*" in realm-export.json).
  keycloak.login({ redirectUri: window.location.origin + '/work' });
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

export function hasRole(role: string): boolean {
  const roles = keycloak.realmAccess?.roles ?? [];
  return roles.includes(role);
}