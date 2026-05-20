# MFE Repo & Deployment Strategy

Analysis of four questions about splitting MFEs, independent deploys,
poly-repo vs monorepo trade-offs, and per-MFE subdomains. Grounded in the
current state of the code (`apps/shell`, `apps/mfe-*`, `packages/shell-api`,
`docker-compose.yml`).

## 1) Can each MFE be moved into its own repo?

**Yes — the architecture is already wired for it.** Module Federation
was built for exactly this scenario: the shell fetches `remoteEntry.js`
from a URL at runtime, not at build time. The concrete coupling points
in the current code:

- `apps/shell/vite.config.ts:8-10` — the URLs for `mfeClient/mfeOps/mfeAdmin`
  come from env vars (`VITE_MFE_*_URL`). Change the URL → the shell
  fetches from the new location. The shell doesn't need to know *where*
  the code lives, only the URL.
- `apps/shell/src/components/MfeOutlet.tsx:8-10` —
  `lazy(() => import('mfeClient/Mfe'))` is rewritten by the federation
  plugin into a runtime fetch, not a bundle-time import. The MFE can live
  on someone else's server, in someone else's repo, in someone else's
  cloud account.
- `packages/shell-api/src/index.ts` — the single contract between shell
  and MFE. A TypeScript-only package that has to be **published**
  (npm registry, GitHub Packages, or an internal Verdaccio) before any
  extraction, so both the shell and the three MFE repos can consume the
  same version.

**What the split actually requires:**

1. Extract `packages/shell-api` into its own repo or publish it as a
   versioned npm package (e.g. `@yourorg/shell-api@1.0.0`).
2. Each MFE repo carries its own `package.json`, `vite.config.ts`,
   Dockerfile, CI/CD pipeline.
3. The shell repo keeps just `apps/shell` and its configs; remote URLs
   come from env (already the case).
4. The shared deps in `federation({ shared: [...] })` — `react`,
   `react-dom`, `react-router-dom`, `@tanstack/react-query` — become a
   **versioned contract across repos**. One repo can't upgrade to React
   19 while the others are on 18 — you'd get two React instances and
   hooks would break.

**What the split costs you:**

- Contract discipline. `shell-api` becomes a SemVer-versioned package;
  a breaking change is a major version plus coordination across every
  MFE repo.
- Shared versions (React and its family) have to be managed as a
  cross-repo invariant. Renovate/Dependabot policies, or scheduled
  "version-bump party" days.
- You lose atomic refactors. Renaming `MfeProps` in `shell-api` becomes
  4+ PRs across 4+ repos instead of a single commit.

## 2) Independent per-service deploys from the current monorepo

**Yes — and that's already the production-style model today.** The whole
`docker-compose.yml` is written for exactly this: seven independent
images, each with its own lifecycle:

| Change | What gets recreated | Time to effect |
|---|---|---|
| `apps/shell/src/**` | nothing — HMR | ~1s |
| `apps/mfe-X/src/**` | `--force-recreate mfe-X` (or `--dev` mode for watch+build) | 1-2s in `--dev`, 5-10s in demo mode |
| `bff/src/**` (one BFF) | `--build --force-recreate bff-X` | ~15s |
| `bff/src/**` (host dev) | `./dev-bff.sh ops` — Gradle continuous rebuild | ~3s |

This already works in the repo — see the `CLAUDE.md` table "Applying
changes — what needs what" and `./start.sh --dev` / `./dev-bff.sh`.
Federation plus `vite preview` mean that when you recreate one MFE
container the shell simply fetches the new `remoteEntry.js` on the next
load, with no shell restart.

**The production form of the same idea:** each image behind its own
deploy pipeline (a GitHub Actions matrix per workspace, or separate Argo
apps in Kubernetes). Pipelines fire only when their `paths:` filter
matches (`frontend/apps/mfe-ops/**` → deploy `mfe-ops`). The shell stays
untouched; cache-busting on `remoteEntry.js` is done with a content hash
or a version query string.

## 3) Is it a good idea to split the projects across separate repos?

**It depends on team size and rate of change.** This is the classic
monorepo-vs-polyrepo trade-off.

**Poly-repo makes sense when:**

