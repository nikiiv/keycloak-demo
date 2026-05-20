# Nginx Domains — Architecture Report

Per-app hostnames behind a single nginx reverse proxy with TLS
termination, replacing the `localhost:5173 / :5174 / :5175` URLs that
the three Vite apps used to expose directly. After this change the
browser sees:

| URL                          | App         | Container |
|------------------------------|-------------|-----------|
| `https://domain1.app1.int`   | App A       | `web-a`   |
| `https://domain2.app2.int`   | App B       | `web-b`   |
| `https://domain3.app3.int`   | App C       | `web-c`   |

Plain `http://domainN.appN.int` 301-redirects to its HTTPS sibling.
Unknown hostnames return 404 from the proxy's default servers.

> **Why HTTPS rather than plain HTTP?** The first cut was HTTP and
> login broke immediately with `Web Crypto API is not available` — the
> browser refuses to expose `crypto.subtle` on a non-secure origin, and
> `keycloak-js` needs it for PKCE. Full bug story, secure-context
> rules, the `*.localhost` shortcut we rejected, and the mkcert
> mechanics live in [`web-crypto-https-fix.md`](./web-crypto-https-fix.md).

## What the topology looks like

```
browser  https://domain1.app1.int/
   │   /etc/hosts:  domain1.app1.int → 127.0.0.1
   ▼
host :443  ── nginx (proxy container) ── TLS terminates here
   │      server_name match → upstream over plain HTTP
   ▼
web-a:5173  (Vite dev server)
   │   serves the SPA; allowedHosts includes domain1.app1.int
   │   /api/* is proxied by Vite to BFF_URL
   ▼
bff-a:8080
   │   CORS_ORIGIN = https://domain1.app1.int → preflight OK
   │   validates the bearer JWT
   ▼
keycloak:8888  (still plain HTTP on :8888 for now)
```

Login flow on Sign-in click:

1. SPA calls `keycloak.login()` which calls `crypto.subtle` to build
   PKCE `state` + `nonce` — available because the origin is HTTPS.
2. Browser navigates to
   `http://localhost:8888/realms/demo-realm/protocol/openid-connect/auth?...&redirect_uri=https://domain1.app1.int/`.
3. Keycloak validates `redirect_uri` against `app1-client.redirectUris`
   — matches `https://domain1.app1.int/*`, login form renders.
4. User submits credentials → email OTP → Keycloak issues an auth code
   → redirects back to `https://domain1.app1.int/?code=...`.
5. `keycloak-js` exchanges the code for tokens (POST to Keycloak,
   browser-side); BFF calls now carry the bearer token.

## What changed

### 1. New `proxy` service in `docker-compose.yml`

```yaml
proxy:
  image: nginx:1.27-alpine
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./proxy/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./proxy/certs:/etc/nginx/certs:ro
  networks:
    - keycloak-network
  depends_on: [web-a, web-b, web-c]
```

### 2. `proxy/nginx.conf` — server-name dispatch + TLS + WS upgrade

```nginx
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
ssl_protocols       TLSv1.2 TLSv1.3;

server {
    listen 443 ssl;
    server_name domain1.app1.int;
    location / { proxy_pass http://web-a:5173; }
}
# … domain2/app2 → web-b, domain3/app3 → web-c

# 80 → 443 redirect for the same hostnames; everything else 404.
server {
    listen 80;
    server_name domain1.app1.int domain2.app2.int domain3.app3.int;
    return 301 https://$host$request_uri;
}

server { listen 80  default_server; return 404; }
server { listen 443 ssl default_server; return 404; }
```

Shared `proxy_*` headers (`Host`, `X-Real-IP`, `X-Forwarded-Proto`,
`Upgrade`, `Connection`) are declared once at the `http {}` level so
all three server blocks inherit them. WebSocket upgrade plumbing is
preserved so Vite HMR still works through the proxy.

### 3. Frontend — extended `allowedHosts`

Vite 5 refuses requests whose `Host` header isn't in
`server.allowedHosts` (DNS-rebinding guard). The three domain names are
added next to `localhost` / `127.0.0.1`:

```ts
allowedHosts: [
  'localhost', '127.0.0.1',
  'domain1.app1.int', 'domain2.app2.int', 'domain3.app3.int'
],
```

### 4. BFFs — `CORS_ORIGIN`

Each BFF was pinned to `http://localhost:517X`; updated to the matching
new HTTPS origin so the browser, now living on
`https://domain1.app1.int`, can call its BFF cross-origin:

| BFF     | Before                    | After                          |
|---------|---------------------------|--------------------------------|
| `bff-a` | `http://localhost:5173`   | `https://domain1.app1.int`     |
| `bff-b` | `http://localhost:5174`   | `https://domain2.app2.int`     |
| `bff-c` | `http://localhost:5175`   | `https://domain3.app3.int`     |

### 5. Keycloak realm — new HTTPS URIs per client

For each of `app1-client`, `app2-client`, `app3-client` the new HTTPS
hostname was added to `webOrigins`, `redirectUris`, `rootUrl`, and
`baseUrl`. The original `localhost:517X` and `127.0.0.1:517X` entries
stay in place as a fallback for direct-port access. Example for
`app1-client`:

