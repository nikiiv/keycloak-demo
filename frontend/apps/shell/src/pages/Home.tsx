import { useAuth } from '../auth/AuthProvider';

export function Home() {
  const { authenticated, login, logout } = useAuth();
  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Microfrontend SSO Demo</div>
        <h1 className="hero-title">One sign-in. Three role-gated workspaces.</h1>
        <p className="hero-body">
          This shell signs you in once against Keycloak and then mounts whichever microfrontends
          your role grants — Client, Ops, or Admin. Disabled nav links and the unauthorized
          banner mirror the same decision the BFF makes server-side; the BFF stays the source
          of truth for access.
        </p>
      </div>
      {authenticated ? (
        <button className="logout" onClick={() => logout()}>
          Sign out
        </button>
      ) : (
        <button onClick={() => login()}>Sign in</button>
      )}
    </>
  );
}
