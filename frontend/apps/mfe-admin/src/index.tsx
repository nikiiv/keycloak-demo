import { useState, type FormEvent } from 'react';
import type { MfeComponent } from 'shell-api';

const DEMO_SUBMITTED = 'Submitted — demo mode, nothing was sent.';

const Mfe: MfeComponent = () => {
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [emergencyNotice, setEmergencyNotice] = useState<string | null>(null);

  return (
    <div data-theme="c" className="mfe-root">
      <section>
        <div className="section-eyebrow">⚠ Restricted · all actions are logged</div>
        <h2 className="section-title">Command Console</h2>
        <p className="section-body">
          This console is locked to the admin role. If you landed here without it you will see
          a banner on every page and the BFF will refuse every call. Move deliberately; your
          session is auditable.
        </p>
      </section>

      <div className="work">
        <section className="status-strip">
          <span className="status-dot status-ok" />
          <span className="status-label">SYSTEM</span>
          <span className="status-value">NOMINAL</span>
          <span className="status-sep">·</span>
          <span className="status-label">SESSIONS</span>
          <span className="status-value">3</span>
          <span className="status-sep">·</span>
          <span className="status-label">AUTH FAIL (1h)</span>
          <span className="status-value">2</span>
          <span className="status-sep">·</span>
          <span className="status-label">UPTIME</span>
          <span className="status-value">17d 04h</span>
        </section>

        <section className="work-grid">
          <div className="card">
            <h3>Recent audit log</h3>
            <pre className="audit-log">{`[13:01:22Z] admin@demo  user.suspend           target=demouser   reason="repeat_auth_failure"
[12:58:14Z] admin@demo  realm.role.grant       target=demoadmin  role=admin
[12:48:03Z] system      session.expire         target=democlient
[12:42:51Z] admin@demo  credentials.reset      target=demouser
[12:30:00Z] system      keys.rotate            count=2
[12:12:07Z] admin@demo  realm.login_theme.set  client=app3       theme=app-c`}</pre>
          </div>

          <div className="card">
            <h3>User action</h3>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setActionNotice(DEMO_SUBMITTED);
              }}
            >
              <div className="field">
                <label htmlFor="wa-user">Target username</label>
                <input id="wa-user" type="text" placeholder="demouser" required />
              </div>
              <div className="field">
                <label htmlFor="wa-action">Action</label>
                <select id="wa-action" defaultValue="Suspend account">
                  <option>Suspend account</option>
                  <option>Unsuspend account</option>
                  <option>Reset credentials</option>
                  <option>Elevate to admin</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="wa-reason">Reason (required for audit)</label>
                <textarea id="wa-reason" rows={3} placeholder="Short justification" required />
              </div>
              <button type="submit">Execute</button>
              <span className={`demo-notice${actionNotice ? ' visible' : ''}`}>
                {actionNotice ?? ''}
              </span>
            </form>
          </div>
        </section>

        <section className="card card-danger">
          <h3>Emergency actions</h3>
          <p className="section-body">
            Every action below is logged and would require a second admin to unlock. Use only when
            operationally justified.
          </p>
          <div className="button-row">
            <button
              className="danger"
              onClick={() =>
                setEmergencyNotice('LOCKDOWN initiated. All authentication flows paused.')
              }
            >
              ⚠ Lock down realm
            </button>
            <button
              className="danger"
              onClick={() =>
                setEmergencyNotice('Key rotation queued. 3 of 3 keys rotated in 12s.')
              }
            >
              Rotate signing keys
            </button>
            <button
              className="danger"
              onClick={() => setEmergencyNotice('All active sessions invalidated.')}
            >
              Purge all sessions
            </button>
          </div>
          <div className={`demo-notice${emergencyNotice ? ' visible' : ''}`}>
            {emergencyNotice ?? ''}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Mfe;
