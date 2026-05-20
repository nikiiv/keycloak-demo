# MFE Repo & Deployment Strategy

Анализ на четирите въпроса около разделяне на MFE-та, независим деплой,
поли- vs моно-репо и собствени домейни. Базиран на текущото състояние на
кода (`apps/shell`, `apps/mfe-*`, `packages/shell-api`, `docker-compose.yml`).

## 1) Може ли всеки MFE да се извади в отделно репо?

**Да, технически архитектурата вече е готова за това.** Module Federation е
built specifically за този сценарий — шелът зарежда `remoteEntry.js` от URL
по време на runtime, а не по време на build. Конкретните точки на свързване
в текущия код:

- `apps/shell/vite.config.ts:8-10` — URL-ите към `mfeClient/mfeOps/mfeAdmin`
  идват от env vars (`VITE_MFE_*_URL`). Сменяш URL → шелът автоматично тегли
  от новото място. Не е нужно шелът да знае откъде идва кодът, само URL-а.
- `apps/shell/src/components/MfeOutlet.tsx:8-10` —
  `lazy(() => import('mfeClient/Mfe'))` се транслира на runtime fetch, не на
  bundle-time import. MFE-то може да живее на чужд сървър, чуждо репо, чужд
  cloud account.
- `packages/shell-api/src/index.ts` — единственият контракт между шел и MFE.
  Това е TypeScript-only пакет, който трябва да се публикува (npm registry,
  GitHub Packages, или вътрешен Verdaccio) преди извличането, за да го
  консумират и шелът, и трите MFE репота.

**Какво трябва да се направи при разделяне:**

1. Изваждаш `packages/shell-api` в отделно репо или го публикуваш като
   versioned npm package (напр. `@yourorg/shell-api@1.0.0`).
2. Всеки MFE репо държи свой `package.json`, `vite.config.ts`, Dockerfile,
   CI/CD.
3. Шел репото оставя само `apps/shell` + неговите конфиги; remote URL-ите
   идват от env (вече така е).
4. Споделените deps в `federation({ shared: [...] })` — `react`,
   `react-dom`, `react-router-dom`, `@tanstack/react-query` — версиите им
   стават **версионен контракт между репата**. Не може едно репо да
   upgrade-не React на 19, докато другите са на 18; ще има два React
   instance-а и hook-овете гръмват.

**Какво ще ти струва:**

- Контрактна дисциплина — `shell-api` става SemVer-нат пакет, breaking
  change значи мажорна версия + координация с всички MFE репа.
- Споделени версии (React и сем-ството му) трябва да се управляват като
  cross-repo invariant. Renovate/Dependabot правила или scheduled
  "version-bump party" дни.
- Загубваш atomic refactor — преименуваш ли `MfeProps` в `shell-api`, става
  в 4+ PR-а в 4+ репа, не в един commit.

## 2) В съществуващото монорепо — независим деплой и веднага в сила

**Да, и това вече е така в production-режима.** Цялата `docker-compose.yml`
е написана точно с тази цел — седем независими имиджа, всеки със своя
жизнен цикъл:

| Промяна | Какво се рестартира | Време до ефект |
|---|---|---|
| `apps/shell/src/**` | нищо — HMR | ~1s |
| `apps/mfe-X/src/**` | `--force-recreate mfe-X` (или `--dev` режим за watch+build) | 1-2s в `--dev`, 5-10s демо режим |
| `bff/src/**` (един BFF) | `--build --force-recreate bff-X` | ~15s |
| `bff/src/**` (host dev) | `./dev-bff.sh ops` — Gradle continuous rebuild | ~3s |

Това вече работи в репото — виж таблицата в `CLAUDE.md` "Applying changes
— what needs what" и `./start.sh --dev` / `./dev-bff.sh`. Federation плюс
`vite preview` гарантират, че при рекреиране на един MFE контейнер шелът
просто фетчва новия `remoteEntry.js` при следващото зареждане без рестарт
на шела.

**Production вариант на същото:** всеки имидж зад своя deploy pipeline
(GitHub Actions matrix per workspace, или separate Argo apps в Kubernetes).
Pipeline-и тригерват се само ако `paths:` филтърът хитне
(`frontend/apps/mfe-ops/**` → deploy mfe-ops). Шелът остава непроменен;
cache busting на `remoteEntry.js` става с content hash или version query
string.

## 3) Добре ли е да се отделят проектите в отделни репота?

**Зависи от размера на екипа и темпото на промените.** Това е класически
monorepo-vs-polyrepo tradeoff.

**Поли-репо има смисъл, когато:**

- Различни екипи owner-стват различни MFE-та с минимално cross-team
  координиране.
