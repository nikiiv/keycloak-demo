# Compromised Credentials — What Happens to a BFF Call?

Какво се случва, ако се направи call към BFF, но креденшълите са
компрометирани. Минавам по слоевете отдолу нагоре — какво ще се случи с
BFF call в всеки сценарий и какво в текущия код го лови (или не).

## Как BFF gate-ва call-а (baseline)

Всеки `/api/...` request към BFF минава през:

1. **Bearer token extraction** — Micronaut security чете
   `Authorization: Bearer <jwt>`.
2. **JWT signature** — валидиран срещу Keycloak JWKS
   (`KEYCLOAK_AUTH_SERVER_URL`). Подменен/подписан с друг ключ → 401.
3. **Issuer + `exp`** — `iss` трябва да съвпада с
   `http://localhost:8888/realms/demo-realm`; expired → 401.
4. **Role gate** — `APP_ALLOWED_ROLES` (env per BFF) се сравнява срещу
   ролите от JWT-то. Не съвпада → 403.
5. **Endpoint logic** — едва тогава `UserController` се изпълнява.

Това е "fail-closed" — всеки от 1-4 връща грешка преди да се stigne до
handler-а.

## Сценарии за "компроментирани креденшъли"

### A) Username + парола изтекли (без 2FA данни)

- Login към Keycloak ще мине стъпка 1 (forms), но **email OTP блокира**
  finalize-ването.
- Attacker трябва **също** да контролира inbox-а на user-а **или** да
  притежава валиден `KC_DEMO_OTP_TRUSTED` cookie.
- BFF никога не вижда такъв request — Keycloak не издава access token.
- **Колко добре сме защитени:** добре, при условие че email-ът не е
  компрометиран и trust cookie window-ът не е активен.

### B) Валиден access token (JWT) изтекъл

- Attacker може да replay-ва токена до `exp` (default
  `accessTokenLifespan` ≈ 5 min).
- BFF ще приеме всеки call — signature е валиден, ролите са в payload-а.
- Може да удари **само BFF-ите, които ролите в токена му разрешават**:
  `client`-only token → 403 от `bff-ops`/`bff-admin`.
- **Никакъв допълнителен gate** — няма IP check, няма device binding
  (DPoP), няма audience check beyond `iss`. Откраднатият токен работи от
  всеки browser, всяка мрежа.
- **Колко добре сме защитени:** слабо. Single point of failure — кратка
  валидност е единствената бариера.

### C) Refresh token изтекъл

- По-лошо от B — attacker може да си minta нови access токени за целия
  refresh window (по подразбиране доста по-дълъг, дни).
- Keycloak refresh token rotation **не е enable-нат** в
  `realm-export.json` (трябва проверка), което означава, че същият refresh
  token може да се ползва многократно.
- **Колко добре сме защитени:** слабо. Тук би помогнало refresh token
  rotation + reuse detection (Keycloak ги поддържа, но не са on by
  default).

### D) Keycloak SSO cookie (`KEYCLOAK_SESSION` / `KEYCLOAK_IDENTITY`) изтекъл

- Attacker може да отиде на `/auth` и да получи нов auth-code без да
  въвежда парола → нови tokens.
- Cookie-то е `HttpOnly` + `Secure` в production правилна настройка, в
  дев е HTTP так че може да се сниф-не.
- **Колко добре сме защитени:** в demo (HTTP) — слабо. Production-side:
  добре, ако HTTPS навсякъде.

### E) OTP trust cookie (`KC_DEMO_OTP_TRUSTED`) изтекъл

- Skip-ва се email OTP стъпката. Комбинирано със сценарий A → пълен
  login.
- Cookie е `HttpOnly` + HMAC-подписан + realm-scoped + `SameSite=Lax`.
- Lax означава, че **не се изпраща** при cross-origin POST/iframe — а
  Keycloak login-ът е redirect (top-level navigation), което Lax го
  пуска. Така че при targeted phishing може да се ползва.
- **Колко добре сме защитени:** средно. Keycloak restart инвалидира
  всички trust cookies (HMAC ключът е process-local), което е грубо но
  ефективно "kill switch".

### F) `user-service` / SPI компрометирани (по-екзотично)

- `UserServiceClient` е **fail-closed** — всеки non-200 връща `false` за
  password verify и `null` за lookup. Така ако нападателят свали
  `user-service`, нищо не може да login-не.
- Но ако нападателят **контролира** `user-service`, той може да върне
  `true` за всеки парола → пълен Keycloak login.
- Mitigation в текущия код: никакъв. `KEYCLOAK_AUTH_SERVER_URL` сочи към
  `user-service:8080` в compose мрежата, plain HTTP, без auth между SPI
  и REST-а.

## Какво **липсва** и би трябвало да се добави за prod

| Защита | Сега | За prod |
|---|---|---|
| HTTPS навсякъде | не (dev HTTP) | задължително |
| Token binding (DPoP / mTLS) | няма | препоръчително |
| Audience check на BFF | вероятно не (трябва проверка в Micronaut config) | задължително |
| Refresh token rotation + reuse detection | не enable-нат | задължително |
| Кратък `accessTokenLifespan` (≤ 5 min) | default | OK |
| Rate limiting на `/auth` и BFF | няма | задължително |
| Anomaly detection (impossible travel, нов device) | няма | за по-висок tier |
| SPI ↔ user-service auth (mTLS или shared secret) | няма | задължително |
| CSP + Subresource Integrity за federation chunks | няма | препоръчително |
| `keycloak-js` token storage в memory only | да | OK (но XSS все още опасен) |

## Кратък отговор за "ако BFF получи compromised call"

- Подписан, неизтекъл, с правилните роли → **BFF ще го обслужи нормално**.
  Той вижда валиден JWT и няма как да различи "истински user" от
  "attacker с откраднат токен".
- Невалиден подпис / expired / грешна роля → **401 / 403** автоматично.
- Token подписан от чужд IdP / друг realm → **401** (issuer mismatch).
- Token с роля `client` срещу `bff-admin` → **403**.

Това е по същество модел на "bearer токен е носител на доверие" —
стандартното OIDC поведение. По-силна защита изисква token binding
(DPoP) или mTLS, които не са в обхвата на демото. Подробният security
audit и какво трябва за prod е в [`LOGIN.md`](./LOGIN.md).
