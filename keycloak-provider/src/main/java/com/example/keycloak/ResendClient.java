package com.example.keycloak;

import org.jboss.logging.Logger;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.Optional;

public final class ResendClient {

    private static final Logger LOG = Logger.getLogger(ResendClient.class);
    private static final String ENDPOINT = "https://api.resend.com/emails";
    private static final String DEFAULT_FROM = "Demo Realm <onboarding@resend.dev>";

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private ResendClient() {
    }

    public static void send(String to, String subject, String html) throws IOException, InterruptedException {
        String token = System.getenv("RESEND_API_TOKEN");
        if (token == null || token.isBlank()) {
            // Benign: no token configured, run in log-only mode. The authenticator has
            // already printed the OTP banner, so this is the expected fallback path.
            LOG.infof("RESEND_API_TOKEN not set; skipping email delivery to %s (code is in the log banner above)", to);
            return;
        }
        String from = Optional.ofNullable(System.getenv("RESEND_FROM"))
                .filter(s -> !s.isBlank())
                .orElse(DEFAULT_FROM);

        String body = "{"
                + "\"from\":"    + jsonStr(from)    + ","
                + "\"to\":["     + jsonStr(to)      + "],"
                + "\"subject\":" + jsonStr(subject) + ","
                + "\"html\":"    + jsonStr(html)
                + "}";

        HttpRequest req = HttpRequest.newBuilder(URI.create(ENDPOINT))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> resp = HTTP.send(req, BodyHandlers.ofString());
        if (resp.statusCode() >= 300) {
            throw new IOException("Resend " + resp.statusCode() + ": " + resp.body());
        }
        LOG.debugf("Resend accepted email to %s: %s", to, resp.body());
    }

    private static String jsonStr(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }
}
