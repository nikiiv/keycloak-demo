import { Link } from 'react-router-dom';
import type { MfeKey } from 'shell-api';
import { useAuth } from '../auth/AuthProvider';
import { useWhoAmI } from '../api/queries';
import { APP_NAME, SHELL_BRAND_MARK, SHELL_NAV_SUB } from '../theme';

const MFE_LABEL: Record<MfeKey, string> = {
  client: 'Client',
  ops: 'Ops',
  admin: 'Admin'
};

const MFE_PATH: Record<MfeKey, string> = {
  client: '/client',
  ops: '/ops',
  admin: '/admin'
};

export function Nav() {
  const { authenticated, username, email, logout } = useAuth();
  const whoami = useWhoAmI(authenticated);

  const allowed = whoami.data?.allowedMfes ?? [];
  const allMfes: MfeKey[] = ['client', 'ops', 'admin'];

  return (
    <nav>
      <Link to="/">Home</Link>
      {allMfes.map((m) => {
        const isAllowed = !authenticated || allowed.includes(m);
        return isAllowed ? (
          <Link key={m} to={MFE_PATH[m]}>
            {MFE_LABEL[m]}
          </Link>
        ) : (
          <span
            key={m}
            className="nav-disabled"
            aria-disabled="true"
            title={`Not available — your roles don't grant access to ${MFE_LABEL[m]}.`}
          >
            {MFE_LABEL[m]}
          </span>
        );
      })}
      <Link to="/client/protected">Protected</Link>
      <Link to="/client/profile">Profile</Link>
      {authenticated && (
        <div className="nav-session">
          <div className="nav-user">
            <div className="nav-user-name">{username ?? '(unknown)'}</div>
            {email && <div className="nav-user-email">{email}</div>}
          </div>
          <button className="logout small" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      )}
      <div className="nav-brand">
        <span className="nav-brand-mark" dangerouslySetInnerHTML={{ __html: SHELL_BRAND_MARK }} />
        <span className="nav-brand-text">
          {APP_NAME}
          <span className="nav-brand-sub">{SHELL_NAV_SUB}</span>
        </span>
      </div>
    </nav>
  );
}
