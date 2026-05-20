# Nginx Domains & HTTPS — Change Report

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
Unknown hostnames (`curl http://localhost/`) return 404. The cert is
issued by the local `mkcert` CA, which is trusted by the OS keychain
on first install, so Chrome / Safari / Edge see a green lock and no
warning.

## Why HTTPS at all (the bug that forced the rewrite)

The first cut used **HTTP** on the new domains
(`http://domain1.app1.int`). The compose stack came up cleanly, curl
returned 200, the Sign-in button rendered — and then `keycloak-js`
exploded inside `init()` with:

```
Keycloak init error: Error: Web Crypto API is not available.
    at createUUID (keycloak-js.js:1343:11)
    at Keycloak.createLoginUrl (keycloak-js.js:219:21)
    ...
```

Browsers gate `crypto.subtle` (which `keycloak-js` uses to mint PKCE
`state` / `nonce` values) to **secure contexts** — and the rules for
"secure context" are:

- HTTPS, or
- `localhost` / `127.0.0.1`, or
- `file://`

A custom hostname like `domain1.app1.int` over plain HTTP is **not** a
secure context, no matter that it resolves to 127.0.0.1 in
`/etc/hosts`. The browser checks the literal hostname string, not the
resolved IP. So Web Crypto is disabled, and keycloak-js can't even
build the redirect URL — login is dead on arrival.

A short-lived intermediate fix swapped the names to `*.localhost`
(Chrome / Firefox / Safari treat those as `localhost` for
secure-context purposes), but that defeats the whole point of the
exercise: the demo wants to show *named* domains the way a real
deployment would have them. So the proper fix is to keep the `.int`
domains and put them behind HTTPS.

## What changed

### 1. `proxy/certs/` — mkcert-issued local cert

`mkcert` installs a per-developer root CA into the OS trust store
(macOS Keychain, Linux NSS, Windows certmgr). Certificates it issues
under that CA are trusted by the browser without warnings:

```bash
mkcert -install   # idempotent; sets up the local CA on first run
mkcert -cert-file proxy/certs/cert.pem \
       -key-file  proxy/certs/key.pem \
       domain1.app1.int domain2.app2.int domain3.app3.int
```

Both files live under `proxy/certs/` and are **gitignored** — the
private key never lands in the repo. A fresh clone runs the command
above to produce its own copy.

> Firefox uses its own NSS trust store; if you want it to trust the
> mkcert CA: `brew install nss` then re-run `mkcert -install`.

### 2. `proxy/nginx.conf` — TLS on 443, HTTP → HTTPS redirect

```nginx
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
ssl_protocols       TLSv1.2 TLSv1.3;

server {
    listen 443 ssl;
    server_name domain1.app1.int;
    location / { proxy_pass http://web-a:5173; }
}
# … same blocks for domain2/app2 → web-b, domain3/app3 → web-c

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

### 3. `docker-compose.yml` — `proxy` service now exposes `:443`

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

The three BFFs were also updated so the CORS allowlist matches the
new HTTPS origin the browser is now on:

| BFF     | Before                    | After                          |
|---------|---------------------------|--------------------------------|
| `bff-a` | `http://localhost:5173`   | `https://domain1.app1.int`     |
| `bff-b` | `http://localhost:5174`   | `https://domain2.app2.int`     |
| `bff-c` | `http://localhost:5175`   | `https://domain3.app3.int`     |

### 4. `frontend/vite.config.ts` — `allowedHosts`

Vite 5 refuses requests whose `Host` header isn't in
`server.allowedHosts` (DNS-rebinding guard). The three domain names
are added next to `localhost` / `127.0.0.1`:

```ts
allowedHosts: [
  'localhost', '127.0.0.1',
  'domain1.app1.int', 'domain2.app2.int', 'domain3.app3.int'
],
```

Vite itself stays plain HTTP inside the compose network — TLS lives
only at the edge (nginx). The upstream `proxy_pass http://web-a:5173`
is fine because that hop is inside the trusted compose network.

### 5. `keycloak/realm-export.json` — HTTPS URIs per client

For each of `app1-client`, `app2-client`, `app3-client` the new HTTPS
hostname was added to `webOrigins`, `redirectUris`, `rootUrl` and
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

### 6. Live-realm patch via admin API

The realm-export.json edits only land on a *fresh* postgres
(`--import-realm` is `IGNORE_EXISTING`). The first restart hit the
running realm with the old localhost-only URIs, so login broke with
`invalid_parameter: redirect_uri`. Fix: patch all three clients live
with PUT to `/admin/realms/demo-realm/clients/{id}`, passing the new
URI set. This is not a code change — it has to be reapplied any time
the demo is restarted on a non-fresh postgres volume.

### 7. Demo user emails switched to Gmail plus-aliasing

`user-service/src/main/java/demo/userservice/UserController.java`:

| User       | Before                       | After                                |
|------------|------------------------------|--------------------------------------|
| demoadmin  | `nikolai.ivanchev@gmail.com` | `petarnenovpetrov+admin@gmail.com`   |
| demouser   | `nikolay.ivanchev@gmail.com` | `petarnenovpetrov+user@gmail.com`    |
| democlient | `nikiiv.linococo@gmail.com`  | `petarnenovpetrov+client@gmail.com`  |

With Resend in sandbox mode only the account owner actually receives
mail; routing all three demo users to `petarnenovpetrov+...@gmail.com`
makes the OTP email actually arrive in the demo inbox.

## End-to-end request flow

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
   PKCE `state` + `nonce` — **available now because origin is HTTPS**.
2. Browser navigates to
   `http://localhost:8888/realms/demo-realm/protocol/openid-connect/auth?...&redirect_uri=https://domain1.app1.int/`.
3. Keycloak validates `redirect_uri` against `app1-client.redirectUris`
   — matches `https://domain1.app1.int/*`, login form renders.
4. User submits credentials → email OTP → Keycloak issues an auth code
   → redirects to `https://domain1.app1.int/?code=...`.
5. `keycloak-js` exchanges the code for tokens (POST to Keycloak,
   browser-side); BFF calls now carry the bearer token.

## Gotchas worth remembering

- **`window.isSecureContext` is the gatekeeper for Web Crypto, Storage
  Access, Service Workers and a growing list of APIs.** Custom
  hostnames need HTTPS even in dev. `localhost` is the only HTTP
  exception, and only because of an explicit carve-out.
- **`--import-realm` is `IGNORE_EXISTING`.** A realm-export edit only
  lands on a fresh postgres. On any subsequent `./start.sh` against
  an existing volume, the file is read but the existing realm wins.
  Either `docker compose down -v && ./start.sh` (wipes everything) or
  patch via the admin API (preserves sessions; what step 6 above does).
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
- **Firefox doesn't auto-trust the mkcert CA.** Install NSS
  (`brew install nss`) and re-run `mkcert -install` to fix it. Chrome
  / Safari / Edge use the macOS Keychain and trust the CA on first
  install.

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
