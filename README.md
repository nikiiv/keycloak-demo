# Keycloak SSO Demo

One Vite+TypeScript SPA and one Micronaut BFF codebase, launched three times as **App A**, **App B**, and **App C**. Each is a separate OIDC client; together they demonstrate single sign-on *and* per-app authorization:

- **App A** — open to everyone (roles `client`, `user`, `admin`).
- **App B** — closed to clients (roles `user`, `admin`).
- **App C** — admins only (role `admin`).

End-user identities come exclusively from a custom Keycloak User Storage SPI (`keycloak-provider/`); Keycloak's Postgres only holds realm metadata and sessions.

## Architecture

```
┌──────────────────────────────────────────┐     ┌───────────────────┐
│  frontend/  (one codebase)               │     │     Keycloak      │
│    └── run as web-a  (:5173) — open      │     │  + custom User SPI│
│    └── run as web-b  (:5174) — no clients│     │  (democlient,     │
│    └── run as web-c  (:5175) — admin only│     │   demouser,       │
│                                          │     │   demoadmin)      │
│  bff/  (one codebase)                    │     └──────┬────────────┘
│    └── run as bff-a  (:8081)             │            │
│    └── run as bff-b  (:8082)             │            │
│    └── run as bff-c  (:8083)             │            │
└───────────────┬──────────────────────────┘            │
                │                                       ▼
                │                                 ┌─────────────┐
                └──────── (JWT via OIDC) ───────▶ │ PostgreSQL  │
                                                  │ (realm /    │
                                                  │  session    │
                                                  │  metadata)  │
                                                  └─────────────┘
```

Each compose service passes its own `VITE_KEYCLOAK_CLIENT_ID` (`app1-client` / `app2-client` / `app3-client`) and `APP_SOURCE` (`bff-a` / `bff-b` / `bff-c`) so the same source tree behaves as three independent OIDC clients. App B and App C use `VITE_FORBIDDEN_ROLE=client` / `APP_FORBIDDEN_ROLE=client` to block client-role users; App C additionally uses `VITE_REQUIRED_ROLE=admin` / `APP_REQUIRED_ROLE=admin` to require the admin role.

## Access matrix

| User → | App A | App B | App C |
|---|---|---|---|
| `democlient` (role: `client`) | ✓ 200 | ✗ 403 — forbidden role | ✗ 403 — forbidden role |
| `demouser` (role: `user`) | ✓ 200 | ✓ 200 | ✗ 403 — missing required role |
| `demoadmin` (roles: `admin`, `user`) | ✓ 200 | ✓ 200 | ✓ 200 |

Enforcement happens both in the frontend (banners) and the BFF (`/api/user` returns a structured 403 JSON body). The BFF check is the authoritative one; the frontend banner is a UX hint.

## Services

| Service | Host port | Role |
|---------|-----------|------|
| PostgreSQL | 5432 | Keycloak internal metadata (realm config, sessions) — **not** end users |
| Keycloak | 8888 | Auth server with demo-realm (container port 8080) |
| web-a | 5173 | Vite dev server, OIDC client `app1-client`, no role gate |
| web-b | 5174 | Vite dev server, OIDC client `app2-client`, blocks `client` role |
| web-c | 5175 | Vite dev server, OIDC client `app3-client`, requires `admin`, blocks `client` |
| bff-a | 8081 | Micronaut backend for web-a |
| bff-b | 8082 | Micronaut backend for web-b (enforces `APP_FORBIDDEN_ROLE=client`) |
| bff-c | 8083 | Micronaut backend for web-c (enforces `APP_REQUIRED_ROLE=admin` + forbidden `client`) |

## Quick Start

```bash
podman compose up
```

