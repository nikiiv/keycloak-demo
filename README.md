# Keycloak SSO Demo

One Vite+TypeScript SPA and one Micronaut BFF codebase, launched three times as **App A**, **App B**, and **App C**. Each is a separate OIDC client; together they demonstrate single sign-on, per-app authorization, **and email-based 2FA**:

- **App A** — open to everyone (roles `client`, `user`, `admin`).
- **App B** — closed to clients (roles `user`, `admin`).
- **App C** — admins only (role `admin`).

Login is by **email + password + a 6-digit code emailed via Resend** (valid 10 minutes). End-user identities live in a **standalone Micronaut REST service** (`user-service/`); the Keycloak User Storage SPI (`keycloak-provider/`) is a thin client of it. The REST contract is defined **OpenAPI-first** in `user-api/openapi.yaml` and the client/server code on both sides is generated from that one file. Keycloak's Postgres only holds realm metadata and sessions.

## Architecture

```
┌──────────────────────────────────────────┐     ┌────────────────────────┐
│  frontend/  (one codebase)               │     │       Keycloak         │
│    └── run as web-a  (:5173) — open      │     │  ┌──────────────────┐  │
│    └── run as web-b  (:5174) — no clients│     │  │ User Storage SPI │  │
│    └── run as web-c  (:5175) — admin only│     │  │  + Email-OTP SPI │  │
│                                          │     │  └────────┬─────────┘  │
│  bff/  (one codebase)                    │     └──────┬────┼────────────┘
│    └── run as bff-a  (:8081)             │            │    │ REST
│    └── run as bff-b  (:8082)             │            │    │ (generated from
│    └── run as bff-c  (:8083)             │            │    │  user-api/openapi.yaml)
└───────────────┬──────────────────────────┘            │    ▼
                │                                       │  ┌──────────────────────┐
                │                                       │  │  user-service        │
                │                                       │  │  (Micronaut, :8090)  │
                │                                       │  │  hardcoded users +   │
                │                                       │  │  password verify     │
                │                                       │  └──────────────────────┘
                │                                       ▼
                │                                 ┌─────────────┐
                └──────── (JWT via OIDC) ───────▶ │ PostgreSQL  │
                                                  │ (realm /    │
                                                  │  session    │
                                                  │  metadata)  │
                                                  └─────────────┘
```

The User Storage SPI runs in Keycloak's JVM but holds no user data — it calls `user-service` over HTTP for every lookup and credential check. The Email-OTP authenticator also stays in the JVM; when it needs a user's email it goes through the same SPI → REST path. The contract in `user-api/openapi.yaml` is the single source of truth: the SPI's HTTP client and the `user-service` server stubs are both code-generated from it.

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
| user-service | 8090 | Standalone Micronaut store of the demo users; the Keycloak SPI's REST backend (container port 8080) |
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

`start.sh` is a thin wrapper that sources `.envrc`, takes any running stack down (volumes preserved), rebuilds the custom images (`keycloak-demo-keycloak` + `keycloak-demo-bff` + `keycloak-demo-user-service`), and brings everything back up. Equivalent to:

```bash
source .envrc                # DOCKER_HOST + RESEND_API_TOKEN
podman compose down
podman compose build
podman compose up -d
```

Wait for all services to start (Keycloak takes ~30 seconds; image builds take ~1–2 minutes on first run, then layer-cache). All three custom images compile from source at build time — no pre-built jars required: the Keycloak SPI (`keycloak-provider/`, including its generated REST client) during the Keycloak image build, the Micronaut BFF into a shadow jar during the BFF image build, and `user-service` (including its generated server stubs) into a fat jar during the user-service image build. The two generated halves both come from `user-api/openapi.yaml`.

### Running with Podman on macOS

`docker compose` (the CLI that Podman delegates to) talks to a Docker-style socket, so you need to point `DOCKER_HOST` at the Podman machine socket before running `podman compose`:

