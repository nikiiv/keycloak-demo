# CLAUDE.md

Survival notes for working in this repo. The **README.md** is the user-facing doc; this file only captures things that matter when editing the code and that you can't reliably infer from a first read.

## What this is

A Keycloak SSO demo: one Vite SPA + one Micronaut BFF, launched three times (App A/B/C) as independent OIDC clients. End-user identity comes from a custom Keycloak User Storage SPI in `keycloak-provider/` — users are a hardcoded Java `Map`, not rows in Keycloak's Postgres.

Three demo users (SPI-hardcoded) — identified by email because `loginWithEmailAllowed=true`. Username still works as an alternate identifier:

| Username | Email | Password | Roles |
|---|---|---|---|
| democlient | nikiiv.linococo@gmail.com | 123 | `client` |
| demouser   | nikolay.ivanchev@gmail.com | 123 | `user` |
| demoadmin  | nikolai.ivanchev@gmail.com | 123 | `admin`, `user` |

After username/password, Keycloak requires a 6-digit email OTP (see "2FA gotchas" below).

Per-app role model, enforced **both** in the frontend (banners) and BFF (403 with structured JSON):

| User / App | A | B | C |
|---|---|---|---|
| democlient | ✓ | forbidden_role | forbidden_role |
| demouser | ✓ | ✓ | missing_required_role |
| demoadmin | ✓ | ✓ | ✓ |

Gating is env-driven: `APP_FORBIDDEN_ROLE` / `VITE_FORBIDDEN_ROLE` and `APP_REQUIRED_ROLE` / `VITE_REQUIRED_ROLE`. Forbidden is checked before required.

## Layout and where to make common changes

- `frontend/` — shared SPA source. `src/App.ts` has the banner + Protected-panel rendering; `src/User.ts` wraps Keycloak/BFF calls; `index.html` has all CSS.
- `bff/` — shared Micronaut backend. `src/main/java/demo/UserController.java` has the role checks; `src/main/resources/application.yml` maps env vars to `app.*` config.
- `keycloak/realm-export.json` — realm seed: clients, realm roles, default-role composite, SPI component registration.
- `keycloak-provider/` — standalone Gradle project shipping **two** SPIs in one jar: the User Storage provider (`DemoUserStorageProvider`) and the Email-OTP Authenticator (`EmailOtpAuthenticator` + factory + `ResendClient`). Two service files under `src/main/resources/META-INF/services/` register them. The OTP form lives in `src/main/resources/theme-resources/templates/email-otp.ftl`. To add a user, edit the `USERS` map in `DemoUserStorageProvider.java` and rebuild the Keycloak image (`podman compose build keycloak && podman compose up -d --force-recreate keycloak`).
- `docker-compose.yml` — parameterizes every app-specific value via env vars. Three web services (5173/5174/5175), three BFFs (8081/8082/8083), plus Keycloak (8888) and Postgres.
- `Dockerfile.keycloak` — multi-stage: builds the SPI jar and bakes it into the Keycloak image via `kc.sh build`. SPI changes need a full image rebuild, not just a container restart.

## Non-obvious runtime gotchas

- **`Authentication.getRoles()` returns `Collection<String>`, not `List<String>`.** The Micronaut type is `Collection`; don't assign to `List` in `UserController.java`.
- **Realm imports are `IGNORE_EXISTING` by default.** `--import-realm` seeds an empty Postgres only. To apply a `realm-export.json` edit on a running stack, either `podman compose down -v && up` (wipes everything) or change the live realm via admin API (fast, preserves sessions). Always update both if you want reproducibility.
- **SPI auto-creates realm roles.** `DemoUser.getRoleMappingsInternal()` calls `realm.addRole(name)` if a referenced role is missing, so roles named by SPI records that aren't in `realm-export.json` still work at runtime — but a fresh-DB install would lack them until the first login. Keep BFF-gated role names declared in the JSON too.
- **`defaultRoles` is deprecated in Keycloak 26.** The realm JSON no longer has `"defaultRoles"`; the old effect (every user gets `user`) lived in the `default-roles-demo-realm` composite, from which we removed `user`. Don't add `defaultRoles` back — it won't behave as you expect.
- **Each BFF needs its own Gradle cache.** `./bff/` is bind-mounted into three containers, and Gradle's project cache (`./bff/.gradle/`) takes an exclusive lock. Every BFF service sets `GRADLE_USER_HOME=/tmp/gradle-<x>` and `--project-cache-dir /tmp/gradle-proj-<x>`. If you add a fourth BFF, do the same or it will fail with `Timeout waiting to lock checksums cache`.
- **Gradle build artifacts shared.** `./bff/build/` is also in the bind mount. Stale class files here can survive compile-signature changes and cause puzzling errors; `rm -rf bff/build` before a restart if you hit weird type errors.
- **Keycloak admin API is on port 8888 (not 8080).** Get a token at `/realms/master/protocol/openid-connect/token` with `client_id=admin-cli&grant_type=password&username=admin&password=admin`. Admin endpoints live under `/admin/realms/demo-realm/...`.
- **`keycloak-js` must be ≥ 26.x.** Older versions validate a `nonce` claim that Keycloak 26 no longer emits.

