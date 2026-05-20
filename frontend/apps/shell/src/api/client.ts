import { keycloak } from '../auth/keycloak';

export interface BffResult {
  status: number;
  ok: boolean;
  body: any;
}

async function freshToken(): Promise<string | null> {
  if (!keycloak.authenticated) return null;
  try {
    await keycloak.updateToken(30);
  } catch {
    return null;
  }
  return keycloak.token ?? null;
}

// Never throws on HTTP errors — the BFF returns 403 with a structured body
// that the UI needs to render (the unauthorized banner reads from it).
export async function fetchBff(path: string): Promise<BffResult> {
  const token = await freshToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}
