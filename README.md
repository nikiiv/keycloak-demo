# Keycloak SSO Demo

One Vite+TypeScript SPA and one Micronaut BFF codebase, launched three times as **App A**, **App B**, and **App C**. Each is a separate OIDC client; together they demonstrate single sign-on, per-app authorization, **and email-based 2FA**:

- **App A** — open to everyone (roles `client`, `user`, `admin`).
- **App B** — closed to clients (roles `user`, `admin`).
- **App C** — admins only (role `admin`).

Login is by **email + password + a 6-digit code emailed via Resend** (valid 10 minutes). End-user identities come exclusively from a custom Keycloak User Storage SPI (`keycloak-provider/`); Keycloak's Postgres only holds realm metadata and sessions.

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

Each compose service passes its own `VITE_KEYCLOAK_CLIENT_ID` (`app1-client` / `app2-client` / `app3-client`) and `APP_SOURCE` (`bff-a` / `bff-b` / `bff-c`) so the same source tree behaves as three independent OIDC clients. App-level role gating is configured on the BFF only, via a single `APP_ALLOWED_ROLES` env var (comma-separated). App B uses `APP_ALLOWED_ROLES=user,admin`; App C uses `APP_ALLOWED_ROLES=admin`; App A has no gate. The frontend learns the rule from the BFF's `/api/user` response, so there is no matching `VITE_*` role var — the BFF is the single source of truth.

## Access matrix

| User → | App A (open) | App B (`user,admin`) | App C (`admin`) |
|---|---|---|---|
| `democlient` (role: `client`) | ✓ 200 | ✗ 403 — not allowed | ✗ 403 — not allowed |
| `demouser` (role: `user`) | ✓ 200 | ✓ 200 | ✗ 403 — not allowed |
| `demoadmin` (roles: `admin`, `user`) | ✓ 200 | ✓ 200 | ✓ 200 |

Enforcement happens in the BFF (`/api/user` returns a structured 403 with `reason: "not_allowed"` and `{allowedRoles, yourRoles, message}`). The frontend mirrors the state — red banner + greyed Work nav — by reading the BFF's response, so there's only ever one rule in one place.

## Services

| Service | Host port | Role |
|---------|-----------|------|
| PostgreSQL | 5432 | Keycloak internal metadata (realm config, sessions) — **not** end users |
| Keycloak | 8888 | Auth server with demo-realm (container port 8080) |
| web-a | 5173 | Vite dev server, OIDC client `app1-client`, no role gate |
| web-b | 5174 | Vite dev server, OIDC client `app2-client`, blocks `client` role |
| web-c | 5175 | Vite dev server, OIDC client `app3-client`, requires `admin`, blocks `client` |
| bff-a | 8081 | Micronaut backend for web-a |
| bff-b | 8082 | Micronaut backend for web-b (enforces `APP_ALLOWED_ROLES=user,admin`) |
| bff-c | 8083 | Micronaut backend for web-c (enforces `APP_ALLOWED_ROLES=admin`) |

## Quick Start

```bash
./start.sh
```

`start.sh` is a thin wrapper that sources `.envrc`, takes any running stack down (volumes preserved), rebuilds both custom images (`keycloak-demo-keycloak` + `keycloak-demo-bff`), and brings everything back up. Equivalent to:

```bash
source .envrc                # DOCKER_HOST + RESEND_API_TOKEN
podman compose down
podman compose build
podman compose up -d
```

Wait for all services to start (Keycloak takes ~30 seconds; the BFF image build takes ~1–2 minutes on first run, then layer-caches). The custom Keycloak SPI in `keycloak-provider/` is compiled during the Keycloak image build; the Micronaut BFF is compiled into a shadow jar during the BFF image build — no pre-built jars required.

### Running with Podman on macOS

`docker compose` (the CLI that Podman delegates to) talks to a Docker-style socket, so you need to point `DOCKER_HOST` at the Podman machine socket before running `podman compose`:

