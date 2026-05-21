export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'SSO Demo';
export const APP_TITLE: string = (import.meta.env.VITE_APP_TITLE as string | undefined) ?? APP_NAME;

export const SHELL_NAV_SUB = 'Microfrontend Shell';

// Compact generic mark for the shell chrome. MFEs render their own branded
// content inside a data-theme="a|b|c" wrapper, so this only ever shows in
// the shell-level navigation.
export const SHELL_BRAND_MARK = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="4" y="4" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.75"/>
  <rect x="18" y="4" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.75" opacity="0.6"/>
  <rect x="4" y="18" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.75" opacity="0.6"/>
  <rect x="18" y="18" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.75"/>
</svg>`;
