import { Fragment } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useKeycloakProfile } from '../api/queries';

export function Profile() {
  const { authenticated, login, logout } = useAuth();
  const profile = useKeycloakProfile(authenticated);

  if (!authenticated) {
    return (
      <>
        <h1>Profile</h1>
        <p className="error">Please log in to view your profile.</p>
        <button onClick={() => login()}>Login</button>
      </>
    );
  }

  const roles = profile.data?.roles ?? [];
  const token = profile.data?.token ?? '';

  return (
    <>
      <h1>Your Profile</h1>
      <div className="user-info">
        <p>
          <strong>Username:</strong> {profile.data?.username || 'N/A'}
        </p>
        <p>
          <strong>Email:</strong> {profile.data?.email || 'N/A'}
        </p>
        <p>
          <strong>Name:</strong> {profile.data?.firstName ?? ''} {profile.data?.lastName ?? ''}
        </p>
        <p>
          <strong>Roles:</strong>{' '}
          {roles.length ? (
            roles.map((r, i) => (
              <Fragment key={r}>
                {i > 0 && ' '}
                <code>{r}</code>
              </Fragment>
            ))
          ) : (
            <em>none</em>
          )}
        </p>
        <p>
          <strong>Token (first 20 chars):</strong> {token.substring(0, 20)}...
        </p>
      </div>
      <button className="logout" style={{ marginTop: '1rem' }} onClick={() => logout()}>
        Logout
      </button>
    </>
  );
}
