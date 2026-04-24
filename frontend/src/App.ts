import keycloak from './Keycloak';
import { User, BffResult, getUser, getBffUser, login, logout, isAuthenticated, hasRole } from './User';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'SSO Demo';
const APP_TITLE = (import.meta.env.VITE_APP_TITLE ?? APP_NAME) as string;
const REQUIRED_ROLE = (import.meta.env.VITE_REQUIRED_ROLE ?? '').trim();
const FORBIDDEN_ROLE = (import.meta.env.VITE_FORBIDDEN_ROLE ?? '').trim();
const APP_THEME = (import.meta.env.VITE_APP_THEME ?? 'a').toLowerCase();

document.title = APP_TITLE;

type ThemeCopy = {
  navSub: string;
  heroEyebrow: string;
  heroTitle: string;
  heroBody: string;
  brandMark: string;
};

const THEME_COPY: Record<string, ThemeCopy> = {
  a: {
    navSub: 'Client Portal',
    heroEyebrow: 'Client space · welcome',
    heroTitle: 'A calm place to pick up where you left off.',
    heroBody: 'This is the public-facing client space — everyone with an account is welcome here. Sign in to see your profile and try the protected routes; open another demo app in a new tab to watch the single sign-on take hold.',
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 22C4 12 12 4 22 4c2 0 4 .4 6 1.1C26 17 17 26 5.1 28 4.4 26 4 24 4 22Z" fill="currentColor" opacity="0.18"/>
      <path d="M4 22C4 12 12 4 22 4c2 0 4 .4 6 1.1C26 17 17 26 5.1 28 4.4 26 4 24 4 22Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <path d="M9 23C15 19 20 13 25 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
  },
  b: {
    navSub: 'Operations Console',
    heroEyebrow: 'Self-service · verified accounts',
    heroTitle: 'Operations Console',
    heroBody: 'A sharper surface for the people doing the work — power-user tooling for verified accounts only. Clients are kept out on purpose; the blocklist is enforced in the BFF and mirrored here.',
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 3.5 26.5 9.75v12.5L16 28.5 5.5 22.25V9.75L16 3.5Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <path d="M16 10 22 13.5v7L16 24l-6-3.5v-7L16 10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity="0.55"/>
      <circle cx="16" cy="17" r="2" fill="currentColor"/>
    </svg>`,
  },
  c: {
    navSub: 'Restricted · admin only',
    heroEyebrow: '⚠ Restricted · all actions are logged',
    heroTitle: 'Command Console',
    heroBody: 'This console is locked to the admin role. If you landed here without it you will see a banner on every page and the BFF will refuse every call. Move deliberately; your session is auditable.',
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 3 5 7v8c0 7 5 12 11 14 6-2 11-7 11-14V7l-11-4Z" fill="currentColor" opacity="0.12"/>
      <path d="M16 3 5 7v8c0 7 5 12 11 14 6-2 11-7 11-14V7l-11-4Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <circle cx="16" cy="14" r="2.2" fill="currentColor"/>
      <path d="M16 16v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
};

const COPY: ThemeCopy = THEME_COPY[APP_THEME] ?? THEME_COPY.a;

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
        <div class="nav-brand">
          <span class="nav-brand-mark">${COPY.brandMark}</span>
          <span class="nav-brand-text">
            ${APP_NAME}
            <span class="nav-brand-sub">${COPY.navSub}</span>
          </span>
        </div>
      </nav>
      ${this.renderUnauthorizedBanner()}
      <div class="page">
        ${this.renderContent()}
      </div>
    `;
    this.attachEventListeners();
  }

  renderUnauthorizedBanner() {
    if (!isAuthenticated()) return '';

    const username = this.user?.username ?? '(unknown)';
    const roles = this.user?.roles ?? [];
    const rolesStr = roles.length ? roles.map(r => `<code>${r}</code>`).join(' ') : '<em>none</em>';

    if (FORBIDDEN_ROLE && hasRole(FORBIDDEN_ROLE)) {
      return `
        <div class="unauth-banner forbidden-role">
          <strong>⛔ This is not a <code>${FORBIDDEN_ROLE}</code> area.</strong>
          <div>Users holding the <code>${FORBIDDEN_ROLE}</code> role cannot use this app. You are logged in as <code>${username}</code> with roles: ${rolesStr}.</div>
        </div>
      `;
    }

    if (REQUIRED_ROLE && !hasRole(REQUIRED_ROLE)) {
      return `
        <div class="unauth-banner">
          <strong>⚠ Your current authorization does not allow you to use this app.</strong>
          <div>This app requires role <code>${REQUIRED_ROLE}</code>. You are logged in as <code>${username}</code> with roles: ${rolesStr}.</div>
        </div>
      `;
    }

    return '';
  }

  renderContent() {
    const path = window.location.pathname;
    if (path === '/protected') return this.renderProtected();
    if (path === '/profile') return this.renderProfile();
    return this.renderHome();
  }

  renderHome() {
    return `
      <div class="hero">
        <div class="hero-eyebrow">${COPY.heroEyebrow}</div>
        <h1 class="hero-title">${COPY.heroTitle}</h1>
        <p class="hero-body">${COPY.heroBody}</p>
      </div>
      ${!isAuthenticated() ? '<button id="loginBtn">Sign in</button>' : '<button id="logoutBtn" class="logout">Sign out</button>'}
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
