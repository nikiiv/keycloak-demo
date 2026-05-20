import type { ReactNode } from 'react';
import type { MfeKey } from 'shell-api';
import { useAuth } from '../auth/AuthProvider';
import { useWhoAmI } from '../api/queries';

interface RoleGateProps {
  mfe: MfeKey;
  children: ReactNode;
}

export function RoleGate({ mfe, children }: RoleGateProps) {
  const { authenticated, login } = useAuth();
  const whoami = useWhoAmI(authenticated);

  if (!authenticated) {
    return (
      <>
        <h1>Sign in required</h1>
        <p className="error">You need to sign in to access this section.</p>
        <button onClick={() => login()}>Sign in</button>
      </>
    );
  }

  if (whoami.isLoading) {
    return <p>Loading…</p>;
  }

  const allowed = whoami.data?.allowedMfes ?? [];
  if (!allowed.includes(mfe)) {
    return (
      <div className="unauth-banner">
        <strong>⛔ This section is restricted.</strong>
        <div>
          You hold:{' '}
          {(whoami.data?.roles ?? []).length ? (
            (whoami.data?.roles ?? []).map((r) => (
              <code key={r} style={{ marginRight: '0.4rem' }}>
                {r}
              </code>
            ))
          ) : (
            <em>no roles</em>
          )}
          . Allowed MFEs:{' '}
          {allowed.length ? (
            allowed.map((m) => (
              <code key={m} style={{ marginRight: '0.4rem' }}>
                {m}
              </code>
            ))
          ) : (
            <em>none</em>
          )}
          .
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
