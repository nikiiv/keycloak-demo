import { Fragment, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useBffUser, useKeycloakProfile } from '../api/queries';

function joinCodes(roles: string[]): ReactNode {
  return roles.map((r, i) => (
    <Fragment key={r}>
      {i > 0 && ' '}
      <code>{r}</code>
    </Fragment>
  ));
}

export function UnauthorizedBanner() {
  const { authenticated } = useAuth();
  const profile = useKeycloakProfile(authenticated);
  const bff = useBffUser(authenticated);

  if (!authenticated) return null;
  if (!bff.data || bff.data.ok) return null;

  const body = (bff.data.body ?? {}) as Record<string, any>;
  const username = body.username ?? profile.data?.username ?? '(unknown)';
  const allowed = (body.allowedRoles ?? []) as string[];
  const yours = (body.yourRoles ?? profile.data?.roles ?? []) as string[];
  const message = body.message ?? 'Not authorized for this app.';

  return (
    <div className="unauth-banner">
      <strong>⛔ {message}</strong>
      <div>
        Logged in as <code>{username}</code>. Allowed role(s):{' '}
        {allowed.length ? joinCodes(allowed) : <em>(none configured)</em>}. You hold:{' '}
        {yours.length ? joinCodes(yours) : <em>none</em>}.
      </div>
    </div>
  );
}
