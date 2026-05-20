# Web Crypto / Secure Context — The HTTP-Domain Bug and the HTTPS Fix

A focused writeup of the bug that surfaced when we first tried the new
`http://domainN.appN.int` URLs, why it happened, and why the fix had to
be HTTPS rather than something cheaper.

For the broader architecture (the nginx proxy itself, the per-app
hostnames, the Keycloak / BFF / Vite plumbing) see
[`nginx-domains-report.md`](./nginx-domains-report.md).

## The symptom

The first cut used plain HTTP on the new hostnames. The compose stack
came up, the SPA loaded, the Sign-in button rendered — and then
`keycloak-js` exploded inside `init()`:

```
localhost:8888/realms/demo-realm/protocol/openid-connect/3p-cookies/step1.html:39
  requestStorageAccess: May not be used in an insecure context.

installHook.js:1 Keycloak init error: Error: Web Crypto API is not available.
    at createUUID (keycloak-js.js:1343:11)
    at Keycloak.createLoginUrl (keycloak-js.js:219:21)
    at Keycloak.checkSsoSilently_fn (keycloak-js.js:1080:26)
    at onLoad (keycloak-js.js:977:114)
    at Keycloak.processInit_fn (keycloak-js.js:1010:11)
    at Keycloak.init (keycloak-js.js:203:72)
    at async DemoApp.init (App.ts:63:29)
```

Two different errors, same root cause:

- `requestStorageAccess: May not be used in an insecure context` — the
  Storage Access API call inside the Keycloak third-party-cookies probe
  iframe.
- `Web Crypto API is not available` — `keycloak-js` calling
  `crypto.subtle` to generate PKCE `state` / `nonce` random values.

Both APIs are gated by `window.isSecureContext`. When the SPA's origin
isn't a secure context, the browser doesn't expose them.

## Why HTTP on a custom domain isn't a secure context

