package com.example.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.security.SecureRandom;
import java.util.Optional;

public class EmailOtpAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(EmailOtpAuthenticator.class);

    static final String OTP_NOTE = "email-otp-code";
    static final String EXPIRES_NOTE = "email-otp-expires";
    static final long VALIDITY_MS = 10L * 60 * 1000;

    private static final SecureRandom RNG = new SecureRandom();

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

        String code = String.format("%06d", RNG.nextInt(1_000_000));
        long expires = System.currentTimeMillis() + VALIDITY_MS;

        AuthenticationSessionModel auth = context.getAuthenticationSession();
        auth.setAuthNote(OTP_NOTE, code);
        auth.setAuthNote(EXPIRES_NOTE, Long.toString(expires));

        LOG.infof("Email OTP for %s: %s (valid 10min)", email, code);

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
}
