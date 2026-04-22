import keycloak from './Keycloak';
import { User, getUser, getBffUser, login, logout, isAuthenticated } from './User';

export class App2 {
  private user: User | null = null;
  private bffUser: User | null = null;

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
        this.bffUser = await getBffUser();
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
        <span>App2</span>
      </nav>
      <div class="page">
        ${this.renderContent()}
      </div>
    `;

    this.attachEventListeners();
  }

  renderContent() {
    const path = window.location.pathname;
    
    if (path === '/protected') {
      return this.renderProtected();
    }
    
    if (path === '/profile') {
      return this.renderProfile();
    }
    
    return this.renderHome();
  }

  renderHome() {
    return `
      <h1>App2 - Home</h1>
      <p>Welcome to App2. This demonstrates SSO across multiple applications.</p>
      ${!isAuthenticated() ? '<button id="loginBtn">Login</button>' : '<button id="logoutBtn" class="logout">Logout</button>'}
    `;
  }

  renderProtected() {
    if (!isAuthenticated()) {
      return `
        <div class="protected">
          <h1>Protected Page</h1>
          <p class="error">You must be logged in to view this page.</p>
          <button id="loginBtn">Login to Access</button>
        </div>
      `;
    }

    return `
      <div class="protected">
        <h1>Protected Page</h1>
        <p>You have accessed a protected page!</p>
        <div class="user-info">
          <strong>BFF Response:</strong>
          <pre>${JSON.stringify(this.bffUser || this.user, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  renderProfile() {
    if (!isAuthenticated()) {
      return `
        <div class="page">
          <h1>Profile</h1>
          <p class="error">Please log in to view your profile.</p>
          <button id="loginBtn">Login</button>
        </div>
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
    if (loginBtn) {
      loginBtn.addEventListener('click', () => login());
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => logout());
    }

    window.addEventListener('popstate', () => this.render());
  }
}

const app = new App2();
app.init();

export default app;