```bash
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

Copy `.envrc.example` to `.envrc` (it's gitignored, because it also holds the Resend API token — see the 2FA section below). If you use [direnv](https://direnv.net/), run `direnv allow` once and it will be set automatically whenever you `cd` into the project. Otherwise `source .envrc` in each shell.

### Per-app HTTPS domains (first-time setup)

The three apps are served behind nginx at HTTPS hostnames
(`https://domain1.app1.int`, `https://domain2.app2.int`, `https://domain3.app3.int`)
in addition to the legacy `http://localhost:517X` URLs. HTTPS is required because
the browser gates Web Crypto (which `keycloak-js` needs for PKCE) to secure
contexts — full bug story in
[`web-crypto-https-fix.md`](./web-crypto-https-fix.md); architecture in
[`nginx-domains-report.md`](./nginx-domains-report.md).

One-time setup on each dev machine:

```bash
# 1. Install mkcert (and nss if you use Firefox).
brew install mkcert
brew install nss   # only for Firefox

# 2. Install the local CA into the system trust store.
mkcert -install

# 3. Generate a cert covering the three demo hostnames (gitignored).
mkdir -p proxy/certs
mkcert -cert-file proxy/certs/cert.pem \
       -key-file  proxy/certs/key.pem \
       domain1.app1.int domain2.app2.int domain3.app3.int

# 4. Add /etc/hosts entries (compose can't do this for you).
echo "127.0.0.1 domain1.app1.int domain2.app2.int domain3.app3.int" | sudo tee -a /etc/hosts

# 5. Start the stack.
./start.sh
```

Then open `https://domain1.app1.int` (App A), `https://domain2.app2.int` (App B)
or `https://domain3.app3.int` (App C) in the browser — Chrome / Safari / Edge
trust the mkcert CA automatically; Firefox does too if `nss` is installed.

**Restart on an existing postgres volume.** `--import-realm` is
`IGNORE_EXISTING`, so an already-seeded realm keeps the URI set it had when it
was first seeded. If your Keycloak DB predates these HTTPS URIs, either wipe
and re-import:

```bash
docker compose down -v && ./start.sh
```

…or patch the running realm via the admin API (preserves sessions; pattern in
`nginx-domains-report.md` §"Live-realm patch via admin API").

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows "Your connection is not private" | mkcert CA not in system trust store | `mkcert -install` |
| Same on Firefox while Chrome works | Firefox has its own NSS store | `brew install nss && mkcert -install` |
| Vite: `Blocked request. This host is not allowed.` | hostname missing from `allowedHosts` | already covered in `frontend/vite.config.ts`; verify it lists the `.int` names |
| Login fails with `invalid redirect_uri` | running realm predates the HTTPS URIs | wipe-and-reimport, or admin-API patch |
| `Web Crypto API is not available` | browser still on plain HTTP | confirm the URL is `https://` and the proxy container is up on `:443` |

## Test SSO + AuthZ

1. Open `https://domain1.app1.int` (App A; or the legacy `http://localhost:5173`).
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