## 2FA gotchas

- **Email OTP runs only on the browser flow.** The realm's `browserFlow` is `demo-browser`, which chains `auth-username-password-form` then `demo-email-otp`. Direct-grant (`grant_type=password`) uses the stock `direct grant` flow and **bypasses OTP** — convenient for `curl` tests, but means the role-matrix script below doesn't exercise the second factor.
- **OTP code lives in `AuthenticationSessionModel` notes.** `EmailOtpAuthenticator` stores `email-otp-code` + `email-otp-expires`; no Postgres schema. If a code expires, `action()` re-enters `authenticate()` and mints a new one in place (user stays on the OTP form).
- **Resend sandbox only delivers to the account owner.** `onboarding@resend.dev` → only the email address registered with the Resend account actually receives. Other addresses return `202 Accepted` from the API but aren't delivered. Mitigation: `EmailOtpAuthenticator.authenticate()` always logs `Email OTP for <email>: NNNNNN (valid 10min)` at INFO, so the demo is usable without inbox delivery (`podman compose logs keycloak | grep "Email OTP"`). Proper fix is to verify a domain at Resend and set `RESEND_FROM` to an address in that domain.
- **Resend token lives in `.envrc` as `RESEND_API_TOKEN`** and is passed through compose into the keycloak container. `ResendClient` reads it via `System.getenv()`; no secret is baked into the image.
- **10-minute validity is for the *code*, not the session.** Once authentication completes, the realm's existing `accessTokenLifespan` / `ssoSessionIdleTimeout` / `ssoSessionMaxLifespan` apply as before. No forced logout at 10 minutes.
- **New `jakarta.ws.rs-api` compile-only dep.** `EmailOtpAuthenticator` imports `jakarta.ws.rs.core.Response` and `MultivaluedMap`; Keycloak's SPI jars don't transitively expose jakarta-ws-rs at compile time, so `build.gradle.kts` declares it. If you build a new authenticator that uses JAX-RS types, the build fails without this dep.
- **Authenticator ID is `demo-email-otp`.** If you rename it in `EmailOtpAuthenticatorFactory.PROVIDER_ID`, update the `"demo-browser forms"` flow in `realm-export.json` to match, or the flow won't load on fresh import.

## Running this on macOS + Podman

The compose CLI talks through a Docker-style socket. Podman uses a different socket path than the machine-default claims:

```bash
export DOCKER_HOST="unix:///var/folders/.../T/podman/podman-machine-default-api.sock"
```

Get the real path with `podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}'`. The `.envrc` has a version of this, but if `podman compose` errors with "Cannot connect to the Docker daemon," export the path directly. Every Bash call that uses `podman compose` in this repo must have `DOCKER_HOST` set.

## Applying changes — what needs what

| Change | Minimum action |
|---|---|
| Frontend (SPA) source | nothing — Vite HMR picks it up |
| BFF source | `podman compose restart bff-<x>` — Gradle incremental recompiles |
| Env var on a service | `podman compose up -d --force-recreate <service>` |
| `docker-compose.yml` structural change | `podman compose up -d` (compose picks up the diff) |
| `keycloak-provider/` SPI source | `podman compose build keycloak && podman compose up -d --force-recreate keycloak` |
| `keycloak/realm-export.json` | takes effect on fresh DB only; otherwise patch the live realm via admin API |
| New realm role needed for a running demo | POST `/admin/realms/demo-realm/roles` with admin token; also add to `realm-export.json` for future fresh installs |
| `EmailOtpAuthenticator` / `ResendClient` source | `podman compose build keycloak && podman compose up -d --force-recreate keycloak` — same as any SPI change |
| Auth flow edit in `realm-export.json` | wipe postgres volume (`down -v`) OR patch live flow via admin API — see note above |

## Testing the role matrix quickly

```bash
# Grab tokens for all three users, then poll each BFF
for u in democlient demouser demoadmin; do
  T=$(curl -s -X POST "http://localhost:8888/realms/demo-realm/protocol/openid-connect/token" \
    -d "client_id=app1-client&grant_type=password&username=$u&password=123" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  for app in "A:8081" "B:8082" "C:8083"; do
    p="${app##*:}"; n="${app%%:*}"
    code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $T" "http://localhost:$p/api/user")
    echo "$u -> App $n : $code"
  done
done
```

Expected: the matrix above. Any deviation means either the BFF env var isn't set or the token roles aren't what you think — decode the JWT payload with `echo "$T" | cut -d. -f2 | base64 -d` to check.

## Commit style

Recent commits use plain prose bodies, no trailers other than `Co-Authored-By: Claude ...`. Prefer one commit per logical change; match the existing style.
