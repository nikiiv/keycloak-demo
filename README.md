# Keycloak SSO Demo (Microfrontend Edition)

A React **microfrontend** shell signs you in once against Keycloak and then lazy-loads three role-gated MFE containers — Client, Ops, Admin — through **Module Federation**. Each MFE ships its own container, pairs with its own BFF container, and has its access enforced server-side. Login is email + password + a 6-digit code emailed via Resend (valid 10 minutes).

End-user identity lives in a **standalone Micronaut REST service** (`user-service/`); the Keycloak User Storage SPI (`keycloak-provider/`) is a thin client of it. The REST contract is **OpenAPI-first** in `user-api/openapi.yaml` and the client/server code on both sides is generated from that one file. Keycloak's Postgres only holds realm metadata and sessions.

- **Client MFE** — open to anyone authenticated (any role).
- **Ops MFE** — `user` or `admin` only; closed to `client`-only users.
- **Admin MFE** — `admin` only.

## Architecture

```
Browser (http://localhost:5173)
│
│   The shell signs in once and renders the chrome (Nav, Layout, RoleGate).
│   It lazy-loads each MFE at runtime by fetching its remoteEntry.js.
│
├──> shell                       :5173    (React + RR + TanStack Query + keycloak-js singleton)
│       ▲
│       │  fetch /assets/remoteEntry.js (CORS, browser → MFE container)
│       │
├──> mfe-client                  :5181    federation remote — exposes ./Mfe
├──> mfe-ops                     :5182    federation remote — exposes ./Mfe
└──> mfe-admin                   :5183    federation remote — exposes ./Mfe

Each MFE makes its own data calls back to the shell origin (so cookies / Bearer
flows are same-origin), the shell's Vite proxy strips the per-MFE prefix and
forwards to that MFE's private BFF container:

shell at :5173 proxies …
  /api/whoami         → bff-client:8080/api/whoami     (shell auth + role lookup)
  /api/client/*       → bff-client:8080/api/*          (mfe-client → its BFF)
  /api/ops/*          → bff-ops:8080/api/*             (mfe-ops    → its BFF)
  /api/admin/*        → bff-admin:8080/api/*           (mfe-admin  → its BFF)

  bff-client          :8081    (no APP_ALLOWED_ROLES — any authenticated)
  bff-ops             :8082    (APP_ALLOWED_ROLES=user,admin)
  bff-admin           :8083    (APP_ALLOWED_ROLES=admin)

Identity & second factor:

  Keycloak            :8888    realm "demo-realm" — single client `mfe-shell-client`
    ├─ User Storage SPI         (keycloak-provider/)
    │     │  HTTP (generated from user-api/openapi.yaml)
    │     ▼
    │  user-service   :8090    (Micronaut, hardcoded USERS map + verify-credentials)
    │
    └─ Email-OTP authenticator  (keycloak-provider/) — 6-digit code via Resend
                                 + signed trust cookie (KC_DEMO_OTP_TRUSTED)

  Postgres            :5432    realm config + sessions (NOT users)
```

The User Storage SPI runs in Keycloak's JVM but holds no user data — it calls `user-service` over HTTP for every lookup and credential check. The Email-OTP authenticator also stays in the JVM; when it needs a user's email it goes through the same SPI → REST path. The contract in `user-api/openapi.yaml` is the single source of truth.

**Shell vs MFE responsibility split.** The shell is an *orchestrator* and owns only what every MFE has to share: the React Provider stack (`AuthProvider` with the singleton keycloak-js, `QueryClientProvider`, `BrowserRouter`), the chrome (`Nav` + `Layout`), the role-gating (`RoleGate` → consults `/api/whoami`), the federation host config, the shared `styles.css`, and the shell-api type contract. Every page (`Welcome`, `Profile`, `Protected`, the MFE-specific work UIs) lives inside its MFE workspace.

## Login: then vs now

> **Full walkthrough**: [LOGIN.md](./LOGIN.md) is the dedicated step-by-step trace of the entire login + logout flow, plus a production-security audit (must-fix / should-add / nice-to-have). For a focused look at what each leak type (password, access token, refresh token, SSO cookie, OTP trust cookie, hostile user-service) does to a BFF call, see [compromised-credentials-analysis.md](./compromised-credentials-analysis.md). This section is the short comparison.

