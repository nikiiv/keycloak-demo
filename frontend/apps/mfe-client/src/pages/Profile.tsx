import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ShellHost } from 'shell-api';

export function Profile({ host }: { host: ShellHost }) {
  const profile = useQuery({
    queryKey: ['shell', 'profile'],
    queryFn: () => host.auth.loadProfile(),
    enabled: host.auth.authenticated,
    staleTime: Infinity
  });

  if (!host.auth.authenticated) {
    return (
      <>
        <h1>Profile</h1>
        <p className="error">Please log in to view your profile.</p>
        <button onClick={() => host.auth.login()}>Login</button>
      </>
    );
  }

  const username = profile.data?.username || host.auth.username || 'N/A';
  const email = profile.data?.email || host.auth.email || 'N/A';
  const firstName = profile.data?.firstName ?? '';
  const lastName = profile.data?.lastName ?? '';
  const roles = host.auth.roles;

  return (
    <>
      <h1>Your Profile</h1>
      <div className="user-info">
        <p>
          <strong>Username:</strong> {username}
        </p>
        <p>
          <strong>Email:</strong> {email}
        </p>
        <p>
          <strong>Name:</strong> {firstName} {lastName}
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
      </div>
      <button className="logout" style={{ marginTop: '1rem' }} onClick={() => host.auth.logout()}>
        Logout
      </button>
    </>
  );
}
