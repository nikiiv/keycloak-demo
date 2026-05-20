# Alternatives — Local HTTPS Domains for the Three-App Demo

A survey of six approaches to the "I want `https://named-domain` on a
dev machine" problem, including the one this repo currently ships with.
The shipping setup (mkcert + nginx + `/etc/hosts`) is described in
[`nginx-domains-report.md`](./nginx-domains-report.md) and
[`web-crypto-https-fix.md`](./web-crypto-https-fix.md); this file is
about *what else could have been done* and the trade-offs of switching.

## Why the problem exists at all

Browsers gate `crypto.subtle` (and Storage Access, Service Workers, a
growing list of other APIs) to **secure contexts**. The exhaustive list
of what counts as one:

- `https://...` — always secure.
- `localhost` — explicit carve-out for dev.
- `127.0.0.1` and `[::1]` — same carve-out for the loopback IPs.
- `*.localhost` — extended by Chrome / Firefox / Safari per RFC 6761.

Anything else, even a hostname that resolves to `127.0.0.1` via
`/etc/hosts`, is treated as an arbitrary HTTP origin and Web Crypto is
disabled. `keycloak-js` calls `crypto.subtle` very early in `init()`
to mint the PKCE `state` / `nonce` — when it's missing, login dies
before it begins.

So any "named dev domain" approach must either (a) use HTTPS, or
(b) trick the browser into the `localhost` carve-out.

## Quick comparison

| # | Approach | Realistic URL | New-dev setup steps | HTTPS | Keep nginx? |
|---|---|---|---|---|---|
| 0 | **Current: mkcert + nginx + `/etc/hosts`** | `domain1.app1.int` | mkcert install + cert gen + sudo hosts edit | ✓ | ✓ |
| 1 | **Caddy with `tls internal`** | `domain1.app1.int` | `brew install caddy` + `caddy trust` + sudo hosts edit | ✓ (auto) | replace with Caddy |
| 2 | **`*.localhost` subdomains** | `app1.localhost` | none | not needed | ✓ |
| 3 | **`*.lvh.me` / `*.local.gd` / `*.nip.io`** | `app1.lvh.me` | mkcert (still need HTTPS for secure context) | ✓ (still needed) | ✓ |
| 4 | **`vite-plugin-mkcert` (no nginx)** | `domain1.app1.int:5173` | mkcert (auto) + sudo hosts edit | ✓ (per Vite) | **drop nginx** |
| 5 | **Loopback IPs (`127.0.0.2/3/4`)** | `https://127.0.0.2/` | none | optional | ✓ or skip |

## The options in detail

### 0. Current — mkcert + nginx + `/etc/hosts`

What we ship today. Documented in `nginx-domains-report.md`.

Pros:
- Named domains the way production has them.
- Per-developer cert; nothing trusts a shared key.
- nginx config is portable to a "real" reverse proxy later.

Cons:
- 4 setup steps (install mkcert, `mkcert -install`, generate cert,
  edit `/etc/hosts`).
- mkcert binary required (extra `brew install`).
- Cert lives under `proxy/certs/` so the layout has to be remembered.
- `/etc/hosts` needs `sudo`.

### 1. Caddy with `tls internal`