The vanilla-TS era ran the same SPA source three times under three OIDC clients, with SSO held together by Keycloak's realm-wide session cookie. The MFE era folds the three apps into one shell and lets the MFEs join it as runtime modules. The login mechanics changed everywhere:

| Concern | Vanilla TS era (`web-a/b/c`) | Current MFE era |
|---|---|---|
| **OIDC clients** | `app1-client` (:5173), `app2-client` (:5174), `app3-client` (:5175) — one per origin | `mfe-shell-client` only. The old three remain in `realm-export.json` but `enabled:false` so rollback stays cheap. |
| **`keycloak-js` instances per browser** | One **per open tab**. Each tab loaded `frontend/src/Keycloak.ts` and called `keycloak.init()` against its own client. | **One per page load.** The single page at `:5173` instantiates `apps/shell/src/auth/keycloak.ts` once. MFEs never see `keycloak-js` — they import it nowhere. |
| **`keycloak.init()` re-entrancy** | Each `web-*` SPA bootstrap was its own JS context, so init happened naturally once. | React StrictMode in dev double-fires `useEffect`. `AuthProvider` gates init behind a **module-level promise** (`initPromise`) so the second mount reuses the first run. |
| **SSO across apps** | **Implicit and cross-origin.** Open `web-b` in a new tab → keycloak-js does `check-sso` → realm cookie is present → silent SSO succeeds. Three independent token stores end up with three sibling tokens. | **N/A — only one origin.** Switching between Client / Ops / Admin is intra-app routing; no second SSO handshake is needed. |
| **Token storage** | Per-origin keycloak-js memory. `web-b` and `web-c` each held their own tokens, even for the same user. | Single in-memory store in shell. MFEs ask the shell when they need a token. |
| **Refresh strategy** | Each app polled / refreshed against its own client. | Shell only. `host.auth.getToken()` runs `keycloak.updateToken(30)` before each downstream fetch — lazy refresh, no background timer. |
| **MFE → BFF auth** | (N/A) | MFE calls `host.auth.getToken()`, attaches `Authorization: Bearer` to `fetch('/api/<mfe>/...')`, shell's Vite proxy forwards to the right BFF container. |
| **Profile lookup** | Each app called `keycloak.loadUserProfile()` itself. | Shell exposes `host.auth.loadProfile()` which wraps `keycloak.loadUserProfile()`. The MFE `Profile` page calls it through TanStack Query, so all MFE-side profile reads share a single cache entry. |
| **Auth state in components** | Read directly from each app's keycloak-js instance (`keycloak.authenticated`, …). | React Context (`useAuth()` inside the shell, `host.auth.*` inside MFEs). Re-renders happen the React way. |
| **Logout fan-out** | `keycloak.logout()` redirected the current tab to Keycloak; other tabs found out lazily on their next `check-sso`. | `keycloak.onAuthLogout` → `setAuthenticated(false)` *and* `queryClient.clear()`. Every MFE-visible query (whoami, profile, BFF responses) invalidates atomically and the whole UI flips to anonymous in the same render tick — no per-MFE bookkeeping. |
| **OTP step** | Same — Keycloak's `demo-browser` flow runs `auth-username-password-form` then `demo-email-otp`. Trust cookie `KC_DEMO_OTP_TRUSTED` skips OTP for the configured window. | Unchanged. The browser flow is shared by every client in the realm; only the OIDC client name changes. |
| **The vanilla code path** | `frontend/src/Keycloak.ts`, `frontend/src/User.ts`, `frontend/src/App.ts`, all in plain TS, gone with commit `3a0ad28` (React refactor) and `e77ba51` (monorepo restructure). | `apps/shell/src/auth/{keycloak.ts,AuthProvider.tsx,useShellHost.ts}` and `packages/shell-api/src/index.ts`. |

In one sentence: **the shell is the only thing in the page that knows about Keycloak; everything else asks the shell**.

## Access matrix

| User → | mfe-client (any auth) | mfe-ops (`user,admin`) | mfe-admin (`admin`) |
|---|---|---|---|
| `democlient` (role: `client`) | ✓ | ✗ 403 | ✗ 403 |
| `demouser` (role: `user`) | ✓ | ✓ | ✗ 403 |
| `demoadmin` (roles: `admin`, `user`) | ✓ | ✓ | ✓ |

Enforcement is **two-layered**:

1. **UX gate.** Shell's `useWhoAmI` fetches `GET /api/whoami` on `bff-client`, which returns `{ username, email, roles, allowedMfes }`. `<RoleGate>` refuses to mount an MFE whose key isn't in `allowedMfes`; `<Nav>` greys out the link with a tooltip.
2. **Security gate.** Each MFE talks to its own BFF (`/api/<mfe>/*`). The BFF enforces `APP_ALLOWED_ROLES` server-side, so a hand-crafted Bearer token can never reach a forbidden BFF — even if a malicious shell skipped the role gate.

## Services

| Service | Host port | Role |
|---------|-----------|------|
| PostgreSQL | (internal) | Keycloak metadata + sessions — **not** end users |
| user-service | 8090 | Standalone Micronaut store of the demo users; the Keycloak SPI's REST backend |
| Keycloak | 8888 | Auth server; realm `demo-realm`; single client `mfe-shell-client` |
| shell | 5173 | Vite dev server. React shell with the singleton `keycloak-js`, federation host, `/api/*` proxy |
| mfe-client | 5181 | Vite **preview** (`build && preview`). Federation remote `mfeClient`, exposes `./Mfe`. Multi-page (`/`, `/profile`, `/protected`). |
| mfe-ops | 5182 | Vite **preview**. Federation remote `mfeOps`, exposes `./Mfe`. Single page. |
| mfe-admin | 5183 | Vite **preview**. Federation remote `mfeAdmin`, exposes `./Mfe`. Single page. |
| bff-client | 8081 | Micronaut BFF for `mfe-client` + the shell's `/api/whoami` endpoint. No `APP_ALLOWED_ROLES`. |
| bff-ops | 8082 | Micronaut BFF for `mfe-ops`. `APP_ALLOWED_ROLES=user,admin`. |
| bff-admin | 8083 | Micronaut BFF for `mfe-admin`. `APP_ALLOWED_ROLES=admin`. |

The three BFFs are the same Micronaut codebase / same image (`keycloak-demo-bff:latest`), parameterised by env vars.

## Quick Start

```bash
./start.sh
```

`start.sh` is a thin wrapper that auto-detects docker/podman, sources `.envrc`, takes any running stack down (volumes preserved), rebuilds the custom images, and brings everything back up.

To stop the stack:

```bash
./stop.sh           # tear containers down, keep volumes (default)
./stop.sh --wipe    # also remove Postgres + Keycloak volumes
```

`stop.sh` is the symmetric counterpart to `start.sh` — same engine auto-detection, and it always passes the `--dev` overlay if present so it covers Level 1 and Level 2 stacks alike. To wipe the realm DB and re-import `realm-export.json` from scratch:

```bash
./stop.sh --wipe && ./start.sh
```

Wait for all services to start (Keycloak takes ~30 seconds; the three Vite-preview containers `npm install && vite build` once on first start). All custom images compile from source at build time — Keycloak SPI (provider + generated REST client) during the Keycloak image build, the Micronaut BFF and `user-service` into shadow jars during their respective image builds. The two generated halves both come from `user-api/openapi.yaml`.

### Development workflows

Three modes, each one command.

| Level | When | Single command | Loop |
|---|---|---|---|
| **1 — demo** | Casual edits, just running the stack | `./start.sh` | Shell HMR <1s; MFE source → per-service `docker compose up -d --force-recreate mfe-X` (~10-15s); BFF source → `--build --force-recreate` (~90s) |
| **2 — MFE rebuild-on-save** | Actively writing MFE source | `./start.sh --dev` | Save → ~1-2s incremental rebuild inside the container → hard-refresh the browser. No `--force-recreate`. |
| **3 — BFF on the host** | Actively writing BFF source | `./start.sh --dev` then `./dev-bff.sh client\|ops\|admin` | Save → ~3s Gradle incremental → Micronaut restart in place |

`./start.sh --dev` adds `docker-compose.dev.yml` and switches the MFE containers to `vite build --watch + vite preview`. `./dev-bff.sh` detects docker vs podman, stops the compose BFF for the chosen role, recreates the shell with the right host-gateway URL (`host.docker.internal` for Docker, `host.containers.internal` for Podman), and then execs `./gradlew run -t --no-daemon` in the foreground. Tokens minted in the browser use `http://localhost:8888/realms/demo-realm` as the issuer — the script sets `KEYCLOAK_AUTH_SERVER_URL` to match.

