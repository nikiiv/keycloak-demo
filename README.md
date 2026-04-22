# Keycloak SSO Demo

Two Vite+TypeScript SPAs with Micronaut BFF services, demonstrating SSO via Keycloak. End-user identities come exclusively from a custom Keycloak User Storage SPI (`keycloak-provider/`); Keycloak's Postgres only holds realm metadata and sessions.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌───────────────────┐
│   App1      │     │   App2      │     │     Keycloak      │
│ (Vite+TS)   │     │ (Vite+TS)   │     │  + custom User SPI│
│  + Micronaut│     │  + Micronaut│     │  (demouser,       │
│    BFF      │     │    BFF      │     │   demoadmin)      │
└──────┬──────┘     └──────┬──────┘     └──────┬────────────┘
       │                   │                   │
       └─────────┬─────────┘                   ▼
                 │                        ┌─────────────┐
                 └──── (JWT via OIDC) ──▶ │ PostgreSQL  │
                                          │ (realm/     │
                                          │  session    │
                                          │  metadata)  │
                                          └─────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Keycloak internal metadata (realm config, sessions) — **not** end users |
| Keycloak | 8888 | Auth server with demo-realm (container port 8080) |
| App1 Frontend | 5173 | Vite dev server |
| App1 BFF | 8081 | Micronaut backend for App1 |
| App2 Frontend | 5174 | Vite dev server |
| App2 BFF | 8082 | Micronaut backend for App2 |

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

1. Open http://localhost:5173 (App1)
2. Click "Login" — you'll be redirected to Keycloak
3. Login with one of the SPI users below
4. Visit the **Profile** tab to see the username, email, name, and realm roles from the JWT
5. Visit the **Protected** tab to see the BFF's view of the same user (fetched via `/api/user`)
6. Open http://localhost:5174 (App2) in a new tab — you'll be automatically logged in (SSO)

## Endpoints

### Frontends
- App1: http://localhost:5173
- App2: http://localhost:5174

Frontends proxy `/api/*` to their BFF via Vite's dev-server proxy, so browser calls are same-origin (no CORS).

### BFF APIs (also reachable directly on the host for testing with curl)
- App1 BFF: http://localhost:8081/api/user, /api/secure, /api/public
- App2 BFF: http://localhost:8082/api/user, /api/secure, /api/public

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

## Implementation notes

- **Provider build is inside the image.** `Dockerfile.keycloak` uses a multi-stage build: stage 1 runs `gradle jar` on `keycloak-provider/`, stage 2 copies the jar into `/opt/keycloak/providers/` and runs `kc.sh build` so the SPI is registered at image-build time.
- **Role claim flattening.** Each client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` protocol mapper that exposes realm roles as a top-level `roles` claim (in addition to `realm_access.roles`). The BFFs are configured with `micronaut.security.token.roles-name: roles` to read it.
- **Client library version matters.** `keycloak-js` must be ≥ 26.x to work with Keycloak 26 — older versions (23.x) validate `nonce` on access/refresh tokens, which KC 26 no longer emits.

## Tear Down

```bash
podman compose down -v
```