```diff
- "webOrigins":   ["http://localhost:5173", "http://127.0.0.1:5173"],
- "redirectUris": ["http://localhost:5173/*", "http://127.0.0.1:5173/*"],
- "baseUrl":      "http://localhost:5173/",
- "rootUrl":      "http://localhost:5173",
+ "webOrigins":   ["http://localhost:5173", "http://127.0.0.1:5173", "https://domain1.app1.int"],
+ "redirectUris": ["http://localhost:5173/*", "http://127.0.0.1:5173/*", "https://domain1.app1.int/*"],
+ "baseUrl":      "https://domain1.app1.int/",
+ "rootUrl":      "https://domain1.app1.int",
```

The realm-export edits only land on a *fresh* postgres
(`--import-realm` is `IGNORE_EXISTING`). Any running stack from before
this commit has to be re-aligned via the admin API — see "Gotchas"
below.

### 6. Demo user emails — Gmail plus-aliasing

`user-service/src/main/java/demo/userservice/UserController.java`:

| User       | Before                       | After                                |
|------------|------------------------------|--------------------------------------|
| demoadmin  | `nikolai.ivanchev@gmail.com` | `petarnenovpetrov+admin@gmail.com`   |
| demouser   | `nikolay.ivanchev@gmail.com` | `petarnenovpetrov+user@gmail.com`    |
| democlient | `nikiiv.linococo@gmail.com`  | `petarnenovpetrov+client@gmail.com`  |

With Resend in sandbox mode only the account owner actually receives
mail; plus-aliasing routes the OTP email to one inbox while preserving
three distinct identities.

### 7. mkcert-issued local certs

`proxy/certs/{cert,key}.pem` are mkcert-issued and gitignored. Each
developer regenerates them once:

```bash
mkcert -install
mkcert -cert-file proxy/certs/cert.pem \
       -key-file  proxy/certs/key.pem \
       domain1.app1.int domain2.app2.int domain3.app3.int
```

Mechanics and trust-store caveats (Firefox, etc.) are covered in
[`web-crypto-https-fix.md`](./web-crypto-https-fix.md).

## Why

- **Realistic URLs.** `localhost:5173` is a dev-only oddity. The three
  apps representing distinct domains in the demo should look like
  distinct domains in the browser — the way they would in production
  (`billing.company.com`, `reporting.company.com`, …). Port-based
  origins also mean three different cookie jars, which is fine for
  testing isolation but doesn't mirror what real deployments do.
- **Single-port surface.** Removes the cognitive load of "which port
  was the admin app on again?" and lets bookmarks / docs use stable,
  pronounceable URLs.
- **Closer to a deployable topology.** Adding nginx in the demo
  surfaces the same operational concerns a real deployment hits:
  CORS preflight, WebSocket upgrade through a reverse proxy, the
  `Host` header allowlist on the upstream dev server, TLS termination
  + cert distribution, and redirect-URI registration in Keycloak.
  None of these are visible when you point a browser at
  `localhost:5173` directly.
- **OTP routing.** With Resend in sandbox mode only one inbox actually
  receives mail. Plus-aliasing lets every demo account complete the
  OTP step against a real inbox while still presenting three distinct
  identities to Keycloak.

## Gotchas

- **`--import-realm` is `IGNORE_EXISTING`.** A realm-export edit only
  lands on a fresh postgres. On any subsequent `./start.sh` against
  an existing volume the file is read but the existing realm wins.
  Two ways out: `docker compose down -v && ./start.sh` (wipes
  everything) or patch via the admin API (preserves sessions).
- **Vite's `allowedHosts` is a hard gate** with a misleading error
  message — looks like a proxy misconfig, is actually a framework
  guard.
- **`/etc/hosts` is host-side.** Compose can't add it. Required entry:
  `127.0.0.1 domain1.app1.int domain2.app2.int domain3.app3.int`.
- **HMR survives the proxy** only because of `proxy_http_version 1.1`
  + the `Upgrade` / `Connection` headers in `nginx.conf`. Drop them
  and live reload silently breaks while the rest of the app keeps
  working.
- **Keycloak is still on plain `http://localhost:8888`.** A future
  step could give it its own HTTPS hostname (`auth.app.int`) behind
  the same nginx and align the `iss` claim with the production URL.

## Files touched

| File                                                              | Change |
|-------------------------------------------------------------------|--------|
| `docker-compose.yml`                                              | new `proxy` service with `:80` + `:443`; cert volume mount; BFF `CORS_ORIGIN` switched to `https://…` |
| `proxy/nginx.conf`                                                | new — TLS termination + HTTP → HTTPS redirect + WS upgrade |
| `proxy/certs/{cert,key}.pem`                                      | new — mkcert-issued, **gitignored** |
| `.gitignore`                                                      | added `.vite/` and `proxy/certs/` |
| `frontend/vite.config.ts`                                         | extended `allowedHosts` |
| `keycloak/realm-export.json`                                      | added HTTPS URIs to all three client entries |
| `user-service/src/main/java/demo/userservice/UserController.java` | demo emails switched to plus-alias |

Plus the host-side `/etc/hosts` entry and the one-time admin-API
client patch for any realm whose postgres survived from before this
commit.