[Caddy 2](https://caddyserver.com/docs/automatic-https) has a built-in
local CA and auto-issues per-site certs. Replaces both mkcert *and*
nginx with one binary.

Caddyfile (the whole config):

```caddy
domain1.app1.int {
  tls internal
  reverse_proxy web-a:5173
}
domain2.app2.int {
  tls internal
  reverse_proxy web-b:5173
}
domain3.app3.int {
  tls internal
  reverse_proxy web-c:5173
}
```

Caddy auto-installs its root CA into the system trust store the first
time it issues a cert; if running in a Docker container the install
won't reach the host, so `caddy trust` is run once on the host.
WebSocket upgrades are forwarded automatically — no `map $http_upgrade`
or `proxy_http_version 1.1` boilerplate.

Pros:
- Half the moving parts: one binary, one config block per app.
- Auto cert rotation, auto WS upgrade, auto HTTP→HTTPS redirect.
- Caddy config is shorter and more readable than the equivalent nginx
  config.

Cons:
- New dependency in the stack — replaces what's already working.
- Caddy's CA differs per developer (same as mkcert), so the trust
  setup remains a per-dev step.
- Migration cost: rewrite the proxy service, drop `proxy/certs/`,
  decide whether to keep nginx for any other purpose.

Verdict: the cleanest swap if the goal is "less infrastructure for the
same UX." [Caddy: Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

### 2. `*.localhost` subdomains

```
http://app1.localhost  → web-a
http://app2.localhost  → web-b
http://app3.localhost  → web-c
```

Pros:
- **Zero new-dev setup.** No `brew install`, no `/etc/hosts`, no
  certs.
- Browser treats `*.localhost` as a secure context (Chrome 88+,
  Firefox 84+, Safari) — Web Crypto works on plain HTTP.
- OS / browser auto-resolves `*.localhost` to `127.0.0.1` per RFC 6761.

Cons:
- URLs look "dev-y" (`app1.localhost`) instead of "corporate"
  (`billing.company.com`). For a demo whose explicit goal is "show
  what a production-like deploy looks like," that's a regression.
- No HTTPS at all means no TLS-specific edge cases are exercised in
  the dev loop.

Verdict: pick this if developer-onboarding speed beats realism. We
briefly shipped it after the Web Crypto bug surfaced before reverting
to `.int` + HTTPS.

### 3. Public wildcard-DNS services (`lvh.me`, `local.gd`, `nip.io`, `sslip.io`)

These services DNS-resolve wildcards to `127.0.0.1`:

- `lvh.me` and `*.lvh.me` → `127.0.0.1`
- `local.gd` and `*.local.gd` → `127.0.0.1`
- `nip.io` encodes the IP into the hostname (`app1.127.0.0.1.nip.io`)
- `sslip.io` does the same

Pros:
- **Zero `/etc/hosts` work** — global DNS does the resolution.

Cons:
- **Same secure-context problem.** `http://app1.lvh.me` is not a
  secure context (the browser doesn't recognize `lvh.me` as
  `localhost`). So HTTPS is still required, and you still need
  mkcert/Caddy for a trusted cert. The only thing this option avoids
  is the `/etc/hosts` edit.
- Historical aside: `traefik.me` used to ship a real Let's Encrypt
  wildcard cert, but **the service no longer does** so a third party
  trusted cert isn't a free win any more.

Verdict: worth it only if `/etc/hosts` is a particular pain point and
you're already committed to mkcert anyway.

### 4. `vite-plugin-mkcert` — drop the nginx layer

A Vite plugin that hooks mkcert into Vite's dev server startup. Each
Vite container terminates its own HTTPS:

```
https://domain1.app1.int:5173  → web-a
https://domain2.app2.int:5174  → web-b
https://domain3.app3.int:5175  → web-c
```

Pros:
- One layer removed (no nginx).
- Plugin auto-runs `mkcert -install` on first start, so the dev
  doesn't think about certs at all.

Cons:
- Ports reappear in the URLs — *less* realistic than today.
- Doing TLS in three places (one per Vite) instead of one (nginx) is
  more moving parts at runtime, not fewer.
- If you add nginx anyway to drop the ports, you're back where we
  started but with two cert sources.

Verdict: only useful if the goal is "ditch nginx entirely and accept
port numbers in URLs." Not a net win for this project.

### 5. Loopback IPs (`127.0.0.2`, `127.0.0.3`, `127.0.0.4`)

macOS / Linux automatically bind every address in `127.0.0.0/8`, so
the proxy can listen on three different loopback IPs without `/etc/hosts`
work:

```
http://127.0.0.2/  → web-a
http://127.0.0.3/  → web-b
http://127.0.0.4/  → web-c
```

Pros:
- **Zero `/etc/hosts`, zero DNS setup.**
- `127.x.y.z` *is* a secure context per the loopback carve-out, so
  even plain HTTP gives a working Web Crypto.

Cons:
- URLs are unreadable (`127.0.0.2`) and impossible to remember.
- "Each app on its own loopback IP" doesn't mirror any deployment
  topology — it's an even more dev-only solution than
  `*.localhost`.

Verdict: niche. Useful for headless / CI scenarios where the URL is
never typed by a human; otherwise skip.

## Recommendation matrix

If the priority is...

- **Less dev setup with no loss of realism** → **Option 1 (Caddy)**.
  One binary replaces mkcert + nginx, auto cert management, shorter
  config. Same end-user UX as today.
- **Fastest possible onboarding, regardless of realism** → **Option 2
  (`*.localhost`)**. Zero new-dev steps; the cost is non-realistic
  URLs.
- **Preserve the current `.int` + HTTPS look** → **Option 0 (today)
  or Option 1 (Caddy)**. They're functionally equivalent for the
  browser.

Comparison of new-dev onboarding steps:

| Step | Option 0 (current) | Option 1 (Caddy) | Option 2 (`*.localhost`) |
|---|---|---|---|
| `brew install <tool>` | mkcert (+ nss for Firefox) | caddy | — |
| Trust the local CA | `mkcert -install` | `caddy trust` (on first start) | — |
| Generate certs | `mkcert -cert-file …` | auto | — |
| Edit `/etc/hosts` | sudo required | sudo required | — |
| Config file | `nginx.conf` | `Caddyfile` | minimal `nginx.conf` |
| **Commands until `open`** | **4** | **2** | **0** |

## Sources

- [Caddy: Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy: `tls` directive (Caddyfile)](https://caddyserver.com/docs/caddyfile/directives/tls)
- [Setting Up Traefik and mkcert for Local Development — DEV Community](https://dev.to/agusrdz/setting-up-traefik-and-mkcert-for-local-development-48j5)
- [Serving Local Apps Securely with Caddy and Authentik — DEV Community](https://dev.to/lovestaco/serving-local-apps-securely-with-caddy-and-authentik-fixing-tls-warnings-in-development-29op)
- [Use `traefik.me` SSL certificates for local HTTPS (gist) — historical reference](https://gist.github.com/pyrou/4f555cd55677331c742742ee6007a73a)
