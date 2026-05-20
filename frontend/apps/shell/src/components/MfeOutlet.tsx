import { lazy, Suspense } from 'react';
import type { MfeKey, ThemeKey, MfeComponent } from 'shell-api';
import { RoleGate } from './RoleGate';
import { useShellHost } from '../auth/useShellHost';

// Module-federation remotes — the federation plugin rewrites these imports to
// runtime fetches of remoteEntry.js from each MFE container.
const MfeClient = lazy(() => import('mfeClient/Mfe')) as unknown as MfeComponent;
const MfeOps = lazy(() => import('mfeOps/Mfe')) as unknown as MfeComponent;
const MfeAdmin = lazy(() => import('mfeAdmin/Mfe')) as unknown as MfeComponent;

const MFE_THEME: Record<MfeKey, ThemeKey> = {
  client: 'a',
  ops: 'b',
  admin: 'c'
};

const MFE_COMPONENT: Record<MfeKey, MfeComponent> = {
  client: MfeClient,
  ops: MfeOps,
  admin: MfeAdmin
};

interface Props {
  mfe: MfeKey;
}

export function MfeOutlet({ mfe }: Props) {
  const host = useShellHost(MFE_THEME[mfe]);
  const Mfe = MFE_COMPONENT[mfe];

  return (
    <RoleGate mfe={mfe}>
      <Suspense fallback={<p>Loading {mfe}…</p>}>
        <Mfe host={host} />
      </Suspense>
    </RoleGate>
  );
}
