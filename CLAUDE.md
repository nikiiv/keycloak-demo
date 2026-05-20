# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Survival notes for working in this repo. The **README.md** is the user-facing doc; this file only captures things that matter when editing the code and that you can't reliably infer from a first read.

## What this is

A Keycloak SSO demo with a **microfrontend (MFE) front end**: one React shell signs the user in once against a single OIDC client (`mfe-shell-client`) and lazy-loads three role-gated MFE workspaces (`mfe-client`, `mfe-ops`, `mfe-admin`) from the same npm-workspaces monorepo under `frontend/`. The shell shares one `QueryClient` and one `AuthProvider` across all MFEs.

End-user identity lives in a **standalone Micronaut REST service** (`user-service/`); the Keycloak User Storage SPI in `keycloak-provider/` is a thin REST client of it. Keycloak's Postgres only holds realm metadata and sessions.

The REST contract between the SPI and `user-service` is defined OpenAPI-first in `user-api/openapi.yaml`. Both sides — the SPI's HTTP client and the user-service's controller/model stubs — are **generated** from that one file at build time. Edits to a generated class are blown away on the next build; change the spec instead.

Three demo users (hardcoded in `user-service/src/main/java/demo/userservice/UserController.java`) — identified by email because `loginWithEmailAllowed=true`. Username still works as an alternate identifier:

| Username | Email | Password | Roles |
|---|---|---|---|
| democlient | nikiiv.linococo@gmail.com | 123 | `client` |
| demouser   | nikolay.ivanchev@gmail.com | 123 | `user` |
| demoadmin  | nikolai.ivanchev@gmail.com | 123 | `admin`, `user` |

After username/password, Keycloak requires a 6-digit email OTP (see "2FA gotchas" below).

Role gating lives in the BFF (source of truth). `GET /api/whoami` returns `{ username, email, roles, allowedMfes }`; the shell's `useWhoAmI` query feeds this into `<RoleGate>` (refuses to mount unauthorized MFEs) and `<Nav>` (greys out their links). The legacy `/api/user` endpoint kept its `APP_ALLOWED_ROLES` enforcement for the role-matrix curl script below, but the MFE shell no longer consumes it.

Role → MFE mapping in `bff/UserController.java#whoami`:

| User | client | ops | admin |
|---|---|---|---|
| democlient (`client`) | ✓ | ✗ | ✗ |
| demouser (`user`) | ✓ | ✓ | ✗ |
| demoadmin (`admin, user`) | ✓ | ✓ | ✓ |

## Layout and where to make common changes

- `frontend/` — **npm workspaces monorepo**. Root `package.json` declares `apps/*` and `packages/*`. There is no longer a single shared SPA; each workspace is its own npm package, source-linked.
  - `apps/shell/` — the React + React Router + TanStack Query shell. Owns `keycloak-js` (`auth/AuthProvider.tsx` — singleton-gated `keycloak.init()`), the `QueryClient`, the layout (`components/Layout.tsx` + `Nav.tsx`), the lazy MFE router (`components/MfeOutlet.tsx`), the `RoleGate`, the `useWhoAmI` hook (`api/queries.ts`), and the shared `styles.css`.
  - `apps/mfe-client/`, `apps/mfe-ops/`, `apps/mfe-admin/` — three default-exported `MfeComponent`s. Each wraps its content in `<div data-theme="a|b|c">` so the shell's CSS variables resolve to that MFE's palette. None import `keycloak-js` directly; they receive a `ShellHost` prop from the shell when needed.
  - `packages/shell-api/` — TypeScript-only contract package. Exports `ShellHost`, `ShellAuth`, `MfeComponent`, `MfeProps`, `MfeKey`, `WhoAmI`. **The single source of truth for the shell ↔ MFE wire format.**