### user-service (host-exposed for inspection; Keycloak reaches it in-network as `http://user-service:8080`)
- `GET  http://localhost:8090/users/{username}` → `200` user JSON (no password field) or `404`
- `GET  http://localhost:8090/users?email={email}` → `200` user JSON or `404`
- `POST http://localhost:8090/users/verify-credentials` `{"username","password"}` → `200 {"valid":true|false}` (always 200; transport failure is the caller's concern)
- `GET  http://localhost:8090/health` → `200 {"status":"UP"}`

These are exactly the operations declared in `user-api/openapi.yaml`. Password only ever travels in the `verify-credentials` request body and never appears in a response.

### Keycloak Admin
- URL: http://localhost:8888
- Credentials: `admin` / `admin`

## Demo Users (served by user-service)

Users are hardcoded in `user-service/src/main/java/demo/userservice/UserController.java`, **not** in Keycloak's Postgres tables and **no longer** in the Keycloak provider — the SPI fetches them from `user-service` over REST. The realm has `loginWithEmailAllowed: true`, so the login form accepts either the username or the email.

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

**Session vs. code validity.** The 10 minutes only apply to the OTP itself during login. Once the session exists, the realm's normal token/session lifespans apply (no forced 10-minute logout).

**Persisting the OTP decision — the trust cookie.** Re-prompting for an email code on every fresh login is annoying in practice. After a successful OTP verification, the authenticator drops a signed cookie (`KC_DEMO_OTP_TRUSTED`, HttpOnly, realm-scoped, SameSite=Lax) carrying the user id, an expiry timestamp, and an HMAC-SHA256 over both. On the next login, if the cookie is present, unexpired, and matches the current user, the email-OTP step is skipped via `context.success()` — no code is generated and no email is sent. The window is configurable:

```yaml
# docker-compose.yml → keycloak.environment
OTP_TRUST_WINDOW_MINUTES: "60"   # default; set to 0 to always require OTP
```

The HMAC key is generated once per Keycloak process (in-memory only), so restarting Keycloak invalidates every outstanding trust cookie. That's fine for a demo; a real deployment would source the key from a stable secret store. Log lines to watch for: `Issued OTP trust cookie for <user>, valid N minute(s)` (after a successful submit) and `OTP trust cookie valid for <user>; skipping email step` (on subsequent logins).

### Resend configuration

The Resend API token is read from `RESEND_API_TOKEN`. `.envrc` is gitignored; copy `.envrc.example` to `.envrc` and fill in your token:

```bash
export RESEND_API_TOKEN="re_..."
```

`docker-compose.yml` forwards this env var into the `keycloak` container. To rotate: update `.envrc`, then `podman compose up -d --force-recreate keycloak` — no image rebuild needed (the token is read from `System.getenv()` at request time, not baked in). If `RESEND_API_TOKEN` is unset or empty, `ResendClient.send()` short-circuits with a calm INFO log (`RESEND_API_TOKEN not set; skipping email delivery…`) — no exception, no stack trace, and the login flow continues normally; the OTP code is still visible in the banner printed above. This is the intended fallback for running the demo without a Resend account.

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

## Contract-first user-service

The user store is a standalone Micronaut service (`user-service/`) and the REST contract between it and Keycloak is **defined before any code**, in one file: `user-api/openapi.yaml`. Nothing about that wire format is written by hand on either side — both halves are generated from the spec at build time.

### The contract (`user-api/openapi.yaml`)

Three operations, tagged `Users`, with explicit `operationId`s so the generated method names are stable on both sides:

| Operation | `operationId` | Result |
|---|---|---|
| `GET /users/{username}` | `getUserByUsername` | `200` `User` / `404` (also serves the SPI's `getUserById`, since external id == username here) |
| `GET /users?email=…` | `getUserByEmail` | `200` `User` / `404` |
| `POST /users/verify-credentials` | `verifyCredentials` | **always `200`** `{ "valid": bool }` |

`User` is `{ username, email, firstName, lastName, roles[] }` — **no password**. The password only ever appears in the `verify-credentials` request body. `verify-credentials` returns `200` even for a wrong password so the caller can tell "reachable, wrong password" (`valid:false`) apart from a transport failure (which `UserServiceClient` treats as fail-closed).

### Code generation (one spec, two generators)

| Side | Module | openapi-generator | Output |
|---|---|---|---|
| Server | `user-service/` | `java-micronaut-server` (`reactive=false`, `useAuth=false`, abstract controller) | `AbstractUsersController` + models. `UserController` extends the abstract class and supplies the logic + the hardcoded `USERS` map. |
| Client | `keycloak-provider/` | `java`, `library=native` (JDK `java.net.http`) | `UsersApi` + `ApiClient` + models. `UserServiceClient` wraps it. |

Both `openApiGenerate` tasks read `$rootDir/../user-api/openapi.yaml` and run before `compileJava`; the generated sources land under each module's `build/` (git-ignored, regenerated every build). `user-service/openapi-generator-ignore` drops the generator's sample controller stub so only our `UserController` is compiled. The `native` client library was chosen deliberately: the SPI runs inside Keycloak's JVM with no Micronaut context, so it needs a plain-Java HTTP client (`java.net.http`, JDK-only) — not a Micronaut/Netty one.

### Packaging & runtime

`user-service` is built once into a fat-jar image (`user-service/Dockerfile`, `com.gradleup.shadow` → `eclipse-temurin:17-jre`) tagged `keycloak-demo-user-service:latest`, the same approach as `bff/`. Its build context is the **repo root** so the build can read the shared `user-api/openapi.yaml`. In the compose network Keycloak reaches it as `http://user-service:8080`; host port `8090` is exposed only for inspection. The `keycloak` service `depends_on` it being `service_healthy`, and the health check matches Micronaut's `200 Ok` status line (note: not `200 OK`).

**Failure modes are explicit.** `user-service` down → lookups return `null` (login fails cleanly) and `verify-credentials` is treated as `false` (fail closed — never authenticate when the store is unreachable). This is verified end-to-end: stopping `user-service` makes a `demouser` token request return `invalid_grant` rather than a token.

## The Keycloak User Storage Provider (`keycloak-provider/`)

This module is a standalone Gradle project that implements Keycloak's **User Storage SPI** — a federation plugin that lets Keycloak pull users from an external source. Here that source is a **bespoke HTTP service** (`user-service/`): the provider holds no user data and makes a REST call for every lookup / credential check. The users never land in Keycloak's Postgres; the SPI is consulted live on every lookup / login. The same module also ships the **Email OTP Authenticator** (see the 2FA section above); both SPIs are packaged into a single jar.

> The HTTP client the provider uses is **not hand-written** — it is generated from `user-api/openapi.yaml` (see [Contract-first user-service](#contract-first-user-service)). The provider code only wraps it.

### Files

```
keycloak-provider/
├── build.gradle.kts                              # keycloak SPI + jakarta.ws.rs compileOnly; openapi-generator
│                                                 #   (java/native client) + shadow (relocates Jackson)
├── settings.gradle.kts
└── src/main/
    ├── java/com/example/keycloak/
    │   ├── DemoUserStorageProviderFactory.java   # user-storage factory — resolves USER_SERVICE_URL, builds client
    │   ├── DemoUserStorageProvider.java          # UserLookupProvider + CredentialInputValidator — delegates to REST
    │   ├── UserServiceClient.java                # wraps the generated client: 404→null, fail-closed verify
    │   ├── DemoUser.java                         # per-user adapter, extends AbstractUserAdapter
    │   ├── EmailOtpAuthenticatorFactory.java     # OTP authenticator factory — PROVIDER_ID "demo-email-otp"
    │   ├── EmailOtpAuthenticator.java            # generate code, send via Resend, validate
    │   └── ResendClient.java                     # thin HTTP wrapper over api.resend.com
    │   # com.example.keycloak.client.* (api/model/invoker) is GENERATED into
    │   # build/ from user-api/openapi.yaml — not committed
    └── resources/
        ├── META-INF/services/
        │   ├── org.keycloak.storage.UserStorageProviderFactory   # registers the user-storage factory
        │   └── org.keycloak.authentication.AuthenticatorFactory  # registers the OTP factory
        └── theme-resources/templates/
            └── email-otp.ftl                     # OTP entry page (inherits base login theme)
```

### How the classes fit together

1. **Factory** (`DemoUserStorageProviderFactory`). Keycloak discovers it via the `META-INF/services/` file (standard Java `ServiceLoader` mechanism). Its `getId()` returns `"demo-user-provider"` — this is the string the realm import file references to attach the provider to the realm. Its `create()` resolves the user-service base URL (precedence: realm component config `userServiceUrl` → env `USER_SERVICE_URL` → default `http://user-service:8080`), builds a `UserServiceClient`, and hands back a provider instance per request scope.
2. **Provider** (`DemoUserStorageProvider`). Implements two capability interfaces, both delegating to the REST client:
   - `UserLookupProvider` — `getUserByUsername`, `getUserById`, `getUserByEmail`. Keycloak calls these during login and token issuance; the provider calls the matching REST operation.
   - `CredentialInputValidator` — `supportsCredentialType`, `isConfiguredFor`, `isValid`. `isValid` POSTs to `/users/verify-credentials`; it never sees a stored password.
3. **REST client wrapper** (`UserServiceClient`). Wraps the generated `UsersApi`/`ApiClient`. Translates the API into the small surface the SPI needs and owns the availability policy: a `404` (or any error) on a lookup → `null` ("no such user"); **any** error or non-200 on verify → `false` (**fail closed** — a user-service that is down can never authenticate anyone). Maps the generated `User` model into the `DemoUserRecord` the adapter expects.
4. **User adapter** (`DemoUser`). A thin wrapper around the `DemoUserRecord` (username / email / roles; password is never carried in a lookup), backed by Keycloak's `AbstractUserAdapter`. The key override is `getRoleMappingsInternal()`, which auto-creates any realm role named in the record if it doesn't already exist — this is what lets a fresh realm accept `client`, `user`, and `admin` even though only `user` / `admin` / `client` are pre-declared in `realm-export.json`. All the `set*()` / mutation methods are no-ops because the SPI is read-only.

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

On realm import Keycloak looks up a factory with `providerId == "demo-user-provider"` and enables it for the realm. `NO_CACHE` means every lookup hits `user-service` over REST, so a change there is visible on the next request (important for a live demo; real providers usually want some cache policy). Optionally add `"userServiceUrl": ["http://host:port"]` to that `config` block to point the SPI at a different user-service from the admin console; otherwise the `USER_SERVICE_URL` env var (set on the `keycloak` compose service) wins.

### Build and runtime wiring

`Dockerfile.keycloak` runs a multi-stage build:

```
FROM gradle:8.5-jdk17 AS provider-build
WORKDIR /build/keycloak-provider                       # keycloak-provider/ and user-api/ as siblings
COPY keycloak-provider/settings.gradle.kts keycloak-provider/build.gradle.kts ./
COPY user-api /build/user-api                          # the contract — generation reads ../user-api
COPY keycloak-provider/src ./src
RUN gradle --no-daemon shadowJar                       # generates the client, then fat-jars it:
                                                       #   keycloak-demo-provider-1.0.0.jar

FROM quay.io/keycloak/keycloak:26.0.7
COPY --from=provider-build .../keycloak-demo-provider-1.0.0.jar /opt/keycloak/providers/
COPY keycloak/themes /opt/keycloak/themes
RUN /opt/keycloak/bin/kc.sh build                      # bakes the provider into the server image
```

Build context is the repo root, so `user-api/openapi.yaml` is reachable; the build lays `keycloak-provider/` and `user-api/` out as siblings so the same `$rootDir/../user-api` path resolves identically on the host and in Docker. `shadowJar` (a) runs `openApiGenerate` to produce the `java`/`native` HTTP client, then (b) bundles it plus Jackson into the one provider jar, **relocating** `com.fasterxml.jackson` → `com.example.keycloak.shaded.jackson` so it cannot clash with the Jackson Keycloak already ships on the provider classpath. `mergeServiceFiles()` keeps both `META-INF/services` registrations intact. The SPI is part of the `keycloak-demo-keycloak` image and available the moment Keycloak starts — no hot-deploy, no manual admin UI registration. Changes to the provider source (or to `user-api/openapi.yaml`) require `podman compose build keycloak` and a container recreate to take effect.

### Adding a user

The hardcoded map now lives in **`user-service`**, not the provider. Edit `USERS` in `user-service/src/main/java/demo/userservice/UserController.java`:

```java
private static final Map<String, DemoUserRecord> USERS = Map.of(
    "demoadmin",  new DemoUserRecord("demoadmin",  "123", "...", "Demo", "Admin",  List.of("admin", "user")),
    "demouser",   new DemoUserRecord("demouser",   "123", "...", "Demo", "User",   List.of("user")),
    "democlient", new DemoUserRecord("democlient", "123", "...", "Demo", "Client", List.of("client")),
    "newguy",     new DemoUserRecord("newguy",     "pw",  "...", "New",  "Guy",    List.of("user", "client"))
);
```

Rebuild only that one image: `podman compose up -d --build --force-recreate user-service` (no Keycloak rebuild needed — the SPI didn't change). Any role name that doesn't exist in the realm is auto-created at first login (see `DemoUser.getRoleMappingsInternal`). Realm roles referenced by BFF role gates should still be declared in `keycloak/realm-export.json` so a fresh-realm install has the same capabilities without waiting for a user to trigger auto-creation.

### Pointing at a real backend

The "thin SPI client → external user service" split that real deployments want is exactly what this demo now is. To back it with something real, change **only `user-service`** (the provider and the contract can stay put):

1. Replace `UserController`'s hardcoded `USERS` map with a real lookup — JDBC, LDAP bind, an upstream identity API, etc. — keeping the responses conformant to `user-api/openapi.yaml`.
2. If the backend stores password hashes, do the hash comparison inside `verifyCredentials` (it already returns just a boolean, so the SPI side needs no change).
3. To extend the contract (search, registration, …), add the operation to `user-api/openapi.yaml`, regenerate both sides, implement the server method, and add the matching SPI capability interface (`UserQueryProvider`, `UserRegistrationProvider`, …) wired through `UserServiceClient`.

The factory's `getId()` and `USER_SERVICE_URL` stay the same, so no realm-export change is required for cases 1–2.

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
| `USER_SERVICE_URL` | `DemoUserStorageProviderFactory` (on the `keycloak` service) | Base URL the SPI calls for user lookups / credential checks. Defaults to `http://user-service:8080`; a realm component `userServiceUrl` config value overrides it. |

## Implementation notes

- **Provider build is inside the image.** `Dockerfile.keycloak` uses a multi-stage build: stage 1 runs `gradle shadowJar` on `keycloak-provider/` (generating the REST client from `user-api/openapi.yaml` first, then fat-jarring it with relocated Jackson), stage 2 copies the jar into `/opt/keycloak/providers/`, adds `keycloak/themes`, and runs `kc.sh build` so the SPI is registered at image-build time.
- **Contract-first, one source of truth.** `user-api/openapi.yaml` is the only hand-written description of the SPI↔user-service wire format; the SPI's client and the user-service's server stubs are both generated from it (see [Contract-first user-service](#contract-first-user-service)). Editing the spec and rebuilding regenerates both sides.
- **Role claim flattening.** Each client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` protocol mapper that exposes realm roles as a top-level `roles` claim (in addition to `realm_access.roles`). The BFFs are configured with `micronaut.security.token.roles-name: roles` to read it.
- **Client library version matters.** `keycloak-js` must be ≥ 26.x to work with Keycloak 26 — older versions (23.x) validate `nonce` on access/refresh tokens, which KC 26 no longer emits.
- **Isolated node_modules per container.** Each `web-*` service mounts `./frontend` as source but uses an anonymous volume for `/app/node_modules`, so the three `npm install` invocations don't race on the bind-mounted directory.
- **Compile once, run three times.** The BFF is built into a single fat-jar image (`bff/Dockerfile`, shadow plugin → `eclipse-temurin:17-jre`) tagged `keycloak-demo-bff:latest`. All three `bff-*` services share that image and differ only in port + env vars — no bind mount, no per-container Gradle cache, no compile on every `up`. Source edits need `podman compose up -d --build --force-recreate bff-a bff-b bff-c` (one command: rebuilds the image, then recreates all three containers onto the new image ID).
- **Realm re-import semantics.** Keycloak's `--import-realm` uses `IGNORE_EXISTING` by default, so the realm JSON only seeds an empty DB. To pick up JSON edits on a running stack, either `podman compose down -v && up` (destroys all data) or apply the change to the running realm via the admin API.
- **Two SPIs, one jar.** `keycloak-provider/` ships both the user-storage provider and the email-OTP authenticator. Two service files under `META-INF/services/` register them; `shadowJar`'s `mergeServiceFiles()` keeps both intact in the fat jar. The email-OTP authenticator stays in the JVM by design — only the *user store* was extracted; when OTP needs an address it calls `getUserByEmail`, which resolves over the same SPI→REST path.
- **2FA only runs in the browser flow.** The realm's `direct grant` flow is untouched, so `grant_type=password` against `/realms/demo-realm/protocol/openid-connect/token` returns a token without OTP — useful for scripting but not equivalent to an interactive login.

## Tear Down

```bash
podman compose down -v
```
