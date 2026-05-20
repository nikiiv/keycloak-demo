import { lazy, Suspense } from 'react';
import type { MfeKey, ThemeKey, MfeComponent } from 'shell-api';
import { RoleGate } from './RoleGate';
import { useShellHost } from '../auth/useShellHost';

const MfeClient = lazy(() => import('mfe-client')) as unknown as MfeComponent;
const MfeOps = lazy(() => import('mfe-ops')) as unknown as MfeComponent;
const MfeAdmin = lazy(() => import('mfe-admin')) as unknown as MfeComponent;

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