- `bff/` — shared Micronaut backend. `src/main/java/demo/UserController.java` has both endpoints: `/api/whoami` (MFE shell) computes `allowedMfes` from JWT roles in-memory; `/api/user` (legacy) keeps `APP_ALLOWED_ROLES`. One fat-jar image (`keycloak-demo-bff:latest`) used by the single `bff` service.
- `user-service/` — standalone Micronaut REST service that owns the demo users. `src/main/java/demo/userservice/UserController.java` has the hardcoded `USERS` map + password verify; it extends `AbstractUsersController`, which is **generated** under `build/generated/openapi/` from the contract. Fat-jar image `keycloak-demo-user-service:latest`.
- `user-api/openapi.yaml` — the single hand-written description of the SPI ↔ user-service wire format. Both `keycloak-provider/` (client) and `user-service/` (server stubs) regenerate from this on every build.
- `keycloak-provider/` — standalone Gradle project shipping **two** SPIs in one jar: the User Storage provider (`DemoUserStorageProvider` + `UserServiceClient` + adapter) and the Email-OTP Authenticator (`EmailOtpAuthenticator` + factory + `ResendClient`). Two service files under `src/main/resources/META-INF/services/` register them. The OTP form lives in `src/main/resources/theme-resources/templates/email-otp.ftl`. The generated REST client (`com.example.keycloak.client.*`) lives only in `build/`; never edit it. To add or modify a user, see `user-service/` above — **not** this module.
- `keycloak/realm-export.json` — realm seed: clients, realm roles, default-role composite, SPI component registration, `demo-browser` flow with the OTP step.
- `docker-compose.yml` — `shell` (5173), `bff` (8081), Keycloak (8888), `user-service` (8090), Postgres. The shell container mounts `./frontend` to `/workspace` and runs `npm install && npm run -w shell dev` so the workspace symlinks are wired before Vite starts; Vite resolves `import 'mfe-client'` through `apps/shell/node_modules/mfe-client` → workspace link → `apps/mfe-client/src/index.tsx`.
- `Dockerfile.keycloak` — multi-stage: stage 1 runs `gradle shadowJar` on `keycloak-provider/` (which first generates the REST client from `user-api/openapi.yaml`, then fat-jars it with relocated Jackson). Stage 2 copies the jar into `/opt/keycloak/providers/` and runs `kc.sh build`. Build context is the **repo root** so the build can read `user-api/`. SPI changes need a full image rebuild, not just a container restart.
- `start.sh` — the canonical entrypoint. Auto-detects docker or podman, sources `.envrc`, tears the stack down (preserving volumes), rebuilds all three custom images, and brings everything back up. On the podman path it explicitly waits for postgres + user-service + keycloak healthchecks before starting the rest, because `podman compose` ignores `depends_on: condition: service_healthy`. Override engine selection with `CONTAINER_ENGINE=docker|podman`.

## Non-obvious runtime gotchas

- **`Authentication.getRoles()` returns `Collection<String>`, not `List<String>`.** The Micronaut type is `Collection`; don't assign to `List` in `UserController.java`.
- **Realm imports are `IGNORE_EXISTING` by default.** `--import-realm` seeds an empty Postgres only. To apply a `realm-export.json` edit on a running stack, either `podman compose down -v && up` (wipes everything) or change the live realm via admin API (fast, preserves sessions). Always update both if you want reproducibility.
- **SPI auto-creates realm roles.** `DemoUser.getRoleMappingsInternal()` calls `realm.addRole(name)` if a referenced role is missing, so roles named by user-service records that aren't in `realm-export.json` still work at runtime — but a fresh-DB install would lack them until the first login. Keep BFF-gated role names declared in the JSON too.
- **`defaultRoles` is deprecated in Keycloak 26.** The realm JSON no longer has `"defaultRoles"`; the old effect (every user gets `user`) lived in the `default-roles-demo-realm` composite, from which we removed `user`. Don't add `defaultRoles` back — it won't behave as you expect.
- **SPI is `NO_CACHE`.** The realm component config sets `cachePolicy: NO_CACHE`, so every Keycloak lookup hits `user-service` over REST. Changes in `user-service` are visible on the next request (good for the demo) but every login is at least 3 round-trips over the compose network — don't be surprised by the latency.
- **`UserServiceClient` is fail-closed.** Any non-200 / transport error on `/users/verify-credentials` returns `false`. If `user-service` is down, a `grant_type=password` request returns `invalid_grant` rather than hanging. Lookups (`getUserByUsername`, etc.) similarly map any error to `null`. This is intentional: never authenticate when the user store is unreachable.
- **Generated code lives in `build/`, not `src/`.** `openApiGenerate` writes `keycloak-provider/build/generated/openapi/` and `user-service/build/generated/openapi/`. Both are gitignored and regenerated every build. Editing them is pointless. `user-service/openapi-generator-ignore` suppresses the generator's sample controller stub so only the hand-written `UserController` compiles.
- **The provider jar ships shaded Jackson.** `shadowJar` in `keycloak-provider/build.gradle.kts` relocates `com.fasterxml.jackson` → `com.example.keycloak.shaded.jackson` so the in-JVM SPI client cannot collide with the Jackson Keycloak already loads on the provider classpath. If you add a new dependency to the provider, think about classloader clashes.
- **BFF and user-service run as baked fat jars, not `gradle run`.** Both Micronaut apps are built once into their own image (`bff/Dockerfile`, `user-service/Dockerfile`) using the `com.gradleup.shadow` plugin → `eclipse-temurin:17-jre` base. PID 1 is `java -jar /app/<svc>.jar`; there is no source tree, no Gradle cache, and no bind mount. A source edit needs a `--build --force-recreate` (see the table below). `--force-recreate` matters: after a rebuild, the `*:latest` tag points to a new image ID, but existing containers still hold the *old* ID at creation time. `up -d` alone won't notice; `--force-recreate` unconditionally destroys + recreates so they bind to the new image.
- **Shadow plugin is declared explicitly in `bff/build.gradle.kts` and `user-service/build.gradle.kts`.** Micronaut 4.4's application plugin doesn't register `shadowJar` on its own (it prefers its own `buildLayers`/`dockerBuild` flow); both modules add `id("com.gradleup.shadow") version "8.3.5"` so `gradle shadowJar` produces `build/libs/*-all.jar` for the Dockerfiles to copy. All Gradle modules use the Kotlin DSL — `build.gradle.kts`.
- **Build context for the Keycloak and user-service images is the repo root**, not their own subdirectories. Both Dockerfiles read `user-api/openapi.yaml` as a sibling of their module, so the compose `build.context` is `.` with an explicit `dockerfile:` path. Don't rewrite these to use a subdirectory context — generation will fail to find the spec.
- **Keycloak admin API is on port 8888 (not 8080).** Get a token at `/realms/master/protocol/openid-connect/token` with `client_id=admin-cli&grant_type=password&username=admin&password=admin`. Admin endpoints live under `/admin/realms/demo-realm/...`.
- **`keycloak-js` must be ≥ 26.x.** Older versions validate a `nonce` claim that Keycloak 26 no longer emits.