Wait for all services to start (Keycloak takes ~30 seconds; each BFF's first build takes a minute or two to resolve Gradle dependencies). The custom Keycloak User SPI in `keycloak-provider/` is compiled during the image build — no pre-built jar required.

### Running with Podman on macOS

`docker compose` (the CLI that Podman delegates to) talks to a Docker-style socket, so you need to point `DOCKER_HOST` at the Podman machine socket before running `podman compose`:

```bash
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

A `.envrc` with this line is included in the repo. If you use [direnv](https://direnv.net/), run `direnv allow` once and it will be set automatically whenever you `cd` into the project. Otherwise just `source .envrc` in each shell.

## Test SSO + AuthZ

1. Open http://localhost:5173 (App A).
2. Click "Login" — you'll be redirected to Keycloak.
3. Log in with one of the SPI users below.
4. Visit the **Profile** tab to see the username, email, name, and realm roles from the JWT.
5. Visit the **Protected** tab to see the BFF's view of the same user (fetched via `/api/user`). The `source` field shows which BFF responded (`bff-a`), and the panel color reflects the role.
6. Open http://localhost:5174 (App B) in a new tab — SSO logs you in automatically. As `demouser` / `demoadmin` you'll see the Protected page; as `democlient` a dark "not a client area" banner appears on every page and the BFF returns 403.
7. Open http://localhost:5175 (App C). As `demoadmin` you get the Protected page (red panel). As `demouser` you get a red "requires admin" banner on every page. As `democlient` you get the "not a client area" banner (the forbidden-role check takes precedence over the required-role check).

## Visual states

**Protected panel color** encodes the user's role across all apps:

| State | Color | Meaning |
|---|---|---|
| Not authenticated | Yellow | No Keycloak session |
| Authenticated without `admin` | Blue | `democlient` or `demouser` |
| Authenticated with `admin` | Red | `demoadmin` |

**Banners** appear on every page of the affected app:

| Condition | Banner |
|---|---|
| On App B or C, user has role `client` | ⛔ **dark red** "not a `client` area" banner |
| On App C, user authenticated but lacks `admin` | ⚠ **red** "requires role `admin`" banner |

The forbidden-role banner takes precedence when both conditions apply.

## Endpoints

### Frontends
- App A: http://localhost:5173 (open to all roles)
- App B: http://localhost:5174 (no clients)
- App C: http://localhost:5175 (admin only)

Frontends proxy `/api/*` to their BFF via Vite's dev-server proxy, so browser calls are same-origin (no CORS).

### BFF APIs (also reachable directly on the host for testing with curl)
- bff-a: http://localhost:8081/api/user, /api/secure, /api/public
- bff-b: http://localhost:8082/api/user (returns 403 with `reason: "forbidden_role"` for `client`)
- bff-c: http://localhost:8083/api/user (403 with `reason: "forbidden_role"` for `client`; 403 with `reason: "missing_required_role"` for non-admin; 200 for admin)

### Keycloak Admin
- URL: http://localhost:8888
- Credentials: `admin` / `admin`

## Demo Users (from the custom SPI)

Users are hardcoded in `keycloak-provider/src/main/java/com/example/keycloak/DemoUserStorageProvider.java`, **not** in Keycloak's Postgres tables.

| Username | Password | SPI-assigned roles |
|----------|----------|--------------------|
| `democlient` | `123` | `client` |
| `demouser` | `123` | `user` |
| `demoadmin` | `123` | `admin`, `user` |

Keycloak's built-in composite `default-roles-demo-realm` adds `offline_access` and `uma_authorization` on top of the SPI roles; it no longer includes `user`, so `democlient` really does get only `client`.

## The Keycloak User Storage Provider (`keycloak-provider/`)

This module is a standalone Gradle project that implements Keycloak's **User Storage SPI** — a federation plugin that lets Keycloak pull users from an external source (here: a hardcoded `Map`, but in real deployments typically LDAP/AD, a legacy DB, or a bespoke HTTP service). The users never land in Keycloak's Postgres; the SPI is consulted live on every lookup / login.

### Files

```
keycloak-provider/
├── build.gradle.kts            # Gradle build; compileOnly deps on keycloak-core + SPI jars
├── settings.gradle.kts
└── src/main/
    ├── java/com/example/keycloak/
    │   ├── DemoUserStorageProviderFactory.java   # factory — PROVIDER_ID "demo-user-provider"
    │   ├── DemoUserStorageProvider.java          # the provider: implements UserLookupProvider + CredentialInputValidator
    │   └── DemoUser.java                         # per-user adapter, extends AbstractUserAdapter
    └── resources/META-INF/services/
        └── org.keycloak.storage.UserStorageProviderFactory   # Java SPI registration (one line: factory FQCN)
```

### How the three classes fit together

1. **Factory** (`DemoUserStorageProviderFactory`). Keycloak discovers it via the `META-INF/services/` file (standard Java `ServiceLoader` mechanism). Its `getId()` returns `"demo-user-provider"` — this is the string the realm import file references to attach the provider to the realm. Its `create()` is called once per request scope, handing back a new provider instance.
2. **Provider** (`DemoUserStorageProvider`). Implements two capability interfaces:
   - `UserLookupProvider` — `getUserByUsername`, `getUserById`, `getUserByEmail`. Keycloak calls these during login and token issuance.
   - `CredentialInputValidator` — `supportsCredentialType`, `isConfiguredFor`, `isValid`. Keycloak calls `isValid` with the submitted password; the demo compares it to the in-memory record.
3. **User adapter** (`DemoUser`). A thin wrapper around the `DemoUserRecord` (username / password / email / roles), backed by Keycloak's `AbstractUserAdapter`. The key override is `getRoleMappingsInternal()`, which auto-creates any realm role named in the record if it doesn't already exist — this is what lets a fresh realm accept `client`, `user`, and `admin` even though only `user` / `admin` / `client` are pre-declared in `realm-export.json`. All the `set*()` / mutation methods are no-ops because the SPI is read-only.

### How the realm attaches to the provider

`keycloak/realm-export.json` registers a component in the realm:

```json
"components": {
  "org.keycloak.storage.UserStorageProvider": [
    {
      "name": "demo-user-provider",
      "providerId": "demo-user-provider",   // must match PROVIDER_ID in the factory
      "subComponents": {},
      "config": { "enabled": ["true"], "priority": ["0"], "cachePolicy": ["NO_CACHE"] }
    }
  ]
}
```

On realm import Keycloak looks up a factory with `providerId == "demo-user-provider"` and enables it for the realm. `NO_CACHE` is used so changes in the hardcoded `Map` take effect on the next request (important for a live demo; real providers usually want some cache policy).

### Build and runtime wiring

`Dockerfile.keycloak` runs a multi-stage build:

```
FROM gradle:8.5-jdk17 AS provider-build
COPY keycloak-provider/ .
RUN gradle --no-daemon jar                             # produces keycloak-demo-provider-1.0.0.jar

FROM quay.io/keycloak/keycloak:26.0.7
COPY --from=provider-build .../keycloak-demo-provider-1.0.0.jar /opt/keycloak/providers/
RUN /opt/keycloak/bin/kc.sh build                      # bakes the provider into the server image
```

That means the SPI is part of the `keycloak-demo-keycloak` image and is available the moment Keycloak starts — no hot-deploy dance, no manual admin UI registration. Changes to the provider source require `podman compose build keycloak` and a container recreate to take effect.

### Adding a user

Edit the `USERS` map in `DemoUserStorageProvider.java`:

```java
static final Map<String, DemoUserRecord> USERS = Map.of(
    "demoadmin",  new DemoUserRecord("demoadmin",  "123", "...", "Demo", "Admin",  Set.of("admin", "user")),
    "demouser",   new DemoUserRecord("demouser",   "123", "...", "Demo", "User",   Set.of("user")),
    "democlient", new DemoUserRecord("democlient", "123", "...", "Demo", "Client", Set.of("client")),
    "newguy",     new DemoUserRecord("newguy",     "pw",  "...", "New",  "Guy",    Set.of("user", "client"))
);
```

Any role named that doesn't exist in the realm is auto-created at first login (see `DemoUser.getRoleMappingsInternal`). Realm roles that are referenced by BFF role gates should still be declared in `keycloak/realm-export.json` so a fresh-realm install has the same capabilities without waiting for a user to trigger auto-creation.

### Extending the provider to query a real backend

Three steps, conceptually:

1. Replace the hardcoded `USERS` map with whatever lookup you need — a JDBC query, an HTTP call to your identity service, an LDAP bind, etc.
2. If your backend stores password hashes, change `isValid()` to compare hashes instead of plaintext (or return `false` and delegate password validation to Keycloak by implementing `UserStorageCredentialConfigured` differently).
3. Add any extra capabilities your integration needs: `UserQueryProvider` for search-in-admin-console support, `UserRegistrationProvider` for self-service signup writing back to your source, etc.

The factory's `getId()` stays the same, so no realm-export change is required; only the provider and adapter bodies change.

## Parameterization

The same `frontend/` and `bff/` sources are launched three times — every app-specific value is an env var set in `docker-compose.yml`:

| Env var | Read by | Purpose |
|---------|---------|---------|
| `VITE_KEYCLOAK_URL` | `frontend/src/Keycloak.ts` | Keycloak issuer URL (browser-side) |
| `VITE_KEYCLOAK_CLIENT_ID` | `frontend/src/Keycloak.ts` | Which OIDC client to authenticate as |
| `VITE_APP_NAME` | `frontend/src/App.ts` | Display label in nav + headings |
| `VITE_APP_TITLE` | `frontend/index.html`, `frontend/src/App.ts` | Browser tab title (defaults to `VITE_APP_NAME` if unset) |
| `VITE_REQUIRED_ROLE` | `frontend/src/App.ts` | If set, show "requires role X" banner when user lacks it (App C: `admin`) |
| `VITE_FORBIDDEN_ROLE` | `frontend/src/App.ts` | If set, show "not a X area" banner when user has it (App B, C: `client`) |
| `BFF_URL` | `frontend/vite.config.ts` | Proxy target for `/api/*` from this frontend |
| `MICRONAUT_APPLICATION_NAME` | Micronaut | Service name in logs |
| `APP_SOURCE` | `bff/src/main/java/demo/UserController.java` | Value of the `source` field in BFF responses |
| `APP_REQUIRED_ROLE` | `bff/src/main/java/demo/UserController.java` | If set, `/api/user` returns 403 with `reason: "missing_required_role"` when the token lacks this role (bff-c: `admin`) |
| `APP_FORBIDDEN_ROLE` | `bff/src/main/java/demo/UserController.java` | If set, `/api/user` returns 403 with `reason: "forbidden_role"` when the token has this role (bff-b, bff-c: `client`); checked before the required-role check |
| `CORS_ORIGIN` | `bff/src/main/resources/application.yml` | Single allowed origin (the paired frontend) |
| `GRADLE_USER_HOME`, `--project-cache-dir` | `bff` commands | Each BFF gets its own Gradle cache dir so the three containers don't contend for `./bff/.gradle` locks |
| `KEYCLOAK_AUTH_SERVER_URL` | BFF | Internal URL to Keycloak for JWKS lookup |

## Implementation notes

- **Provider build is inside the image.** `Dockerfile.keycloak` uses a multi-stage build: stage 1 runs `gradle jar` on `keycloak-provider/`, stage 2 copies the jar into `/opt/keycloak/providers/` and runs `kc.sh build` so the SPI is registered at image-build time.
- **Role claim flattening.** Each client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` protocol mapper that exposes realm roles as a top-level `roles` claim (in addition to `realm_access.roles`). The BFFs are configured with `micronaut.security.token.roles-name: roles` to read it.
- **Client library version matters.** `keycloak-js` must be ≥ 26.x to work with Keycloak 26 — older versions (23.x) validate `nonce` on access/refresh tokens, which KC 26 no longer emits.
- **Isolated node_modules per container.** Each `web-*` service mounts `./frontend` as source but uses an anonymous volume for `/app/node_modules`, so the three `npm install` invocations don't race on the bind-mounted directory.
- **Isolated Gradle caches per BFF.** Each `bff-*` service sets a distinct `GRADLE_USER_HOME` (in `/tmp/`) and passes `--project-cache-dir /tmp/gradle-proj-X`. This avoids lock contention on the shared `./bff/.gradle/` bind mount at the cost of one Gradle resolve per container on first start.
- **Realm re-import semantics.** Keycloak's `--import-realm` uses `IGNORE_EXISTING` by default, so the realm JSON only seeds an empty DB. To pick up JSON edits on a running stack, either `podman compose down -v && up` (destroys all data) or apply the change to the running realm via the admin API.

## Tear Down

```bash
podman compose down -v
```
