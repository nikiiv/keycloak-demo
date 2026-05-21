// Module-federation remotes are resolved at runtime by the federation plugin.
// These declarations let TS treat the imports as typed React components; the
// MfeComponent contract comes from shell-api.

declare module 'mfeClient/Mfe' {
  import type { MfeComponent } from 'shell-api';
  const Mfe: MfeComponent;
  export default Mfe;
}

declare module 'mfeOps/Mfe' {
  import type { MfeComponent } from 'shell-api';
  const Mfe: MfeComponent;
  export default Mfe;
}

declare module 'mfeAdmin/Mfe' {
  import type { MfeComponent } from 'shell-api';
  const Mfe: MfeComponent;
  export default Mfe;
}