To return to demo mode: `docker compose up -d bff-<which>` (restarts the compose BFF) then `./start.sh` (resets the shell without the host override).

### Running with Podman on macOS

`docker compose` (the CLI Podman delegates to) talks to a Docker-style socket, so point `DOCKER_HOST` at the Podman machine socket before running `podman compose`:

```bash
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

Copy `.envrc.example` to `.envrc` (gitignored, also holds the Resend API token — see 2FA section). If you use [direnv](https://direnv.net/), `direnv allow` does this whenever you `cd` in. Otherwise `source .envrc` per shell.

## Walking through the demo

1. Open http://localhost:5173. The shell redirects you to `/client` (the public MFE).
2. Click **Sign in**. Keycloak's login page appears (theme inherits the realm default).
3. Enter one of the demo users by email or username and password `123`.
4. Keycloak emails a 6-digit code via Resend and shows an OTP form. Enter the code. (If the email doesn't land — see the Resend sandbox caveat — the code is also in the Keycloak log: `docker compose logs keycloak | grep "EMAIL OTP"`.)
5. You land back on the shell. Now you're on the Client MFE's main page; the nav reflects what your roles unlock.
6. Click **Profile** (`/client/profile`) — username / email / name / roles, served by the MFE via the shell's `host.auth.loadProfile()`.
7. Click **Protected** (`/client/protected`) — the panel colour encodes your role; the body shows the response from `/api/client/user`.
8. Click **Ops** or **Admin** in the nav.
   - If your role allows it, the MFE federation-fetches its `remoteEntry.js` from `:5182` / `:5183` and renders. Each MFE has a *Ping my BFF* button that calls its private BFF; the HTTP code + `source` field tells you which container answered.
   - If not, the link is greyed out and clicking through gets stopped by `<RoleGate>` with an explanation banner.
9. **Sign out** from the nav chip — the shell's `keycloak.onAuthLogout` handler fires `queryClient.clear()` and every MFE-visible query refetches anonymous in the same tick.

A second tab on the same shell origin will pick up the auth state immediately on next render (same in-memory keycloak-js). The pre-rewrite "open `web-b` in a new tab to see cross-origin SSO" is gone — only one origin exists now.

## Visual states

**Protected panel color** still encodes the user's role (rendered inside `mfe-client/src/pages/Protected.tsx`):

| State | Color | Meaning |
|---|---|---|
| Not authenticated | Yellow | No Keycloak session |
| Authenticated without `admin` | Blue | `democlient` or `demouser` |
| Authenticated with `admin` | Red | `demoadmin` |

**Unauthorised banner.** When `<RoleGate>` denies access (e.g. `democlient` clicks Ops), the MFE never mounts; the gate renders a red banner listing the user's roles and what the MFE required.

## Endpoints

### Frontend
- Shell: http://localhost:5173 (lands on `/client`)
- `/client` → mfe-client at `:5181` (multi-page: `/client`, `/client/profile`, `/client/protected`)
- `/ops` → mfe-ops at `:5182`
- `/admin` → mfe-admin at `:5183`

Browser → shell origin only; the shell's Vite proxy fans out to the right BFF container.

### BFF APIs (also reachable directly for testing)
- **bff-client** (http://localhost:8081):
  - `GET /api/whoami` → `{ username, email, roles, allowedMfes }`. Used by the shell's `useWhoAmI`.
  - `GET /api/user` → standard auth response. No `APP_ALLOWED_ROLES` gate (everyone passes).
  - `GET /api/secure`, `GET /api/public` — small demo endpoints.
- **bff-ops** (http://localhost:8082): `/api/user` returns 200 only if token roles intersect `{user, admin}`; otherwise 403 with `reason: "not_allowed"` and `{allowedRoles, yourRoles, message}`.
- **bff-admin** (http://localhost:8083): `/api/user` returns 200 only for `admin`; same 403 shape otherwise.

### user-service (host-exposed for inspection)
- `GET  http://localhost:8090/users/{username}` → 200 user JSON (no password) or 404
- `GET  http://localhost:8090/users?email={email}` → 200 user JSON or 404
- `POST http://localhost:8090/users/verify-credentials` `{"username","password"}` → 200 `{"valid":true|false}` (always 200; transport failure is the caller's concern)
- `GET  http://localhost:8090/health` → 200 `{"status":"UP"}`

These are exactly the operations declared in `user-api/openapi.yaml`. Password only ever travels in the `verify-credentials` request body.

### Keycloak Admin
- URL: http://localhost:8888
- Credentials: `admin` / `admin`

## Verifying the role matrix from a shell

The script uses direct-grant (no OTP) so it's fast — and that's exactly why it's a smoke test, not a full login simulator.

```bash
for u in democlient demouser demoadmin; do
  T=$(curl -s -X POST "http://localhost:8888/realms/demo-realm/protocol/openid-connect/token" \
    -d "client_id=mfe-shell-client&grant_type=password&username=$u&password=123" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  curl -s -H "Authorization: Bearer $T" "http://localhost:8081/api/whoami" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["username"].rjust(11), "->", d["allowedMfes"])'
done
```

Expected:

```
 democlient -> ['client']
   demouser -> ['client', 'ops']
  demoadmin -> ['client', 'ops', 'admin']
```

Then check the per-BFF gating (200 vs 403 — same Bearer token, three BFF ports):

```bash
for u in democlient demouser demoadmin; do
  T=$(curl -s -X POST "http://localhost:8888/realms/demo-realm/protocol/openid-connect/token" \
    -d "client_id=mfe-shell-client&grant_type=password&username=$u&password=123" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  line="$(printf '%-11s' $u)"
  for app in "client:8081" "ops:8082" "admin:8083"; do
    p="${app##*:}"; n="${app%%:*}"
    code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $T" "http://localhost:$p/api/user")
    line="$line  bff-$n=$code"
  done
  echo "$line"
done
```

## Demo Users (served by user-service)

Users are hardcoded in `user-service/src/main/java/demo/userservice/UserController.java`. The realm has `loginWithEmailAllowed: true`, so the login form accepts either username or email.

| Username | Email | Password | SPI-assigned roles |
|----------|-------|----------|--------------------|
| `democlient` | `nikiiv.linococo@gmail.com` | `123` | `client` |
| `demouser` | `nikolay.ivanchev@gmail.com` | `123` | `user` |
| `demoadmin` | `nikolai.ivanchev@gmail.com` | `123` | `admin`, `user` |

Keycloak's built-in `default-roles-demo-realm` composite still adds `offline_access` and `uma_authorization` on top of the SPI roles (it doesn't include `user`, so `democlient` really gets only `client`).

