# Keycloak SSO Demo

One Vite+TypeScript SPA and one Micronaut BFF codebase, launched three times as **App A**, **App B**, and **App C** with different Keycloak client IDs. App A and B accept any authenticated user; App C additionally requires the realm role `admin` — so the same `demouser` SSO session is *authenticated* but *not authorized* on App C. End-user identities come exclusively from a custom Keycloak User Storage SPI (`keycloak-provider/`); Keycloak's Postgres only holds realm metadata and sessions.

## Architecture

```
┌──────────────────────────────────────────┐     ┌───────────────────┐
│  frontend/  (one codebase)               │     │     Keycloak      │
│    └── run as web-a  (:5173)             │     │  + custom User SPI│
│    └── run as web-b  (:5174)             │     │  (demouser,       │
│    └── run as web-c  (:5175, admin-only) │     │   demoadmin)      │
│                                          │     └──────┬────────────┘
│  bff/  (one codebase)                    │            │
│    └── run as bff-a  (:8081)             │            │
│    └── run as bff-b  (:8082)             │            │
│    └── run as bff-c  (:8083, admin-only) │            │
└───────────────┬──────────────────────────┘            │
                │                                       ▼
                │                                 ┌─────────────┐
                └──────── (JWT via OIDC) ───────▶ │ PostgreSQL  │
                                                  │ (realm /    │
                                                  │  session    │
                                                  │  metadata)  │
                                                  └─────────────┘
```

Each compose service passes its own `VITE_KEYCLOAK_CLIENT_ID` (`app1-client` / `app2-client` / `app3-client`) and `APP_SOURCE` (`bff-a` / `bff-b` / `bff-c`) so the same source tree behaves as three independent OIDC clients. `web-c` / `bff-c` additionally set `VITE_REQUIRED_ROLE=admin` / `APP_REQUIRED_ROLE=admin` to turn on the role gate.

## Services

| Service | Host port | Role |
|---------|-----------|------|
| PostgreSQL | 5432 | Keycloak internal metadata (realm config, sessions) — **not** end users |
| Keycloak | 8888 | Auth server with demo-realm (container port 8080) |
| web-a | 5173 | Vite dev server, OIDC client `app1-client` |
| web-b | 5174 | Vite dev server, OIDC client `app2-client` |
| web-c | 5175 | Vite dev server, OIDC client `app3-client` (requires `admin`) |
| bff-a | 8081 | Micronaut backend for web-a |
| bff-b | 8082 | Micronaut backend for web-b |
| bff-c | 8083 | Micronaut backend for web-c (rejects non-admin with 403) |

## Quick Start

```bash
podman compose up
```

Wait for all services to start (Keycloak takes ~30 seconds). The custom Keycloak User SPI in `keycloak-provider/` is compiled during the image build — no pre-built jar required.

### Running with Podman on macOS

`docker compose` (the CLI that Podman delegates to) talks to a Docker-style socket, so you need to point `DOCKER_HOST` at the Podman machine socket before running `podman compose`:

```bash
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

A `.envrc` with this line is included in the repo. If you use [direnv](https://direnv.net/), run `direnv allow` once and it will be set automatically whenever you `cd` into the project. Otherwise just `source .envrc` in each shell.

## Test SSO

1. Open http://localhost:5173 (App A)
2. Click "Login" — you'll be redirected to Keycloak
3. Login with one of the SPI users below
4. Visit the **Profile** tab to see the username, email, name, and realm roles from the JWT
5. Visit the **Protected** tab to see the BFF's view of the same user (fetched via `/api/user`) — the `source` field shows which BFF responded (`bff-a`)
6. Open http://localhost:5174 (App B) in a new tab — you'll be automatically logged in (SSO); Protected tab there shows `source: bff-b`
7. Open http://localhost:5175 (App C) in a new tab — SSO logs you in automatically too. If you logged in as `demouser`, you'll see a red banner on every page saying authentication succeeded but you lack the `admin` role, and the BFF will return 403 on `/api/user`. Log out and back in as `demoadmin` to see the Protected tab turn red and the BFF return 200.

## Visual states on the Protected tab

The Protected panel encodes **role**, not app:

| State | Color | Meaning |
|---|---|---|
| Not authenticated | Yellow | No Keycloak session |
| Authenticated without `admin` | Blue | `demouser` — authenticated ✓ |
| Authenticated with `admin` | Red | `demoadmin` — authenticated ✓ with elevated role |

On **App C only**, an additional red banner appears on every page when the logged-in user lacks the `admin` role — making clear that AuthN succeeded but AuthZ did not.

## Endpoints

### Frontends
- App A: http://localhost:5173
- App B: http://localhost:5174
- App C: http://localhost:5175 (admin-only)

Frontends proxy `/api/*` to their BFF via Vite's dev-server proxy, so browser calls are same-origin (no CORS).

### BFF APIs (also reachable directly on the host for testing with curl)
- bff-a: http://localhost:8081/api/user, /api/secure, /api/public
- bff-b: http://localhost:8082/api/user, /api/secure, /api/public
- bff-c: http://localhost:8083/api/user (admin-only — returns 403 with a structured body for non-admins)

### Keycloak Admin
- URL: http://localhost:8888
- Credentials: `admin` / `admin`

## Demo Users (from the custom SPI)

Users are hardcoded in `keycloak-provider/src/main/java/com/example/keycloak/DemoUserStorageProvider.java`, **not** in Keycloak's Postgres tables. The realm export attaches the provider via `components["org.keycloak.storage.UserStorageProvider"]`.

| Username | Password | SPI-assigned roles |
|----------|----------|--------------------|
| `demouser` | `123` | `user` |
| `demoadmin` | `123` | `admin`, `user` |

Keycloak automatically adds the default realm roles (`offline_access`, `uma_authorization`) on top of the SPI roles, so the Profile tab will show all of them.

## Parameterization

The same `frontend/` and `bff/` sources are launched three times — every app-specific value is an env var set in `docker-compose.yml`:

| Env var | Read by | Purpose |
|---------|---------|---------|
| `VITE_KEYCLOAK_URL` | `frontend/src/Keycloak.ts` | Keycloak issuer URL (browser-side) |
| `VITE_KEYCLOAK_CLIENT_ID` | `frontend/src/Keycloak.ts` | Which OIDC client to authenticate as |
| `VITE_APP_NAME` | `frontend/src/App.ts` | Display label in nav + headings |
| `VITE_APP_TITLE` | `frontend/index.html`, `frontend/src/App.ts` | Browser tab title (defaults to `VITE_APP_NAME` if unset) |
| `VITE_REQUIRED_ROLE` | `frontend/src/App.ts` | If set, gate the app and show the red banner when the user lacks this role (App C: `admin`) |
| `BFF_URL` | `frontend/vite.config.ts` | Proxy target for `/api/*` from this frontend |
| `MICRONAUT_APPLICATION_NAME` | Micronaut | Service name in logs |
| `APP_SOURCE` | `bff/src/main/java/demo/UserController.java` | Value of the `source` field in BFF responses |
| `APP_REQUIRED_ROLE` | `bff/src/main/java/demo/UserController.java` | If set, `/api/user` returns 403 with a structured body when the token lacks this role (bff-c: `admin`) |
| `CORS_ORIGIN` | `bff/src/main/resources/application.yml` | Single allowed origin (the paired frontend) |
| `KEYCLOAK_AUTH_SERVER_URL` | BFF | Internal URL to Keycloak for JWKS lookup |

## Implementation notes

- **Provider build is inside the image.** `Dockerfile.keycloak` uses a multi-stage build: stage 1 runs `gradle jar` on `keycloak-provider/`, stage 2 copies the jar into `/opt/keycloak/providers/` and runs `kc.sh build` so the SPI is registered at image-build time.
- **Role claim flattening.** Each client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` protocol mapper that exposes realm roles as a top-level `roles` claim (in addition to `realm_access.roles`). The BFFs are configured with `micronaut.security.token.roles-name: roles` to read it.
- **Client library version matters.** `keycloak-js` must be ≥ 26.x to work with Keycloak 26 — older versions (23.x) validate `nonce` on access/refresh tokens, which KC 26 no longer emits.
- **Isolated node_modules per container.** Each `web-*` service mounts `./frontend` as source but uses an anonymous volume for `/app/node_modules`, so the two `npm install` invocations don't race on the bind-mounted directory.

## Tear Down

```bash
podman compose down -v
```
