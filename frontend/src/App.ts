import keycloak from './Keycloak';
import { User, BffResult, getUser, getBffUser, login, logout, isAuthenticated, hasRole } from './User';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'SSO Demo';
const APP_TITLE = (import.meta.env.VITE_APP_TITLE ?? APP_NAME) as string;
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
    const workLink = this.hasAppAccess()
      ? '<a href="/work">Work</a>'
      : `<span class="nav-disabled" aria-disabled="true" title="Not available — ${this.accessBlockReason().replace(/`/g, '')}">Work</span>`;
    app.innerHTML = `
      <nav>
        <a href="/">Home</a>
        ${workLink}
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

  hasAppAccess(): boolean {
    if (!isAuthenticated()) return true;
    if (this.bff === null) return true;
    return this.bff.ok;
  }

  accessBlockReason(): string {
    const body: any = this.bff?.body ?? {};
    return body.message ?? 'Not authorized for this app.';
  }

  renderUnauthorizedBanner() {
    if (!isAuthenticated() || !this.bff || this.bff.ok) return '';

    const body: any = this.bff.body ?? {};
    const username = body.username ?? this.user?.username ?? '(unknown)';
    const allowed = (body.allowedRoles ?? []) as string[];
    const yours = (body.yourRoles ?? this.user?.roles ?? []) as string[];
    const allowedStr = allowed.length ? allowed.map(r => `<code>${r}</code>`).join(' ') : '<em>(none configured)</em>';
    const yoursStr = yours.length ? yours.map(r => `<code>${r}</code>`).join(' ') : '<em>none</em>';
    const message = body.message ?? 'Not authorized for this app.';

    return `
      <div class="unauth-banner">
        <strong>⛔ ${message}</strong>
        <div>Logged in as <code>${username}</code>. Allowed role(s): ${allowedStr}. You hold: ${yoursStr}.</div>
      </div>
    `;
  }

  renderContent() {
    const path = window.location.pathname;
    if (path === '/work') return this.renderWork();
    if (path === '/protected') return this.renderProtected();
    if (path === '/profile') return this.renderProfile();
    return this.renderHome();
  }

  renderWork() {
    if (!isAuthenticated()) {
      return `
        <h1>Work</h1>
        <p class="error">Please sign in to access your workspace.</p>
        <button id="loginBtn">Sign in</button>
      `;
    }
    if (!this.hasAppAccess()) {
      const reason = this.accessBlockReason().replace(/`([^`]+)`/g, '<code>$1</code>');
      return `
        <h1>Work</h1>
        <p class="error">This workspace isn't available for your role. ${reason}</p>
        <p>Your role-level access is enforced server-side by the BFF; this tab is disabled client-side to match.</p>
      `;
    }
    if (APP_THEME === 'c') return this.renderWorkAdmin();
    if (APP_THEME === 'b') return this.renderWorkOps();
    return this.renderWorkClient();
  }

  renderWorkClient() {
    return `
      <div class="work">
        <section>
          <div class="section-eyebrow">Account &amp; support</div>
          <h2 class="section-title">What can we help with today?</h2>
          <p class="section-body">Drop us a note, check on recent orders, or kick off a new request. Nothing on this tab posts for real — it's a mock workflow so you can feel the shape of the client experience.</p>
        </section>

        <section class="work-grid">
          <div class="card">
            <h3>New support request</h3>
            <form data-demo-form>
              <div class="field">
                <label for="wc-subject">Subject</label>
                <input id="wc-subject" type="text" placeholder="Short summary" required />
              </div>
              <div class="field">
                <label for="wc-category">Category</label>
                <select id="wc-category">
                  <option>Billing question</option>
                  <option>Technical issue</option>
                  <option>Account change</option>
                  <option>Feedback</option>
                </select>
              </div>
              <div class="field">
                <label for="wc-message">Message</label>
                <textarea id="wc-message" rows="4" placeholder="Tell us what&rsquo;s happening"></textarea>
              </div>
              <button type="submit">Send request</button>
              <span class="demo-notice" data-demo-notice></span>
            </form>
          </div>

          <div class="card">
            <h3>Recent orders</h3>
            <table>
              <thead>
                <tr><th>Order</th><th>Placed</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr><td>#A-10422</td><td>Oct 14</td><td><span class="pill pill-ok">Delivered</span></td></tr>
                <tr><td>#A-10491</td><td>Oct 18</td><td><span class="pill pill-warn">In transit</span></td></tr>
                <tr><td>#A-10508</td><td>Oct 20</td><td><span class="pill pill-muted">Processing</span></td></tr>
                <tr><td>#A-10533</td><td>Oct 22</td><td><span class="pill pill-muted">Draft</span></td></tr>
              </tbody>
            </table>
          </div>

          <div class="card card-wide">
            <h3>Quick actions</h3>
            <div class="button-row">
              <button data-demo-button data-demo-result="Callback scheduled for tomorrow at 10:00 local time.">Schedule a callback</button>
              <button data-demo-button data-demo-result="Statement PDF would be downloading now.">Download statement</button>
              <button class="logout" data-demo-button data-demo-result="Billing portal would open in a new tab.">Manage billing</button>
            </div>
            <div class="demo-notice"></div>
          </div>
        </section>
      </div>
    `;
  }

  renderWorkOps() {
    return `
      <div class="work">
        <section>
          <div class="section-eyebrow">Operations console</div>
          <h2 class="section-title">Platform overview</h2>
        </section>

        <section class="stat-grid">
          <div class="stat-card"><div class="stat-value">24</div><div class="stat-label">Active workflows</div></div>
          <div class="stat-card"><div class="stat-value">3</div><div class="stat-label">Pending approvals</div></div>
          <div class="stat-card"><div class="stat-value">1,284</div><div class="stat-label">Events today</div></div>
          <div class="stat-card"><div class="stat-value">99.98%</div><div class="stat-label">Uptime (30d)</div></div>
        </section>

        <section class="work-grid">
          <div class="card">
            <h3>Filter runs</h3>
            <form data-demo-form>
              <div class="field">
                <label for="wo-from">From</label>
                <input id="wo-from" type="date" />
              </div>
              <div class="field">
                <label for="wo-to">To</label>
                <input id="wo-to" type="date" />
              </div>
              <div class="field">
                <label for="wo-status">Status</label>
                <select id="wo-status">
                  <option>All</option>
                  <option>Succeeded</option>
                  <option>Failed</option>
                  <option>Retrying</option>
                </select>
              </div>
              <div class="field">
                <label for="wo-query">Search</label>
                <input id="wo-query" type="text" placeholder="workflow id or label" />
              </div>
              <button type="submit">Apply filter</button>
              <span class="demo-notice" data-demo-notice></span>
            </form>
          </div>

          <div class="card card-wide">
            <h3>Workflow queue</h3>
            <table>
              <thead>
                <tr><th>Name</th><th>Last run</th><th>State</th><th>Actions</th></tr>
              </thead>
              <tbody>
                <tr><td>nightly-sync</td><td>02:14</td><td><span class="pill pill-ok">OK</span></td><td><button class="small" data-demo-button data-demo-result="Rerun queued.">Rerun</button> <button class="small logout" data-demo-button data-demo-result="Paused.">Pause</button></td></tr>
                <tr><td>invoice-generator</td><td>09:50</td><td><span class="pill pill-warn">Retrying 2/5</span></td><td><button class="small" data-demo-button data-demo-result="Rerun queued.">Rerun</button> <button class="small logout" data-demo-button data-demo-result="Run cancelled.">Cancel</button></td></tr>
                <tr><td>report-export</td><td>11:02</td><td><span class="pill pill-ok">OK</span></td><td><button class="small" data-demo-button data-demo-result="Rerun queued.">Rerun</button></td></tr>
                <tr><td>audit-trail-backfill</td><td>yesterday</td><td><span class="pill pill-muted">Paused</span></td><td><button class="small" data-demo-button data-demo-result="Resumed.">Resume</button></td></tr>
              </tbody>
            </table>
            <div class="demo-notice"></div>
          </div>
        </section>

        <section class="card">
          <h3>Create workflow</h3>
          <form data-demo-form class="form-inline">
            <div class="field">
              <label for="wf-name">Name</label>
              <input id="wf-name" type="text" placeholder="daily-reconcile" />
            </div>
            <div class="field">
              <label for="wf-type">Type</label>
              <select id="wf-type">
                <option>Batch</option>
                <option>Streaming</option>
                <option>Scheduled</option>
              </select>
            </div>
            <div class="field">
              <label for="wf-cron">Schedule</label>
              <input id="wf-cron" type="text" placeholder="0 2 * * *" />
            </div>
            <div class="field">
              <label class="checkbox-row"><input type="checkbox" checked /> Auto-retry on failure</label>
            </div>
            <button type="submit">Create workflow</button>
            <span class="demo-notice" data-demo-notice></span>
          </form>
        </section>
      </div>
    `;
  }

  renderWorkAdmin() {
    return `
      <div class="work">
        <section class="status-strip">
          <span class="status-dot status-ok"></span>
          <span class="status-label">SYSTEM</span>
          <span class="status-value">NOMINAL</span>
          <span class="status-sep">·</span>
          <span class="status-label">SESSIONS</span><span class="status-value">3</span>
          <span class="status-sep">·</span>
          <span class="status-label">AUTH FAIL (1h)</span><span class="status-value">2</span>
          <span class="status-sep">·</span>
          <span class="status-label">UPTIME</span><span class="status-value">17d 04h</span>
        </section>

        <section class="work-grid">
          <div class="card">
            <h3>Recent audit log</h3>
            <pre class="audit-log">[13:01:22Z] admin@demo  user.suspend           target=demouser   reason="repeat_auth_failure"
[12:58:14Z] admin@demo  realm.role.grant       target=demoadmin  role=admin
[12:48:03Z] system      session.expire         target=democlient
[12:42:51Z] admin@demo  credentials.reset      target=demouser
[12:30:00Z] system      keys.rotate            count=2
[12:12:07Z] admin@demo  realm.login_theme.set  client=app3       theme=app-c</pre>
          </div>

          <div class="card">
            <h3>User action</h3>
            <form data-demo-form>
              <div class="field">
                <label for="wa-user">Target username</label>
                <input id="wa-user" type="text" placeholder="demouser" required />
              </div>
              <div class="field">
                <label for="wa-action">Action</label>
                <select id="wa-action">
                  <option>Suspend account</option>
                  <option>Unsuspend account</option>
                  <option>Reset credentials</option>
                  <option>Elevate to admin</option>
                </select>
              </div>
              <div class="field">
                <label for="wa-reason">Reason (required for audit)</label>
                <textarea id="wa-reason" rows="3" placeholder="Short justification" required></textarea>
              </div>
              <button type="submit">Execute</button>
              <span class="demo-notice" data-demo-notice></span>
            </form>
          </div>
        </section>

        <section class="card card-danger">
          <h3>Emergency actions</h3>
          <p class="section-body">Every action below is logged and would require a second admin to unlock. Use only when operationally justified.</p>
          <div class="button-row">
            <button class="danger" data-demo-button data-demo-result="LOCKDOWN initiated. All authentication flows paused.">⚠ Lock down realm</button>
            <button class="danger" data-demo-button data-demo-result="Key rotation queued. 3 of 3 keys rotated in 12s.">Rotate signing keys</button>
            <button class="danger" data-demo-button data-demo-result="All active sessions invalidated.">Purge all sessions</button>
          </div>
          <div class="demo-notice"></div>
        </section>
      </div>
    `;
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

    document.querySelectorAll<HTMLFormElement>('[data-demo-form]').forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const notice = form.querySelector<HTMLElement>('.demo-notice');
        if (notice) {
          notice.textContent = 'Submitted — demo mode, nothing was sent.';
          notice.classList.add('visible');
        }
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-demo-button]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const msg = btn.dataset.demoResult ?? 'Action simulated (demo).';
        const scope = btn.closest<HTMLElement>('.card, section') ?? document.body;
        const notice = scope.querySelector<HTMLElement>('.demo-notice');
        if (notice) {
          notice.textContent = msg;
          notice.classList.add('visible');
        }
      });
    });

    window.addEventListener('popstate', () => this.render());
  }
}

const app = new DemoApp();
app.init();

export default app;