```bash
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

Copy `.envrc.example` to `.envrc` (it's gitignored, because it also holds the Resend API token — see the 2FA section below). If you use [direnv](https://direnv.net/), run `direnv allow` once and it will be set automatically whenever you `cd` into the project. Otherwise `source .envrc` in each shell.

## Test SSO + AuthZ

1. Open http://localhost:5173 (App A).
2. Click "Login" — you'll be redirected to Keycloak.
3. Enter one of the user emails from the table below and password `123`.
4. Keycloak sends a 6-digit code to that email via Resend and shows an OTP form. Enter the code to complete login. (If delivery doesn't land — see the Resend caveat below — the code is also printed to the Keycloak log: `podman compose logs keycloak | grep "Email OTP"`.)
5. Visit the **Profile** tab to see the username, email, name, and realm roles from the JWT.
6. Visit the **Protected** tab to see the BFF's view of the same user (fetched via `/api/user`). The `source` field shows which BFF responded (`bff-a`), and the panel color reflects the role.
7. Open http://localhost:5174 (App B) in a new tab — SSO logs you in automatically (**no second OTP**: the Keycloak session cookie satisfies the first-factor step, and the OTP authenticator only runs during an interactive login). As `demouser` / `demoadmin` you'll see the Protected page; as `democlient` a dark "not a client area" banner appears on every page and the BFF returns 403.
8. Open http://localhost:5175 (App C). As `demoadmin` you get the Protected page (red panel). As `demouser` or `democlient` you get a single red banner on every page — it reads back the `allowedRoles` the BFF told it about and the roles you actually hold.

## Visual states

**Protected panel color** encodes the user's role across all apps:

| State | Color | Meaning |
|---|---|---|
| Not authenticated | Yellow | No Keycloak session |
| Authenticated without `admin` | Blue | `democlient` or `demouser` |
| Authenticated with `admin` | Red | `demoadmin` |

**Banner** appears on every page when the BFF returns 403:

| Condition | Banner |
|---|---|
| Authenticated user doesn't hold any of the app's `allowedRoles` | ⛔ **red** banner listing the allowed role(s) and the roles the user holds (text is whatever the BFF put in `message`) |

The banner content is rendered from the BFF's 403 body (`message`, `allowedRoles`, `yourRoles`) — there's no role-matching logic on the frontend.

## Endpoints

### Frontends
- App A: http://localhost:5173 (open to all roles)
- App B: http://localhost:5174 (no clients)
- App C: http://localhost:5175 (admin only)

Frontends proxy `/api/*` to their BFF via Vite's dev-server proxy, so browser calls are same-origin (no CORS).

### BFF APIs (also reachable directly on the host for testing with curl)
- bff-a: http://localhost:8081/api/user, /api/secure, /api/public
- bff-b: http://localhost:8082/api/user (200 if token roles intersect `[user, admin]`, else 403 with `reason: "not_allowed"`)
- bff-c: http://localhost:8083/api/user (200 only for `admin`, else 403 with `reason: "not_allowed"`)

Both 200 and 403 bodies include `allowedRoles` so the frontend can render the rule without duplicating it.

### Keycloak Admin
- URL: http://localhost:8888
- Credentials: `admin` / `admin`

## Demo Users (from the custom SPI)

Users are hardcoded in `keycloak-provider/src/main/java/com/example/keycloak/DemoUserStorageProvider.java`, **not** in Keycloak's Postgres tables. The realm has `loginWithEmailAllowed: true`, so the login form accepts either the username or the email.

| Username | Email | Password | SPI-assigned roles |
|----------|-------|----------|--------------------|
| `democlient` | `nikiiv.linococo@gmail.com` | `123` | `client` |
| `demouser` | `nikolay.ivanchev@gmail.com` | `123` | `user` |
| `demoadmin` | `nikolai.ivanchev@gmail.com` | `123` | `admin`, `user` |

Keycloak's built-in composite `default-roles-demo-realm` adds `offline_access` and `uma_authorization` on top of the SPI roles; it no longer includes `user`, so `democlient` really does get only `client`.

## Email-based 2FA

After username-or-email + password, the `demo-browser` flow runs a custom **Email OTP** authenticator (`keycloak-provider/src/main/java/com/example/keycloak/EmailOtpAuthenticator.java`) that:

1. Generates a cryptographically random 6-digit code.
2. Stores the code and an `expires` timestamp (10 minutes ahead) as auth-session notes.
3. **Logs the code** at INFO (always — this is the fallback viewing mechanism when Resend sandbox delivery doesn't land).
4. Sends an HTML email via the Resend HTTP API (`ResendClient.java`).
5. Renders `email-otp.ftl` (packaged as a `theme-resources/templates/` entry in the provider jar) asking for the code.
6. On submit: if the code matches and hasn't expired, the flow succeeds. If expired or empty, a new code is minted in-place and the form re-renders. If the code is wrong, the form redisplays with an "Invalid code" error.

**Session vs. code validity.** The 10 minutes only apply to the OTP itself during login. Once the session exists, the realm's normal token/session lifespans apply (no forced 10-minute logout). If a user's session expires naturally and they log in again, they'll be challenged for a fresh OTP.

### Resend configuration

The Resend API token is read from `RESEND_API_TOKEN`. `.envrc` is gitignored; copy `.envrc.example` to `.envrc` and fill in your token:

```bash
export RESEND_API_TOKEN="re_..."
```

`docker-compose.yml` forwards this env var into the `keycloak` container. To rotate: update `.envrc`, then `podman compose up -d --force-recreate keycloak` — no image rebuild needed (the token is read from `System.getenv()` at request time, not baked in). If `RESEND_API_TOKEN` is unset, the authenticator logs a warning and the OTP only appears in the Keycloak logs (still usable for the demo; no email delivery).

The from-address defaults to `"Demo Realm <onboarding@resend.dev>"` via `RESEND_FROM` in the compose file.

### ⚠ Resend sandbox caveat

`onboarding@resend.dev` only delivers to the email address registered with the Resend account. Resend returns `202 Accepted` for the other addresses but silently drops them. This means **at most one of the three demo users will actually receive emails** (whichever address owns the Resend account).

Mitigation: every OTP is also written to the Keycloak INFO log (`Email OTP for <email>: NNNNNN (valid 10min)`), so the demo works regardless of inbox delivery:

```bash
podman compose logs keycloak | grep "Email OTP"
```

Permanent fix: verify a domain at Resend and set `RESEND_FROM` in `docker-compose.yml` to an address in that domain.

### Authentication flow wiring

`keycloak/realm-export.json` defines a custom top-level browser flow:

```
demo-browser  (top-level)
├── Cookie                         ALTERNATIVE   ← skip-if-session-present
├── Identity Provider Redirector   ALTERNATIVE
└── demo-browser forms             ALTERNATIVE   (subflow)
    ├── Username Password Form     REQUIRED       (first factor; uses email or username)
    └── Demo Email OTP             REQUIRED       (second factor; providerId "demo-email-otp")
```

Realm-level `"browserFlow": "demo-browser"` makes this the flow for interactive logins. Direct-grant (`grant_type=password`) uses Keycloak's stock flow and **bypasses OTP** — handy for `curl` tests, but not a real login.

## The Keycloak User Storage Provider (`keycloak-provider/`)

This module is a standalone Gradle project that implements Keycloak's **User Storage SPI** — a federation plugin that lets Keycloak pull users from an external source (here: a hardcoded `Map`, but in real deployments typically LDAP/AD, a legacy DB, or a bespoke HTTP service). The users never land in Keycloak's Postgres; the SPI is consulted live on every lookup / login. The same module also ships the **Email OTP Authenticator** (see the 2FA section above); both SPIs are packaged into a single jar.

### Files

```
keycloak-provider/
├── build.gradle.kts                              # compileOnly deps on keycloak SPI jars + jakarta.ws.rs-api
├── settings.gradle.kts
└── src/main/
    ├── java/com/example/keycloak/
    │   ├── DemoUserStorageProviderFactory.java   # user-storage factory — PROVIDER_ID "demo-user-provider"
    │   ├── DemoUserStorageProvider.java          # implements UserLookupProvider + CredentialInputValidator
    │   ├── DemoUser.java                         # per-user adapter, extends AbstractUserAdapter
    │   ├── EmailOtpAuthenticatorFactory.java     # OTP authenticator factory — PROVIDER_ID "demo-email-otp"
    │   ├── EmailOtpAuthenticator.java            # generate code, send via Resend, validate
    │   └── ResendClient.java                     # thin HTTP wrapper over api.resend.com
    └── resources/
        ├── META-INF/services/
        │   ├── org.keycloak.storage.UserStorageProviderFactory   # registers the user-storage factory
        │   └── org.keycloak.authentication.AuthenticatorFactory  # registers the OTP factory
        └── theme-resources/templates/
            └── email-otp.ftl                     # OTP entry page (inherits base login theme)
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
| `BFF_URL` | `frontend/vite.config.ts` | Proxy target for `/api/*` from this frontend |
| `MICRONAUT_APPLICATION_NAME` | Micronaut | Service name in logs |
| `APP_SOURCE` | `bff/src/main/java/demo/UserController.java` | Value of the `source` field in BFF responses |
| `APP_ALLOWED_ROLES` | `bff/src/main/java/demo/UserController.java` | Comma-separated. If empty, `/api/user` is open to any authenticated user; otherwise the token must hold at least one listed role or the BFF returns 403 with `reason: "not_allowed"`. Both 200 and 403 bodies include `allowedRoles` so the frontend mirrors the rule without its own role env var (bff-b: `user,admin`; bff-c: `admin`). |
| `CORS_ORIGIN` | `bff/src/main/resources/application.yml` | Single allowed origin (the paired frontend) |
| `KEYCLOAK_AUTH_SERVER_URL` | BFF | Internal URL to Keycloak for JWKS lookup |

## Implementation notes

- **Provider build is inside the image.** `Dockerfile.keycloak` uses a multi-stage build: stage 1 runs `gradle jar` on `keycloak-provider/`, stage 2 copies the jar into `/opt/keycloak/providers/` and runs `kc.sh build` so the SPI is registered at image-build time.
- **Role claim flattening.** Each client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` protocol mapper that exposes realm roles as a top-level `roles` claim (in addition to `realm_access.roles`). The BFFs are configured with `micronaut.security.token.roles-name: roles` to read it.
- **Client library version matters.** `keycloak-js` must be ≥ 26.x to work with Keycloak 26 — older versions (23.x) validate `nonce` on access/refresh tokens, which KC 26 no longer emits.
- **Isolated node_modules per container.** Each `web-*` service mounts `./frontend` as source but uses an anonymous volume for `/app/node_modules`, so the three `npm install` invocations don't race on the bind-mounted directory.
- **Compile once, run three times.** The BFF is built into a single fat-jar image (`bff/Dockerfile`, shadow plugin → `eclipse-temurin:17-jre`) tagged `keycloak-demo-bff:latest`. All three `bff-*` services share that image and differ only in port + env vars — no bind mount, no per-container Gradle cache, no compile on every `up`. Source edits need `podman compose up -d --build --force-recreate bff-a bff-b bff-c` (one command: rebuilds the image, then recreates all three containers onto the new image ID).
- **Realm re-import semantics.** Keycloak's `--import-realm` uses `IGNORE_EXISTING` by default, so the realm JSON only seeds an empty DB. To pick up JSON edits on a running stack, either `podman compose down -v && up` (destroys all data) or apply the change to the running realm via the admin API.
- **Two SPIs, one jar.** `keycloak-provider/` ships both the user-storage provider and the email-OTP authenticator. Two service files under `META-INF/services/` register them. The build picks up both automatically via `gradle jar`.
- **2FA only runs in the browser flow.** The realm's `direct grant` flow is untouched, so `grant_type=password` against `/realms/demo-realm/protocol/openid-connect/token` returns a token without OTP — useful for scripting but not equivalent to an interactive login.

## Tear Down

```bash
podman compose down -v
```
