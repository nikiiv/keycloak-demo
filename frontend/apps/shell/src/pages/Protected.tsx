import { useAuth, hasRole } from '../auth/AuthProvider';
import { useBffUser, useKeycloakProfile } from '../api/queries';

export function Protected() {
  const { authenticated, login } = useAuth();
  const profile = useKeycloakProfile(authenticated);
  const bff = useBffUser(authenticated);

  if (!authenticated) {
    return (
      <div className="protected anon">
        <h1>Protected Page</h1>
        <p className="status-line">
          <strong>Yellow:</strong> not authenticated.
        </p>
        <p>You must be logged in to view this page.</p>
        <button onClick={() => login()}>Login to Access</button>
      </div>
    );
  }

  const isAdmin = hasRole('admin');
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

  const bffStatus = bff.data ? (
    <p>
      <strong>
        BFF <code>/api/user</code>:
      </strong>{' '}
      HTTP {bff.data.status} {bff.data.ok ? '✓' : '✗'}
    </p>
  ) : (
    <p>
      <strong>BFF:</strong> (no response)
    </p>
  );

  const display = bff.data?.body ?? profile.data ?? null;

  return (
    <div className={`protected ${cls}`}>
      <h1>Protected Page</h1>
      <p className="status-line">{label}</p>
      {bffStatus}
      <div className="user-info">
        <strong>BFF Response:</strong>
        <pre>{JSON.stringify(display, null, 2)}</pre>
      </div>
    </div>
  );
}
