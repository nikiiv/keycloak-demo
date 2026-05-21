import { useState } from 'react';
import type { ShellHost } from 'shell-api';

interface Props {
  host: ShellHost;
  prefix: '/api/client' | '/api/ops' | '/api/admin';
  bffName: string;
}

export function BffStatus({ host, prefix, bffName }: Props) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ping = async () => {
    setBusy(true);
    try {
      const token = await host.auth.getToken();
      const res = await fetch(`${prefix}/user`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const body = await res.json().catch(() => null);
      const source = (body as Record<string, unknown> | null)?.source as string | undefined;
      setResult(`HTTP ${res.status} from ${source ?? '(no source)'}`);
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
        This MFE owns its own backend at <code>{prefix}/*</code> — the shell strips the prefix
        and forwards to the <code>{bffName}</code> container.
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