- Different teams own different MFEs with minimal cross-team
  coordination.
- CI/CD cycle time drops significantly (smaller lockfile, smaller test
  set).
- Compliance/security requirements demand different access controls
  (e.g. the payments team has to stay isolated).
- The change rate per MFE diverges drastically (`mfe-admin` releases
  once a month, `mfe-client` twice a day).

**A monorepo is better when:**

- One team (or 2-3 closely-collaborating teams) owns everything.
- Cross-cutting changes happen often (`shell-api` contract + all MFEs
  in one go).
- You want atomic PRs and a single source of truth for versions.
- Your tooling team is small — running 7 CI pipelines instead of 1 is
  a real maintenance load.

**My recommendation for this architecture specifically:** stay in the
monorepo until the teams actually become physically separate. The
current structure (workspaces + per-service Dockerfile + per-service
compose entry) already gives you 90% of the poly-repo benefits
(independent deploys, isolated failure domains) without the poly-repo
overhead. When a team starts feeling the friction — someone else's PR
breaks their CI, someone else's lockfile bumps their deps — extract
*that* MFE alone. Federation was built to let this happen
**incrementally**, not as a big-bang migration.

## 4) Per-MFE subdomain (billing.company.com, reporting.company.com, …)?

**Yes — and it's the architecturally right move for production.**
Federation works cross-origin by design — CORS is already enabled in
`vite.config.ts` (`cors: true` in the preview block) and `allowedHosts`
on the shell is easy to extend.

**Arguments for:**

- **Cache isolation** — `billing.company.com/assets/remoteEntry.js`
  caches independently of `reporting.company.com`. Different CDN edges,
  different TTL strategies.
- **Independent scaling** — `billing` is traffic-heavy → its own
  CDN/origin without touching `reporting`.
- **Security boundary** — CSP can be tightened per domain. A compromise
  of the `reporting` subdomain doesn't give direct JS access to
  `billing`.
- **Org structure mirror** — DNS reflects ownership (`team-billing` owns
  `billing.*`), which makes incident response easier.
- **Observability** — separate metrics, logs, error budgets per domain.
  Easy to filter by hostname in Grafana/Sentry.

**Things to think about:**

- **CORS + cookies** — if MFEs talk to their own BFFs with session
  cookies through the shell, you need `SameSite=None; Secure` and exact
  `Access-Control-Allow-Origin` listings. With Bearer tokens (what the
  repo does today) the problem goes away.
- **SSO redirect URIs** — the Keycloak realm has to allow every origin
  in the `webOrigins` and `redirectUris` of `mfe-shell-client`. In the
  current setup the shell is the only OIDC consumer, so only the shell
  domain needs to be added; MFEs don't have their own OIDC client.
- **`shell-api` versions in production** — with cross-domain federation,
  if the shell is on v1.2 but the billing MFE was bundled against
  `shell-api` v1.1, things break silently at runtime. Cure: version the
  contract and validate at mount (`host.apiVersion === '1.2'` check).
- **Cross-origin federation peculiarity** — `import('billing/Mfe')`
  internally injects a `<script>`; if a strict
  `Content-Security-Policy: script-src 'self'` is in place it breaks.
  The CSP has to list every MFE origin.

**Recommendation:** yes, do it — but with subdomains of the same root
domain (`*.company.com`), not fully separate domains. That lets you
share a wildcard SSL cert, gives you cookie-based auth if you ever need
it, and simplifies the CSP. The ideal topology:

```
app.company.com           — shell
mfe.billing.company.com   — billing MFE bundle
mfe.reporting.company.com — reporting MFE bundle
api.billing.company.com   — billing BFF
api.reporting.company.com — reporting BFF
auth.company.com          — Keycloak
```

## Summary

- **All three are technically doable** — separate repos, independent
  deploys from the monorepo, separate domains. The architecture has
  been federated from the start.
- **Start with monorepo + independent deploys + subdomains** — you
  already have that in the code. Move to poly-repo only when you have a
  real team-level bottleneck, not on principle.
- **Version `shell-api`** as the first step toward a poly-repo future,
  even if you don't extract anything immediately. That's the critical
  inflection point — without a versioned contract, splitting repos is
  painful.
