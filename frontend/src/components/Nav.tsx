import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useBffUser, useKeycloakProfile } from '../api/queries';
import { APP_NAME, COPY } from '../theme';

export function Nav() {
  const { authenticated, logout } = useAuth();
  const profile = useKeycloakProfile(authenticated);
  const bff = useBffUser(authenticated);

  const bffOk = bff.data?.ok ?? true;
  const blockReason =
    (bff.data?.body && (bff.data.body as any).message) ?? 'Not authorized for this app.';

  const workLink = bffOk ? (
    <Link to="/work">Work</Link>
  ) : (
    <span className="nav-disabled" aria-disabled="true" title={`Not available — ${blockReason}`}>
      Work
    </span>
  );

  return (
    <nav>
      <Link to="/">Home</Link>
      {workLink}
      <Link to="/protected">Protected</Link>
      <Link to="/profile">Profile</Link>
      {authenticated && (
        <div className="nav-session">
          <div className="nav-user">
            <div className="nav-user-name">{profile.data?.username ?? '(unknown)'}</div>
            {profile.data?.email && <div className="nav-user-email">{profile.data.email}</div>}
          </div>
          <button className="logout small" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      )}
      <div className="nav-brand">
        <span className="nav-brand-mark" dangerouslySetInnerHTML={{ __html: COPY.brandMark }} />
        <span className="nav-brand-text">
          {APP_NAME}
          <span className="nav-brand-sub">{COPY.navSub}</span>
        </span>
      </div>
    </nav>
  );
}
