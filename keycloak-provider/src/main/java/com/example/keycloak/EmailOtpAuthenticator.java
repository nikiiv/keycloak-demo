package com.example.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;

import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;

public class EmailOtpAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(EmailOtpAuthenticator.class);

    static final String OTP_NOTE = "email-otp-code";
    static final String EXPIRES_NOTE = "email-otp-expires";
    static final long VALIDITY_MS = 10L * 60 * 1000;

    // When a user completes OTP, we drop a signed cookie scoped to the realm
    // so the next login can skip the email step until the window expires.
    // Defaults to 60 minutes; override with OTP_TRUST_WINDOW_MINUTES.
    static final String TRUST_COOKIE = "KC_DEMO_OTP_TRUSTED";
    static final long DEFAULT_TRUST_MINUTES = 60;

    private static final SecureRandom RNG = new SecureRandom();

    // HMAC key lives only in memory — restart Keycloak and every outstanding
    // trust cookie is invalidated. Fine for a demo; a real deployment would
    // source this from a stable secret.
    private static final byte[] HMAC_KEY = generateKey();

    private static byte[] generateKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        UserModel user = context.getUser();
        if (user == null) {
            context.failure(AuthenticationFlowError.UNKNOWN_USER);
            return;
        }
        String email = user.getEmail();
        if (email == null || email.isBlank()) {
            LOG.warnf("User %s has no email; cannot send OTP", user.getUsername());
            context.failure(AuthenticationFlowError.INVALID_USER);
            return;
        }

        if (hasValidTrustCookie(context, user.getId())) {
            LOG.infof("OTP trust cookie valid for %s; skipping email step", user.getUsername());
            context.success();
            return;
        }

        String code = String.format("%06d", RNG.nextInt(1_000_000));
        long expires = System.currentTimeMillis() + VALIDITY_MS;

        AuthenticationSessionModel auth = context.getAuthenticationSession();
        auth.setAuthNote(OTP_NOTE, code);
        auth.setAuthNote(EXPIRES_NOTE, Long.toString(expires));

        // Log the code in a visually unmistakable banner so it can be spotted
        // instantly in `podman compose logs keycloak | grep -A4 OTP` when
        // Resend delivery is slow (or not delivering at all — sandbox caveat).
        LOG.info(String.format(
                "%n" +
                "╔══════════════════════ EMAIL OTP ══════════════════════╗%n" +
                "║  code  :  %-44s║%n" +
                "║  email :  %-44s║%n" +
                "║  valid :  10 minutes                                   ║%n" +
                "╚════════════════════════════════════════════════════════╝",
                code, email));

        try {
            ResendClient.send(email,
                    "Your demo-realm login code",
                    "<p>Your code: <b style=\"font-size:1.4em;letter-spacing:0.15em\">" + code + "</b></p>"
                            + "<p>Valid for 10 minutes.</p>");
        } catch (Exception e) {
            LOG.warnf(e, "Resend delivery failed for %s; code is in Keycloak logs", email);
        }

        Response challenge = context.form().createForm("email-otp.ftl");
        context.challenge(challenge);
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> form = context.getHttpRequest().getDecodedFormParameters();
        String entered = form.getFirst("otp");

        AuthenticationSessionModel auth = context.getAuthenticationSession();
        String expected = auth.getAuthNote(OTP_NOTE);
        long expires = Long.parseLong(Optional.ofNullable(auth.getAuthNote(EXPIRES_NOTE)).orElse("0"));

        if (expected == null || System.currentTimeMillis() > expires) {
            LOG.infof("OTP expired or missing for %s; re-issuing", context.getUser().getUsername());
            auth.removeAuthNote(OTP_NOTE);
            auth.removeAuthNote(EXPIRES_NOTE);
            authenticate(context);
            return;
        }

        String cleaned = entered == null ? "" : entered.trim();
        if (!expected.equals(cleaned)) {
            Response challenge = context.form()
                    .setError("Invalid code. Please try again.")
                    .createForm("email-otp.ftl");
            context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, challenge);
            return;
        }

        auth.removeAuthNote(OTP_NOTE);
        auth.removeAuthNote(EXPIRES_NOTE);
        issueTrustCookie(context, context.getUser().getId(), context.getUser().getUsername());
        context.success();
    }

    @Override
    public boolean requiresUser() {
        return true;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }

    // -------- trust cookie helpers --------

    private long trustWindowMinutes() {
        String env = System.getenv("OTP_TRUST_WINDOW_MINUTES");
        if (env == null || env.isBlank()) return DEFAULT_TRUST_MINUTES;
        try {
            return Math.max(0, Long.parseLong(env.trim()));
        } catch (NumberFormatException e) {
            LOG.warnf("Invalid OTP_TRUST_WINDOW_MINUTES=%s; falling back to %d", env, DEFAULT_TRUST_MINUTES);
            return DEFAULT_TRUST_MINUTES;
        }
    }

    private boolean hasValidTrustCookie(AuthenticationFlowContext ctx, String userId) {
        Map<String, Cookie> cookies = ctx.getHttpRequest().getHttpHeaders().getCookies();
        Cookie cookie = cookies == null ? null : cookies.get(TRUST_COOKIE);
        if (cookie == null) return false;

        String[] parts = cookie.getValue().split("\\.", 3);
        if (parts.length != 3) return false;

        String cookieUserId;
        long expiresAt;
        try {
            cookieUserId = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            expiresAt = Long.parseLong(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }

        String expectedHmac = computeHmac(cookieUserId + "." + expiresAt);
        if (!constantTimeEquals(expectedHmac, parts[2])) return false;
        if (!cookieUserId.equals(userId)) return false;
        return System.currentTimeMillis() <= expiresAt;
    }

    private void issueTrustCookie(AuthenticationFlowContext ctx, String userId, String username) {
        long windowMin = trustWindowMinutes();
        if (windowMin <= 0) {
            LOG.infof("OTP_TRUST_WINDOW_MINUTES=0; not issuing trust cookie for %s", username);
            return;
        }
        long expiresAt = System.currentTimeMillis() + windowMin * 60_000L;
        String hmac = computeHmac(userId + "." + expiresAt);

        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(userId.getBytes(StandardCharsets.UTF_8))
                + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(Long.toString(expiresAt).getBytes(StandardCharsets.UTF_8))
                + "." + hmac;

        long maxAgeSec = windowMin * 60;
        String realmName = ctx.getRealm().getName();
        String cookieHeader = String.format(
                "%s=%s; Path=/realms/%s/; Max-Age=%d; HttpOnly; SameSite=Lax",
                TRUST_COOKIE, value, realmName, maxAgeSec);

        ctx.getSession().getContext().getHttpResponse().addHeader("Set-Cookie", cookieHeader);
        LOG.infof("Issued OTP trust cookie for %s, valid %d minute(s)", username, windowMin);
    }

    private static String computeHmac(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(HMAC_KEY, "HmacSHA256"));
            byte[] out = mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC computation failed", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) {
            r |= a.charAt(i) ^ b.charAt(i);
        }
        return r == 0;
    }
}
