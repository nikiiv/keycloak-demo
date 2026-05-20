import { useAuth } from '../auth/AuthProvider';
import { COPY } from '../theme';

export function Home() {
  const { authenticated, login, logout } = useAuth();
  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">{COPY.heroEyebrow}</div>
        <h1 className="hero-title">{COPY.heroTitle}</h1>
        <p className="hero-body">{COPY.heroBody}</p>
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
