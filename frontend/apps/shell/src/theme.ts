export type ThemeKey = 'a' | 'b' | 'c';

export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'SSO Demo';
export const APP_TITLE: string = (import.meta.env.VITE_APP_TITLE as string | undefined) ?? APP_NAME;
export const APP_THEME: ThemeKey = (
  ((import.meta.env.VITE_APP_THEME as string | undefined) ?? 'a').toLowerCase() as ThemeKey
);

export interface ThemeCopy {
  navSub: string;
  heroEyebrow: string;
  heroTitle: string;
  heroBody: string;
  brandMark: string;
}

const THEME_COPY: Record<ThemeKey, ThemeCopy> = {
  a: {
    navSub: 'Client Portal',
    heroEyebrow: 'Client space · welcome',
    heroTitle: 'A calm place to pick up where you left off.',
    heroBody:
      "This is the public-facing client space — everyone with an account is welcome here. Sign in to see your profile and try the protected routes; open another demo app in a new tab to watch the single sign-on take hold.",
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 22C4 12 12 4 22 4c2 0 4 .4 6 1.1C26 17 17 26 5.1 28 4.4 26 4 24 4 22Z" fill="currentColor" opacity="0.18"/>
      <path d="M4 22C4 12 12 4 22 4c2 0 4 .4 6 1.1C26 17 17 26 5.1 28 4.4 26 4 24 4 22Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <path d="M9 23C15 19 20 13 25 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`
  },
  b: {
    navSub: 'Operations Console',
    heroEyebrow: 'Self-service · verified accounts',
    heroTitle: 'Operations Console',
    heroBody:
      'A sharper surface for the people doing the work — power-user tooling for verified accounts only. Clients are kept out on purpose; the blocklist is enforced in the BFF and mirrored here.',
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 3.5 26.5 9.75v12.5L16 28.5 5.5 22.25V9.75L16 3.5Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <path d="M16 10 22 13.5v7L16 24l-6-3.5v-7L16 10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity="0.55"/>
      <circle cx="16" cy="17" r="2" fill="currentColor"/>
    </svg>`
  },
  c: {
    navSub: 'Restricted · admin only',
    heroEyebrow: '⚠ Restricted · all actions are logged',
    heroTitle: 'Command Console',
    heroBody:
      'This console is locked to the admin role. If you landed here without it you will see a banner on every page and the BFF will refuse every call. Move deliberately; your session is auditable.',
    brandMark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 3 5 7v8c0 7 5 12 11 14 6-2 11-7 11-14V7l-11-4Z" fill="currentColor" opacity="0.12"/>
      <path d="M16 3 5 7v8c0 7 5 12 11 14 6-2 11-7 11-14V7l-11-4Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <circle cx="16" cy="14" r="2.2" fill="currentColor"/>
      <path d="M16 16v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`
  }
};

export const COPY: ThemeCopy = THEME_COPY[APP_THEME] ?? THEME_COPY.a;
