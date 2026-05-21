import { useQuery } from '@tanstack/react-query';
import type { ShellHost } from 'shell-api';

interface BffResult {
  status: number;
  ok: boolean;
  body: unknown;
}

async function fetchBffUser(host: ShellHost): Promise<BffResult> {
  const token = await host.auth.getToken();
  const res = await fetch('/api/client/user', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

export function Protected({ host }: { host: ShellHost }) {
  const query = useQuery<BffResult>({
    queryKey: ['mfe-client', 'protected'],
    queryFn: () => fetchBffUser(host),
    enabled: host.auth.authenticated
  });

  if (!host.auth.authenticated) {
    return (
      <div className="protected anon">
        <h1>Protected Page</h1>
        <p className="status-line">
          <strong>Yellow:</strong> not authenticated.
        </p>
        <p>You must be logged in to view this page.</p>
        <button onClick={() => host.auth.login()}>Login to Access</button>
      </div>
    );
  }

  const isAdmin = host.auth.roles.includes('admin');
  const cls = isAdmin ? 'admin' : 'auth';
  const label = isAdmin ? (
    <>
      <strong>Red:</strong> authenticated with <code>admin</code> role.
    </>
  ) : (
    <>
      <strong>Blue:</strong> authenticated with <code>user</code> role only (no <code>admin</code>).
    </>
  );

  const bffStatus = query.data ? (
    <p>
      <strong>
        <code>/api/client/user</code>:
      </strong>{' '}
      HTTP {query.data.status} {query.data.ok ? '✓' : '✗'}
    </p>
  ) : (
    <p>
      <strong>BFF:</strong> {query.isLoading ? '(loading…)' : '(no response)'}
    </p>
  );

  return (
    <div className={`protected ${cls}`}>
      <h1>Protected Page</h1>
      <p className="status-line">{label}</p>
      {bffStatus}
      <div className="user-info">
        <strong>bff-client response:</strong>
        <pre>{JSON.stringify(query.data?.body ?? null, null, 2)}</pre>
      </div>
    </div>
  );
}
