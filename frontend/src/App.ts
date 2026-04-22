import keycloak from './Keycloak';
import { User, BffResult, getUser, getBffUser, login, logout, isAuthenticated, hasRole } from './User';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'SSO Demo';
const APP_TITLE = (import.meta.env.VITE_APP_TITLE ?? APP_NAME) as string;
const REQUIRED_ROLE = (import.meta.env.VITE_REQUIRED_ROLE ?? '').trim();

document.title = APP_TITLE;

export class DemoApp {
  private user: User | null = null;
  private bff: BffResult | null = null;

  async init() {
    try {
      const authenticated = await keycloak.init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        silentCheckSsoFallback: false,
        checkLoginIframe: false,
        pkceMethod: 'S256'
      });

      if (authenticated) {
        this.user = await getUser();
        this.bff = await getBffUser();
      }
    } catch (e) {
      console.error('Keycloak init error:', e);
    }

    this.render();
  }

  render() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <nav>
        <a href="/">Home</a>
        <a href="/protected">Protected</a>
        <a href="/profile">Profile</a>
        <span>${APP_NAME}</span>
      </nav>
      ${this.renderUnauthorizedBanner()}
      <div class="page">
        ${this.renderContent()}
      </div>
    `;
    this.attachEventListeners();
  }

  renderUnauthorizedBanner() {
    if (!REQUIRED_ROLE) return '';
    if (!isAuthenticated()) return '';
    if (hasRole(REQUIRED_ROLE)) return '';

    const username = this.user?.username ?? '(unknown)';
    const roles = this.user?.roles ?? [];
    const rolesStr = roles.length ? roles.map(r => `<code>${r}</code>`).join(' ') : '<em>none</em>';
    return `
      <div class="unauth-banner">
        <strong>⚠ Your current authorization does not allow you to use this app.</strong>
        <div>This app requires role <code>${REQUIRED_ROLE}</code>. You are logged in as <code>${username}</code> with roles: ${rolesStr}.</div>
      </div>
    `;
  }

  renderContent() {
    const path = window.location.pathname;
    if (path === '/protected') return this.renderProtected();
    if (path === '/profile') return this.renderProfile();
    return this.renderHome();
  }

  renderHome() {
    return `
      <h1>${APP_NAME} — Home</h1>
      <p>Single sign-on demo with Keycloak. Log in here, then open the other instances in other tabs to see the session propagate.</p>
      ${!isAuthenticated() ? '<button id="loginBtn">Login</button>' : '<button id="logoutBtn" class="logout">Logout</button>'}
    `;
  }

  renderProtected() {
    if (!isAuthenticated()) {
      return `
        <div class="protected anon">
          <h1>Protected Page</h1>
          <p class="status-line"><strong>Yellow:</strong> not authenticated.</p>
          <p>You must be logged in to view this page.</p>
          <button id="loginBtn">Login to Access</button>
        </div>
      `;
    }

    const isAdmin = hasRole('admin');
    const cls = isAdmin ? 'admin' : 'auth';
    const label = isAdmin
      ? '<strong>Red:</strong> authenticated with <code>admin</code> role.'
      : '<strong>Blue:</strong> authenticated with <code>user</code> role only (no <code>admin</code>).';

    const bffStatus = this.bff
      ? `<p><strong>BFF <code>/api/user</code>:</strong> HTTP ${this.bff.status} ${this.bff.ok ? '✓' : '✗'}</p>`
      : '<p><strong>BFF:</strong> (no response)</p>';

    return `
      <div class="protected ${cls}">
        <h1>Protected Page</h1>
        <p class="status-line">${label}</p>
        ${bffStatus}
        <div class="user-info">
          <strong>BFF Response:</strong>
          <pre>${JSON.stringify(this.bff?.body ?? this.user, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  renderProfile() {
    if (!isAuthenticated()) {
      return `
        <h1>Profile</h1>
        <p class="error">Please log in to view your profile.</p>
        <button id="loginBtn">Login</button>
      `;
    }

    const roles = this.user?.roles ?? [];
    return `
      <h1>Your Profile</h1>
      <div class="user-info">
        <p><strong>Username:</strong> ${this.user?.username || 'N/A'}</p>
        <p><strong>Email:</strong> ${this.user?.email || 'N/A'}</p>
        <p><strong>Name:</strong> ${this.user?.firstName || ''} ${this.user?.lastName || ''}</p>
        <p><strong>Roles:</strong> ${roles.length ? roles.map(r => `<code>${r}</code>`).join(' ') : '<em>none</em>'}</p>
        <p><strong>Token (first 20 chars):</strong> ${keycloak.token?.substring(0, 20)}...</p>
      </div>
      <button id="logoutBtn" class="logout" style="margin-top: 1rem;">Logout</button>
    `;
  }

  attachEventListeners() {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', () => login());

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => logout());

    window.addEventListener('popstate', () => this.render());
  }
}

const app = new DemoApp();
app.init();

export default app;
