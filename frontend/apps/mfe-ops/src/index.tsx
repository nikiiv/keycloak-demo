import { useState, type FormEvent } from 'react';
import type { MfeComponent, ShellHost } from 'shell-api';

const DEMO_SUBMITTED = 'Submitted — demo mode, nothing was sent.';

function BffStatus({ host }: { host: ShellHost }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ping = async () => {
    setBusy(true);
    try {
      const token = await host.auth.getToken();
      const res = await fetch('/api/ops/user', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const body = await res.json().catch(() => null);
      setResult(`HTTP ${res.status} from ${body?.source ?? '(no source)'}`);
    } catch (e: any) {
      setResult(`error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>BFF connectivity</h3>
      <p className="section-body">
        This MFE owns its own backend at <code>/api/ops/*</code> — the shell strips the
        prefix and forwards to the <code>bff-ops</code> container.
      </p>
      <button onClick={ping} disabled={busy}>
        {busy ? 'Pinging…' : 'Ping my BFF'}
      </button>
      {result && (
        <p className="section-body" style={{ marginTop: '0.5rem' }}>
          <code>{result}</code>
        </p>
      )}
    </section>
  );
}

const Mfe: MfeComponent = ({ host }) => {
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  return (
    <div data-theme="b" className="mfe-root">
      <section>
        <div className="section-eyebrow">Self-service · verified accounts</div>
        <h2 className="section-title">Operations Console</h2>
        <p className="section-body">
          A sharper surface for the people doing the work — power-user tooling for verified
          accounts only. Clients are kept out on purpose; the blocklist is enforced in the BFF
          and mirrored here.
        </p>
      </section>

      <div className="work">
        <section className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">24</div>
            <div className="stat-label">Active workflows</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">3</div>
            <div className="stat-label">Pending approvals</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">1,284</div>
            <div className="stat-label">Events today</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">99.98%</div>
            <div className="stat-label">Uptime (30d)</div>
          </div>
        </section>

        <section className="work-grid">
          <div className="card">
            <h3>Filter runs</h3>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setFilterNotice(DEMO_SUBMITTED);
              }}
            >
              <div className="field">
                <label htmlFor="wo-from">From</label>
                <input id="wo-from" type="date" />
              </div>
              <div className="field">
                <label htmlFor="wo-to">To</label>
                <input id="wo-to" type="date" />
              </div>
              <div className="field">
                <label htmlFor="wo-status">Status</label>
                <select id="wo-status" defaultValue="All">
                  <option>All</option>
                  <option>Succeeded</option>
                  <option>Failed</option>
                  <option>Retrying</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="wo-query">Search</label>
                <input id="wo-query" type="text" placeholder="workflow id or label" />
              </div>
              <button type="submit">Apply filter</button>
              <span className={`demo-notice${filterNotice ? ' visible' : ''}`}>
                {filterNotice ?? ''}
              </span>
            </form>
          </div>

          <div className="card card-wide">
            <h3>Workflow queue</h3>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last run</th>
                  <th>State</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>nightly-sync</td>
                  <td>02:14</td>
                  <td>
                    <span className="pill pill-ok">OK</span>
                  </td>
                  <td>
                    <button className="small" onClick={() => setQueueNotice('Rerun queued.')}>
                      Rerun
                    </button>{' '}
                    <button className="small logout" onClick={() => setQueueNotice('Paused.')}>
                      Pause
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>invoice-generator</td>
                  <td>09:50</td>
                  <td>
                    <span className="pill pill-warn">Retrying 2/5</span>
                  </td>
                  <td>
                    <button className="small" onClick={() => setQueueNotice('Rerun queued.')}>
                      Rerun
                    </button>{' '}
                    <button
                      className="small logout"
                      onClick={() => setQueueNotice('Run cancelled.')}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>report-export</td>
                  <td>11:02</td>
                  <td>
                    <span className="pill pill-ok">OK</span>
                  </td>
                  <td>
                    <button className="small" onClick={() => setQueueNotice('Rerun queued.')}>
                      Rerun
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>audit-trail-backfill</td>
                  <td>yesterday</td>
                  <td>
                    <span className="pill pill-muted">Paused</span>
                  </td>
                  <td>
                    <button className="small" onClick={() => setQueueNotice('Resumed.')}>
                      Resume
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className={`demo-notice${queueNotice ? ' visible' : ''}`}>{queueNotice ?? ''}</div>
          </div>
        </section>

        <BffStatus host={host} />

        <section className="card">
          <h3>Create workflow</h3>
          <form
            className="form-inline"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setCreateNotice(DEMO_SUBMITTED);
            }}
          >
            <div className="field">
              <label htmlFor="wf-name">Name</label>
              <input id="wf-name" type="text" placeholder="daily-reconcile" />
            </div>
            <div className="field">
              <label htmlFor="wf-type">Type</label>
              <select id="wf-type" defaultValue="Batch">
                <option>Batch</option>
                <option>Streaming</option>
                <option>Scheduled</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wf-cron">Schedule</label>
              <input id="wf-cron" type="text" placeholder="0 2 * * *" />
            </div>
            <div className="field">
              <label className="checkbox-row">
                <input type="checkbox" defaultChecked /> Auto-retry on failure
              </label>
            </div>
            <button type="submit">Create workflow</button>
            <span className={`demo-notice${createNotice ? ' visible' : ''}`}>
              {createNotice ?? ''}
            </span>
          </form>
        </section>
      </div>
    </div>
  );
};

export default Mfe;