## Email-based 2FA

After username-or-email + password, the `demo-browser` flow runs a custom **Email OTP** authenticator (`keycloak-provider/src/main/java/com/example/keycloak/EmailOtpAuthenticator.java`) that:

1. Generates a cryptographically random 6-digit code.
2. Stores the code and an `expires` timestamp (10 minutes ahead) as auth-session notes.
3. **Logs the code** at INFO (always — the fallback viewing mechanism when Resend sandbox delivery doesn't land).
4. Sends an HTML email via the Resend HTTP API (`ResendClient.java`).
5. Renders `email-otp.ftl` (packaged as a `theme-resources/templates/` entry in the provider jar) asking for the code.
6. On submit: if the code matches and hasn't expired, the flow succeeds. If expired or empty, a new code is minted in-place and the form re-renders. If wrong, the form redisplays with "Invalid code".

**Session vs code validity.** The 10 minutes apply to the OTP itself during login. Once authenticated, the realm's normal token/session lifespans apply.

**Trust cookie.** After a successful OTP, the authenticator drops a signed cookie (`KC_DEMO_OTP_TRUSTED`, HttpOnly, realm-scoped, SameSite=Lax) carrying user id + expiry + HMAC-SHA256. On the next login, a matching unexpired cookie skips the OTP step. Window is `OTP_TRUST_WINDOW_MINUTES` (default 60; set to 0 to always require OTP). The HMAC key is generated once per Keycloak process — restart invalidates every outstanding trust cookie (fine for a demo, not for prod).

### Resend configuration

`RESEND_API_TOKEN` lives in `.envrc` (gitignored; copy `.envrc.example`). To rotate: update `.envrc` and `docker compose up -d --force-recreate keycloak` — no image rebuild needed. If the token is unset, `ResendClient.send()` short-circuits with a calm INFO log and the OTP code is still visible in the log banner. From-address defaults to `"Demo Realm <onboarding@resend.dev>"` via `RESEND_FROM`.

### ⚠ Resend sandbox caveat

`onboarding@resend.dev` only delivers to the address registered with the Resend account. Other addresses return `202 Accepted` and are silently dropped. So **at most one demo user actually receives emails**. Mitigation: every OTP is also written to the Keycloak INFO log:

```bash
docker compose logs keycloak | grep -A 4 "EMAIL OTP"
```

Permanent fix: verify a domain at Resend and set `RESEND_FROM` to an address in that domain.

### Authentication flow wiring

`keycloak/realm-export.json` defines a custom top-level browser flow used by every client in the realm:

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

The user store is a standalone Micronaut service (`user-service/`) and the REST contract between it and Keycloak is **defined before any code**, in one file: `user-api/openapi.yaml`. Nothing about that wire format is written by hand on either side.

### The contract

Three operations, tagged `Users`, with explicit `operationId`s so the generated method names are stable on both sides:

| Operation | `operationId` | Result |
|---|---|---|
| `GET /users/{username}` | `getUserByUsername` | `200` `User` / `404` |
| `GET /users?email=…` | `getUserByEmail` | `200` `User` / `404` |
| `POST /users/verify-credentials` | `verifyCredentials` | **always `200`** `{ "valid": bool }` |

`User` is `{ username, email, firstName, lastName, roles[] }` — **no password**. The password only ever appears in the `verify-credentials` request body. `verify-credentials` returns `200` even on wrong password so the caller can distinguish "reachable, wrong password" (`valid:false`) from a transport failure (which `UserServiceClient` treats as fail-closed).

### Code generation (one spec, two generators)

| Side | Module | openapi-generator | Output |
|---|---|---|---|
| Server | `user-service/` | `java-micronaut-server` (`reactive=false`, `useAuth=false`, abstract controller) | `AbstractUsersController` + models. `UserController` extends it and supplies the logic + hardcoded `USERS` map. |
| Client | `keycloak-provider/` | `java`, `library=native` (JDK `java.net.http`) | `UsersApi` + `ApiClient` + models. `UserServiceClient` wraps it. |

Both `openApiGenerate` tasks read `$rootDir/../user-api/openapi.yaml` and run before `compileJava`; the generated sources land under each module's `build/` (git-ignored, regenerated every build). The `native` client library is deliberate: the SPI runs inside Keycloak's JVM with no Micronaut context, so it needs a plain-Java HTTP client (`java.net.http`, JDK-only) — not a Micronaut/Netty one.

### Packaging & runtime

`user-service` is built once into a fat-jar image (`user-service/Dockerfile`, `com.gradleup.shadow` → `eclipse-temurin:17-jre`) tagged `keycloak-demo-user-service:latest`, same approach as `bff/`. Its build context is the **repo root** so the build can read the shared `user-api/openapi.yaml`. In compose, Keycloak reaches it as `http://user-service:8080`; host port `8090` is exposed only for inspection. Health-check matches Micronaut's `200 Ok` status line (note: not `200 OK`).

**Failure modes are explicit.** `user-service` down → lookups return `null` (login fails cleanly) and `verify-credentials` is treated as `false` (fail closed — never authenticate when the store is unreachable).

## The Keycloak User Storage Provider (`keycloak-provider/`)

A standalone Gradle project implementing Keycloak's **User Storage SPI** — federation plugin letting Keycloak pull users from an external source. Here the source is `user-service/`: the provider holds no user data and makes a REST call for every lookup. The same module also ships the **Email OTP Authenticator** (see 2FA above); both SPIs are packaged into a single jar.

> The HTTP client the provider uses is **not hand-written** — it is generated from `user-api/openapi.yaml`. The provider code only wraps it.

### Files

```
keycloak-provider/
├── build.gradle.kts                              # keycloak SPI + jakarta.ws.rs compileOnly; openapi-generator
│                                                 #   (java/native client) + shadow (relocates Jackson)
└── src/main/
    ├── java/com/example/keycloak/
    │   ├── DemoUserStorageProviderFactory.java   # factory — resolves USER_SERVICE_URL, builds client
    │   ├── DemoUserStorageProvider.java          # UserLookupProvider + CredentialInputValidator — delegates to REST
    │   ├── UserServiceClient.java                # wraps the generated client: 404→null, fail-closed verify
    │   ├── DemoUser.java                         # per-user adapter, extends AbstractUserAdapter
    │   ├── EmailOtpAuthenticatorFactory.java     # OTP authenticator factory — PROVIDER_ID "demo-email-otp"
    │   ├── EmailOtpAuthenticator.java            # generate code, send via Resend, validate
    │   └── ResendClient.java                     # thin HTTP wrapper over api.resend.com
    │   # com.example.keycloak.client.* (api/model/invoker) is GENERATED into build/
    └── resources/
        ├── META-INF/services/
        │   ├── org.keycloak.storage.UserStorageProviderFactory
        │   └── org.keycloak.authentication.AuthenticatorFactory
        └── theme-resources/templates/
            └── email-otp.ftl                     # OTP entry page
```

### How the classes fit together

1. **Factory** (`DemoUserStorageProviderFactory`) — Keycloak discovers it via `META-INF/services/`. Its `getId()` returns `"demo-user-provider"` (the string `realm-export.json` references). Its `create()` resolves the user-service URL (precedence: realm component config `userServiceUrl` → env `USER_SERVICE_URL` → default `http://user-service:8080`) and builds a `UserServiceClient`.
2. **Provider** (`DemoUserStorageProvider`) — implements `UserLookupProvider` + `CredentialInputValidator`, both delegating to the REST client.
3. **REST client wrapper** (`UserServiceClient`) — wraps the generated `UsersApi`/`ApiClient`, owns the availability policy: `404` (or any error) on lookup → `null`; **any** error on verify → `false` (fail closed).
4. **User adapter** (`DemoUser`) — wraps `DemoUserRecord` (username/email/roles), backed by Keycloak's `AbstractUserAdapter`. `getRoleMappingsInternal()` auto-creates any realm role named in the record if missing.

### How the realm attaches to the provider

`keycloak/realm-export.json` registers a component:

```json
"components": {
  "org.keycloak.storage.UserStorageProvider": [
    {
      "name": "demo-user-provider",
      "providerId": "demo-user-provider",
      "subComponents": {},
      "config": { "enabled": ["true"], "priority": ["0"], "cachePolicy": ["NO_CACHE"] }
    }
  ]
}
```

`NO_CACHE` means every lookup hits `user-service` over REST (changes are visible on the next request — important for the demo).

### Build and runtime wiring

`Dockerfile.keycloak` is multi-stage:

```
FROM gradle:8.5-jdk17 AS provider-build
WORKDIR /build/keycloak-provider
COPY keycloak-provider/settings.gradle.kts keycloak-provider/build.gradle.kts ./
COPY user-api /build/user-api
COPY keycloak-provider/src ./src
RUN gradle --no-daemon shadowJar          # generates the client, then fat-jars it

FROM quay.io/keycloak/keycloak:26.0.7
COPY --from=provider-build .../keycloak-demo-provider-1.0.0.jar /opt/keycloak/providers/
COPY keycloak/themes /opt/keycloak/themes
RUN /opt/keycloak/bin/kc.sh build
```

Build context is the repo root; the build lays `keycloak-provider/` and `user-api/` as siblings so the same `$rootDir/../user-api` path resolves on host and in Docker. `shadowJar` (a) runs `openApiGenerate`, then (b) bundles the client + Jackson into one provider jar, **relocating** `com.fasterxml.jackson` → `com.example.keycloak.shaded.jackson` to avoid clashing with the Jackson Keycloak already loads. `mergeServiceFiles()` keeps both `META-INF/services` registrations intact. Changes to provider source (or to `user-api/openapi.yaml`) require `docker compose build keycloak && docker compose up -d --force-recreate keycloak`.

### Adding a user

The hardcoded map lives in `user-service`, not the provider. Edit `USERS` in `user-service/src/main/java/demo/userservice/UserController.java`, then:

```bash
docker compose up -d --build --force-recreate user-service
```

No Keycloak rebuild needed (the SPI didn't change). Any role name that doesn't exist is auto-created at first login.

### Pointing at a real backend

Replace `UserController`'s hardcoded `USERS` map with a real lookup — JDBC, LDAP bind, an upstream identity API — keeping the responses conformant to `user-api/openapi.yaml`. To extend the contract (search, registration, …), add the operation to the spec, regenerate both sides, implement the server method, and add the matching SPI capability interface (`UserQueryProvider`, `UserRegistrationProvider`, …) wired through `UserServiceClient`.

## Parameterization

The shell + three MFE + three BFF containers parameterize everything via env vars in `docker-compose.yml`:

| Env var | Service | Purpose |
|---------|---------|---------|
| `VITE_KEYCLOAK_URL` | shell | Keycloak issuer URL (browser-side) |
| `VITE_KEYCLOAK_CLIENT_ID` | shell | OIDC client (`mfe-shell-client`) |
| `VITE_APP_NAME`, `VITE_APP_TITLE`, `VITE_APP_THEME` | shell | Nav brand + tab title + chrome theme |
| `VITE_MFE_CLIENT_URL`, `VITE_MFE_OPS_URL`, `VITE_MFE_ADMIN_URL` | shell | Federation remote URLs. **Browser-reachable** (host-perspective), baked into the shell bundle at config time. |
| `BFF_SHELL_URL`, `BFF_CLIENT_URL`, `BFF_OPS_URL`, `BFF_ADMIN_URL` | shell | Vite proxy targets. **Compose-internal** hostnames. |
| `MICRONAUT_APPLICATION_NAME` | each BFF | Service name in logs |
| `APP_SOURCE` | each BFF | Value of `source` field in BFF responses (shown by MFEs' BffStatus widget) |
| `APP_ALLOWED_ROLES` | bff-ops, bff-admin | Comma-separated allow-list. Empty/unset on bff-client. |
| `CORS_ORIGIN` | each BFF | Single allowed origin — always `http://localhost:5173` now (one shell origin). |
| `KEYCLOAK_AUTH_SERVER_URL` | each BFF | Internal URL to Keycloak for JWKS lookup |
| `USER_SERVICE_URL` | keycloak | Base URL the SPI calls. Defaults to `http://user-service:8080`. |
| `OTP_TRUST_WINDOW_MINUTES` | keycloak | Trust-cookie window in minutes (default 60; 0 disables) |
| `RESEND_API_TOKEN`, `RESEND_FROM` | keycloak | OTP email delivery |

## Implementation notes

- **Module Federation expose requires a build.** Each MFE container's command is `npm install && npm run -w mfe-X build && npm run -w mfe-X preview`. There is no HMR across federation boundaries — source changes to an MFE need `docker compose up -d --force-recreate mfe-X`. The shell stays in `vite dev` so its own HMR works.
- **Federation shared deps must be aligned.** `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query` are listed in `shared` on the shell and on each MFE's `vite.config.ts`. Removing one breaks hooks across the boundary (duplicate React instance).
- **The MFE's `<Routes>` attach to the shell's BrowserRouter.** Because `react-router-dom` is in `shared`, `mfe-client/src/index.tsx` can use `<Routes>` with paths relative to its mount point (`/client/*`). No second router is created.
- **`dist/` is bind-mounted into MFE containers.** Deleting `frontend/apps/mfe-X/dist` on the host removes the directory `vite preview` is serving, so the running container starts returning 404 even though it logged "built in N s". Recreate the MFE after any such cleanup.
- **Provider build is inside the Keycloak image.** Multi-stage Dockerfile compiles `keycloak-provider/` via `gradle shadowJar` (which first runs `openApiGenerate`), then `kc.sh build` registers the SPI at image-build time.
- **Contract-first, one source of truth.** `user-api/openapi.yaml` is the only hand-written wire-format description. Editing it and rebuilding regenerates both sides.
- **Role claim flattening.** Every client in `keycloak/realm-export.json` has an `oidc-usermodel-realm-role-mapper` exposing realm roles as a top-level `roles` claim. The BFFs read it via `micronaut.security.token.roles-name: roles`.
- **`keycloak-js` ≥ 26.x required.** Older versions validate a `nonce` claim Keycloak 26 no longer emits.
- **Realm re-import semantics.** Keycloak's `--import-realm` uses `IGNORE_EXISTING` by default, so the realm JSON only seeds an empty DB. To pick up JSON edits on a running stack, either `docker compose down -v && ./start.sh` or apply via the admin API.
- **Two SPIs, one jar.** `keycloak-provider/` ships the user-storage provider and the email-OTP authenticator. Two service files under `META-INF/services/`; `shadowJar`'s `mergeServiceFiles()` keeps both in the fat jar.
- **2FA only runs in the browser flow.** `grant_type=password` (direct-grant) bypasses OTP — useful for scripting, not equivalent to interactive login.

## Tear Down

```bash
docker compose down -v
```
