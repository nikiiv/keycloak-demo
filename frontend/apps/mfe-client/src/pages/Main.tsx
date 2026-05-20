import { useState, type FormEvent } from 'react';
import type { ShellHost } from 'shell-api';
import { BffStatus } from '../components/BffStatus';

const DEMO_SUBMITTED = 'Submitted — demo mode, nothing was sent.';

export function Main({ host }: { host: ShellHost }) {
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [actionsNotice, setActionsNotice] = useState<string | null>(null);

  const onRequestSubmit = (e: FormEvent) => {
    e.preventDefault();
    setRequestNotice(DEMO_SUBMITTED);
  };

  return (
    <>
      <section>
        <div className="section-eyebrow">Client space · welcome</div>
        <h2 className="section-title">A calm place to pick up where you left off.</h2>
        <p className="section-body">
          This is the client portal — everyone with an account is welcome here. Drop us a note,
          check on recent orders, or kick off a new request. Nothing on this tab posts for real —
          it's a mock workflow so you can feel the shape of the client experience.
        </p>
      </section>

      <div className="work">
        <section className="work-grid">
          <div className="card">
            <h3>New support request</h3>
            <form onSubmit={onRequestSubmit}>
              <div className="field">
                <label htmlFor="wc-subject">Subject</label>
                <input id="wc-subject" type="text" placeholder="Short summary" required />
              </div>
              <div className="field">
                <label htmlFor="wc-category">Category</label>
                <select id="wc-category" defaultValue="Billing question">
                  <option>Billing question</option>
                  <option>Technical issue</option>
                  <option>Account change</option>
                  <option>Feedback</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="wc-message">Message</label>
                <textarea id="wc-message" rows={4} placeholder="Tell us what’s happening" />
              </div>
              <button type="submit">Send request</button>
              <span className={`demo-notice${requestNotice ? ' visible' : ''}`}>
                {requestNotice ?? ''}
              </span>
            </form>
          </div>

          <div className="card">
            <h3>Recent orders</h3>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>#A-10422</td>
                  <td>Oct 14</td>
                  <td>
                    <span className="pill pill-ok">Delivered</span>
                  </td>
                </tr>
                <tr>
                  <td>#A-10491</td>
                  <td>Oct 18</td>
                  <td>
                    <span className="pill pill-warn">In transit</span>
                  </td>
                </tr>
                <tr>
                  <td>#A-10508</td>
                  <td>Oct 20</td>
                  <td>
                    <span className="pill pill-muted">Processing</span>
                  </td>
                </tr>
                <tr>
                  <td>#A-10533</td>
                  <td>Oct 22</td>
                  <td>
                    <span className="pill pill-muted">Draft</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BffStatus host={host} prefix="/api/client" bffName="bff-client" />

          <div className="card card-wide">
            <h3>Quick actions</h3>
            <div className="button-row">
              <button
                onClick={() =>
                  setActionsNotice('Callback scheduled for tomorrow at 10:00 local time.')
                }
              >
                Schedule a callback
              </button>
              <button onClick={() => setActionsNotice('Statement PDF would be downloading now.')}>
                Download statement
              </button>
              <button
                className="logout"
                onClick={() => setActionsNotice('Billing portal would open in a new tab.')}
              >
                Manage billing
              </button>
            </div>
            <div className={`demo-notice${actionsNotice ? ' visible' : ''}`}>
              {actionsNotice ?? ''}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