## 2FA gotchas

- **Email OTP runs only on the browser flow.** The realm's `browserFlow` is `demo-browser`, which chains `auth-username-password-form` then `demo-email-otp`. Direct-grant (`grant_type=password`) uses the stock `direct grant` flow and **bypasses OTP** — convenient for `curl` tests, but means the role-matrix script below doesn't exercise the second factor.
- **OTP code lives in `AuthenticationSessionModel` notes.** `EmailOtpAuthenticator` stores `email-otp-code` + `email-otp-expires`; no Postgres schema. If a code expires, `action()` re-enters `authenticate()` and mints a new one in place (user stays on the OTP form).
- **Resend sandbox only delivers to the account owner.** `onboarding@resend.dev` → only the email address registered with the Resend account actually receives. Other addresses return `202 Accepted` from the API but aren't delivered. Mitigation: `EmailOtpAuthenticator.authenticate()` always logs `Email OTP for <email>: NNNNNN (valid 10min)` at INFO, so the demo is usable without inbox delivery (`podman compose logs keycloak | grep "Email OTP"`). Proper fix is to verify a domain at Resend and set `RESEND_FROM` to an address in that domain.
- **`RESEND_API_TOKEN` unset is a supported mode.** `ResendClient.send()` short-circuits with a calm INFO log if the token is empty — no exception, no stack trace — and login continues using the logged OTP. The token lives in `.envrc` (gitignored) and is read via `System.getenv()`; never baked into the image.
- **10-minute validity is for the *code*, not the session.** Once authentication completes, the realm's existing `accessTokenLifespan` / `ssoSessionIdleTimeout` / `ssoSessionMaxLifespan` apply as before. No forced logout at 10 minutes.
- **`jakarta.ws.rs-api` is a `compileOnly` dep.** `EmailOtpAuthenticator` imports `jakarta.ws.rs.core.Response` and `MultivaluedMap`; Keycloak's SPI jars don't transitively expose jakarta-ws-rs at compile time, so `keycloak-provider/build.gradle.kts` declares it. If you build a new authenticator that uses JAX-RS types, the build fails without this dep.
- **Authenticator ID is `demo-email-otp`.** If you rename it in `EmailOtpAuthenticatorFactory.PROVIDER_ID`, update the `"demo-browser forms"` flow in `realm-export.json` to match, or the flow won't load on fresh import.
- **OTP trust cookie skips the email step.** After a successful OTP, `EmailOtpAuthenticator.issueTrustCookie()` sets `KC_DEMO_OTP_TRUSTED` (HttpOnly, realm-scoped, SameSite=Lax). The cookie carries `userId.expiresAt.hmac` (HMAC-SHA256 with a process-local key). On the next `authenticate()`, a matching unexpired cookie short-circuits the flow via `context.success()` — no code generated, no email sent. Window is `OTP_TRUST_WINDOW_MINUTES` (default 60; `0` disables the feature and always requires OTP). The HMAC key is regenerated on Keycloak restart, which invalidates every outstanding trust cookie — fine for a demo, not fine for production.