The browser's definition of "secure context"
([W3C spec](https://w3c.github.io/webappsec-secure-contexts/)):

- `https://...` — always secure.
- `localhost` — explicit carve-out so dev workflows aren't HTTPS-only.
- `127.0.0.1` and `[::1]` — same carve-out for the loopback IPs.
- `*.localhost` — a Chrome / Firefox / Safari extension of the
  `localhost` carve-out (per RFC 6761).
- Everything else — needs HTTPS.

The decision is on the **literal hostname string in the URL**, not on
where the name resolves. So even though `domain1.app1.int` points at
`127.0.0.1` via `/etc/hosts`, the browser sees the hostname
`domain1.app1.int`, which doesn't match any carve-out, and refuses to
mark the context as secure.

`keycloak-js` calls `crypto.subtle` very early in `init()` to build the
login URL. With Web Crypto unavailable, it throws before even rendering
the redirect — the user clicks Sign in and nothing happens (or worse,
sees a stack trace in the console).

## The shortcut we considered and rejected

Renaming the hostnames to `*.localhost` (e.g. `app1.localhost`,
`app2.localhost`, `app3.localhost`) would have fixed the bug without
any TLS work:

- Chrome 88+, Firefox 84+, Safari all treat `*.localhost` as
  `localhost` for secure-context purposes.
- The OS / browser auto-resolves `*.localhost` to `127.0.0.1`, so the
  `/etc/hosts` entries also go away.

We actually shipped that variant briefly. But it defeats the whole
point of the exercise: the demo wants to show *named* domains the way
a real deployment would have them — `billing.company.com`,
`reporting.company.com`, … — not a re-skin of `localhost`. The right
fix is to keep the `.int` names and put them behind HTTPS.

## The fix: TLS termination at nginx with mkcert

The nginx proxy already existed (see `nginx-domains-report.md`). The
HTTPS migration adds three things:

### 1. Per-developer local CA via `mkcert`

`mkcert` is the trusted-local-CA tool. On macOS it installs a root CA
into the system Keychain; certs it then issues under that CA are
trusted by Chrome / Safari / Edge automatically.

```bash
mkcert -install   # idempotent; sets up the local CA on first run
mkcert -cert-file proxy/certs/cert.pem \
       -key-file  proxy/certs/key.pem \
       domain1.app1.int domain2.app2.int domain3.app3.int
```

The resulting `cert.pem` + `key.pem` cover the three SANs we need.
Both files live under `proxy/certs/` and are **gitignored** — the
private key never lands in the repo. A fresh clone runs the command
above to produce its own cert.

Firefox uses its own NSS trust store; `brew install nss` + re-running
`mkcert -install` extends the trust there too.

### 2. nginx HTTPS server blocks + HTTP→HTTPS redirect

```nginx
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
ssl_protocols       TLSv1.2 TLSv1.3;

server {
    listen 443 ssl;
    server_name domain1.app1.int;
    location / { proxy_pass http://web-a:5173; }
}
# … same for domain2/app2 → web-b, domain3/app3 → web-c

# 80 → 443 redirect for the same hostnames; everything else 404.
server {
    listen 80;
    server_name domain1.app1.int domain2.app2.int domain3.app3.int;
    return 301 https://$host$request_uri;
}

server { listen 80  default_server; return 404; }
server { listen 443 ssl default_server; return 404; }
```

TLS terminates at nginx. The upstream hop into the Vite container is
still plain HTTP (`proxy_pass http://web-a:5173`) — that link lives
inside the compose network, which is trusted, and Vite doesn't need to
know anything about certs.

### 3. Everything downstream updated to the HTTPS origin

- `docker-compose.yml` — `proxy` service exposes `:443` in addition to
  `:80`, mounts `./proxy/certs:/etc/nginx/certs:ro`. The three BFFs'
  `CORS_ORIGIN` env vars switch from `http://localhost:517X` to
  `https://domainN.appN.int`.
- `keycloak/realm-export.json` — each of `app1-client`, `app2-client`,
  `app3-client` gains `https://domainN.appN.int` in `webOrigins`,
  `redirectUris`, `rootUrl`, `baseUrl`. The old localhost entries stay
  in place as a fallback for direct-port access.
- `frontend/vite.config.ts` — `allowedHosts` already had the three
  `.int` names from the original cut; no change.
- Live realm patched via admin API (see "Gotcha 2" below).

## Verification after the fix

```bash
$ curl -sI http://domain1.app1.int/ | head -3
HTTP/1.1 301 Moved Permanently
Server: nginx/1.27.5

$ curl -sI https://domain1.app1.int/ | head -3
HTTP/1.1 200 OK
Server: nginx/1.27.5
```

In the browser:

- Padlock is green (mkcert CA in the system Keychain).
- DevTools → Application → Security shows "This page is secure".
- `window.isSecureContext` returns `true`.
- `crypto.subtle` is defined.
- Sign in → Keycloak login form → email OTP → redirect back → tokens
  in keycloak-js memory → BFF calls succeed.

## Gotchas

### 1. `--import-realm` is `IGNORE_EXISTING`

The `keycloak/realm-export.json` edits we made don't land on a
postgres volume that already has a `demo-realm`. The very first start
after the HTTPS migration hit the *old* realm definition, so the
Keycloak redirect-URI check rejected `https://domain1.app1.int/`. Fix
was to PATCH the three clients live via the admin API:

```bash
PUT /admin/realms/demo-realm/clients/{id}
{
  "webOrigins":   ["http://localhost:517X", "http://127.0.0.1:517X", "https://domainN.appN.int"],
  "redirectUris": ["http://localhost:517X/*", "http://127.0.0.1:517X/*", "https://domainN.appN.int/*"],
  "rootUrl":      "https://domainN.appN.int",
  "baseUrl":      "https://domainN.appN.int/"
}
```

This has to be reapplied any time the demo restarts on a non-fresh
postgres volume, or you wipe the volume with `docker compose down -v`
to get the JSON-defined realm.

### 2. Vite stays HTTP inside the network

Don't be tempted to add `server.https = true` in `vite.config.ts`.
The dev server stays plain HTTP; the proxy does TLS. Vite over HTTPS
would force every container-to-container hop to deal with the cert
too, for no gain.

### 3. Firefox doesn't trust the mkcert CA by default

Chrome / Safari / Edge use the macOS Keychain and trust the CA on
first install. Firefox uses NSS:

```bash
brew install nss
mkcert -install   # picks up NSS now and installs there too
```

### 4. `window.isSecureContext` cascades

If you ever embed one of these apps in an iframe inside a non-secure
parent, the iframe still loses `isSecureContext`. Whole document tree
has to be HTTPS for the API gating to lift.

## Summary

- The bug was the browser's secure-context gate, not anything specific
  to Keycloak or our SPA.
- HTTPS is the only fix that keeps the `.int` hostnames; `*.localhost`
  works but isn't what we want for the demo.
- mkcert makes the dev experience identical to a real domain — green
  lock, no warnings, no `chrome://flags` tweaks — at the cost of a
  one-line install step on each new dev machine.
- The implementation lands in nginx; nothing in the SPA, Vite or
  Keycloak code had to be re-architected.
