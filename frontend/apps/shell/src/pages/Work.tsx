import { useAuth } from '../auth/AuthProvider';
import { useBffUser } from '../api/queries';
import { APP_THEME } from '../theme';
import { WorkClient } from './WorkClient';
import { WorkOps } from './WorkOps';
import { WorkAdmin } from './WorkAdmin';

export function Work() {
  const { authenticated, login } = useAuth();
  const bff = useBffUser(authenticated);

  if (!authenticated) {
    return (
      <>
        <h1>Work</h1>
        <p className="error">Please sign in to access your workspace.</p>
        <button onClick={() => login()}>Sign in</button>
      </>
    );
  }

  const bffOk = bff.data?.ok ?? true;
  if (!bffOk) {
    const message =
      ((bff.data?.body ?? {}) as Record<string, any>).message ?? 'Not authorized for this app.';
    return (
      <>
        <h1>Work</h1>
        <p className="error">This workspace isn't available for your role. {message}</p>
        <p>
          Your role-level access is enforced server-side by the BFF; this tab is disabled
          client-side to match.
        </p>
      </>
    );
  }

  if (APP_THEME === 'c') return <WorkAdmin />;
  if (APP_THEME === 'b') return <WorkOps />;
  return <WorkClient />;
}