## Running this on macOS + Podman

`./start.sh` is the normal way in — it auto-detects docker or podman and handles the macOS podman quirks below. Force one or the other with `CONTAINER_ENGINE=docker|podman ./start.sh`.

If you're using `podman compose` directly, two things to know:

1. **`DOCKER_HOST` socket path.** The compose CLI talks through a Docker-style socket; Podman uses a different socket path than the machine-default claims:

   ```bash
   export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
   ```

   The `.envrc` has a version of this, but if `podman compose` errors with "Cannot connect to the Docker daemon," export the path directly. Every Bash call that uses `podman compose` in this repo must have `DOCKER_HOST` set.

2. **`depends_on: condition: service_healthy` is ignored.** `podman compose` doesn't honor compose healthcheck gating, so a naive `podman compose up -d` starts `keycloak` before `user-service` is reachable and Keycloak's SPI registration fails. `start.sh` works around this by `up -d`-ing postgres + user-service first, polling their health, then bringing keycloak up, then everything else. If you skip `start.sh`, replicate the sequence by hand or wait long enough.

## Applying changes — what needs what

| Change | Minimum action |
|---|---|
| Frontend (shell or any MFE) source | nothing — Vite HMR picks it up. Each MFE bundles separately because the shell `lazy()`-imports them; HMR boundaries land on the MFE root component. |
| New workspace dep / new MFE | restart the shell container so `npm install` re-runs in `/workspace`: `podman compose up -d --force-recreate shell`. The bind mount keeps source live; only the install step is gated. |
| BFF source | `podman compose up -d --build --force-recreate bff` — one build, one container. `--force-recreate` is the belt-and-suspenders bit: without it, some compose implementations don't notice the image ID moved and leave the old container running. |
| `user-service` source (incl. adding/removing demo users) | `podman compose up -d --build --force-recreate user-service` — only this image. Keycloak does not need a rebuild because the SPI didn't change. |
| `user-api/openapi.yaml` (contract edit) | rebuild **both** sides: `podman compose up -d --build --force-recreate user-service` **and** `podman compose build keycloak && podman compose up -d --force-recreate keycloak`. Both modules regenerate their half of the contract on the next `gradle` invocation. |
| Env var on a service | `podman compose up -d --force-recreate <service>` |
| `docker-compose.yml` structural change | `podman compose up -d` (compose picks up the diff) |
| `keycloak-provider/` SPI source | `podman compose build keycloak && podman compose up -d --force-recreate keycloak` |
| `keycloak/realm-export.json` | takes effect on fresh DB only; otherwise patch the live realm via admin API |
| New realm role needed for a running demo | POST `/admin/realms/demo-realm/roles` with admin token; also add to `realm-export.json` for future fresh installs |
| `EmailOtpAuthenticator` / `ResendClient` source | `podman compose build keycloak && podman compose up -d --force-recreate keycloak` — same as any SPI change |
| Auth flow edit in `realm-export.json` | wipe postgres volume (`down -v`) OR patch live flow via admin API — see note above |

## Testing the role matrix quickly

```bash
# Grab tokens for all three users, then poll /api/whoami on the BFF.
for u in democlient demouser demoadmin; do
  T=$(curl -s -X POST "http://localhost:8888/realms/demo-realm/protocol/openid-connect/token" \
    -d "client_id=mfe-shell-client&grant_type=password&username=$u&password=123" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  curl -s -H "Authorization: Bearer $T" "http://localhost:8081/api/whoami" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"{d[\"username\"]:>11s} -> {d[\"allowedMfes\"]}")'
done
```

Expected:

```
 democlient -> ['client']
  demouser  -> ['client', 'ops']
 demoadmin  -> ['client', 'ops', 'admin']
```

Any deviation means either the role → MFE mapping in `bff/UserController.java#whoami` changed or the token roles aren't what you think — decode the JWT payload with `echo "$T" | cut -d. -f2 | base64 -d` to check. Reminder: this uses direct-grant, so the OTP step is **not** exercised.

You can also poke `user-service` directly on port 8090 — it's exposed for inspection (`GET /users/{username}`, `GET /users?email=...`, `POST /users/verify-credentials`, `GET /health`). Inside the compose network Keycloak reaches it as `http://user-service:8080`.

## Commit style

Recent commits use plain prose bodies, no trailers other than `Co-Authored-By: Claude ...`. Prefer one commit per logical change; match the existing style.