- Cycle time на CI/CD пада значимо (по-малък lockfile, по-малък test set).
- Compliance/security изисквания налагат различни access controls (напр.
  payment екипът трябва да е изолиран).
- Скоростта на промените в един MFE е драстично различна (mfe-admin прави
  release веднъж в месец, mfe-client два пъти на ден).

**Монорепото е по-добро, когато:**

- Един екип (или 2-3 близки) поддържа всичко.
- Често правиш cross-cutting промени (`shell-api` контракт + всички MFE
  едновременно).
- Искаш atomic PR-и и един source of truth за версии.
- Tooling екипът ти е малък — поддръжката на 7 CI pipeline-а вместо 1 е
  реална тежест.

**Конкретно за тази архитектура моята препоръка:** остани в монорепо
докато екипите не са физически различни. Текущата структура (workspaces +
per-service Dockerfile + per-service compose entry) вече ти дава 90% от
ползите на поли-репо (независим деплой, изолиран failure domain) без data
на поли-репо overhead. Когато на даден екип започне да му пречи, че чужд
PR му счупва CI или чужд lockfile му bump-ва deps — тогава extract-ваш
този MFE сам. Federation е специално създаден да позволи това
**постепенно**, не като big-bang миграция.

## 4) Собствен домейн (billing.company.com, reporting.company.com, и т.н.)?

**Да, и това е архитектурно правилното за production.** Federation работи
cross-origin от proba — CORS-ът вече е activated в `vite.config.ts`
(`cors: true` в preview блока), а `allowedHosts` в шела е лесно за
разширяване.

**Аргументи "за":**

- **Cache изолация** — `billing.company.com/assets/remoteEntry.js` cache-се
  независимо от `reporting.company.com`. Различни CDN edges, различни TTL
  стратегии.
- **Независим scaling** — `billing` е trafic-heavy → отделен CDN/origin без
  да touch-ваш `reporting`.
- **Security boundary** — CSP можеш да го стегнеш per-domain. Compromise на
  reporting subdomain не дава директен JS access до billing.
- **Org structure mirror** — DNS-ът отразява собствеността (`team-billing`
  owner-ства `billing.*`), което прави incident response по-лесен.
- **Observability** — отделни metrics, logs, error budgets per domain.
  Лесно се filter-ва в Grafana/Sentry по hostname.

**Какво трябва да помислиш:**

- **CORS + cookies** — ако MFE-тата ползват session cookies към своите
  BFF-та през Shell-я, нужни са `SameSite=None; Secure` и точни
  `Access-Control-Allow-Origin` listing. С Bearer токени (както е сега в
  репото) проблемът отпада.
- **SSO redirect URI-та** — Keycloak realm трябва да позволи всички
  origin-и в `webOrigins` и `redirectUris` на `mfe-shell-client`. В
  текущата конфигурация шелът е единственият OIDC consumer, така че се
  добавя само shell домейнът; MFE-тата нямат собствен OIDC client.
- **`shell-api` версии в production** — при cross-domain federation, ако
  шелът е на v1.2 а billing MFE е bundled срещу `shell-api` v1.1, runtime
  ще се счупи мълчаливо. Лекарство: версионирай контракта и валидирай при
  mount (`host.apiVersion === '1.2'` check).
- **Cross-origin federation peculiarity** — `import('billing/Mfe')` под
  капака прави `<script>` инжекция; ако се хитне на
  `Content-Security-Policy: script-src 'self'` ще се счупи. CSP трябва да
  изброи всички MFE origin-и.

**Препоръка:** да, направи го с поддомейни на същия root домейн
(`*.company.com`), не с напълно различни домейни. Това ти позволява да
споделяш wildcard SSL, да правиш cookie-based auth, ако някога потрябва, и
опростява CSP-то. Идеалната топология:

```
app.company.com           — shell
mfe.billing.company.com   — billing MFE bundle
mfe.reporting.company.com — reporting MFE bundle
api.billing.company.com   — billing BFF
api.reporting.company.com — reporting BFF
auth.company.com          — Keycloak
```

## Резюме

- **Технически може и трите** — отделни репа, независим деплой в
  монорепото, отделни домейни. Архитектурата от стартъ е федеративна.
- **Започни с монорепо + независим деплой + поддомейни** — това вече го
  имаш в кода. Поли-репо го прави когато имаш реален екип-bottleneck, не
  на принцип.
- **Версионирай `shell-api`** като първа стъпка към poly-repo бъдещето,
  дори да не extract-ваш веднага. Това е критичното inflection point —
  без версионен контракт, разделянето на репа е мъчително.
