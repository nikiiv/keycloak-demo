package com.example.keycloak;

import com.example.keycloak.client.api.UsersApi;
import com.example.keycloak.client.invoker.ApiClient;
import com.example.keycloak.client.invoker.ApiException;
import com.example.keycloak.client.model.User;
import com.example.keycloak.client.model.VerifyCredentialsRequest;
import com.example.keycloak.client.model.VerifyCredentialsResponse;
import org.jboss.logging.Logger;

import java.util.HashSet;
import java.util.List;

/**
 * Thin wrapper around the OpenAPI-generated REST client. Translates the
 * generated API into the small surface the SPI needs and applies the
 * availability policy:
 *
 * <ul>
 *   <li>lookups: 404 or any error → {@code null} ("no such user")</li>
 *   <li>verify: any error / non-200 → {@code false} (<b>fail closed</b> — never
 *       authenticate when the user store is unreachable)</li>
 * </ul>
 */
public class UserServiceClient {

    private static final Logger LOG = Logger.getLogger(UserServiceClient.class);

    private final UsersApi api;

    public UserServiceClient(String baseUrl) {
        ApiClient apiClient = new ApiClient();
        apiClient.updateBaseUri(baseUrl);
        this.api = new UsersApi(apiClient);
        LOG.infof("UserServiceClient targeting %s", baseUrl);
    }

    public DemoUserStorageProvider.DemoUserRecord findByUsername(String username) {
        try {
            return toRecord(api.getUserByUsername(username));
        } catch (ApiException e) {
            if (e.getCode() != 404) {
                LOG.warnf("getUserByUsername(%s) failed: HTTP %d", username, e.getCode());
            }
            return null;
        } catch (RuntimeException e) {
            LOG.warnf(e, "getUserByUsername(%s) failed", username);
            return null;
        }
    }

    public DemoUserStorageProvider.DemoUserRecord findByEmail(String email) {
        try {
            return toRecord(api.getUserByEmail(email));
        } catch (ApiException e) {
            if (e.getCode() != 404) {
                LOG.warnf("getUserByEmail(%s) failed: HTTP %d", email, e.getCode());
            }
            return null;
        } catch (RuntimeException e) {
            LOG.warnf(e, "getUserByEmail(%s) failed", email);
            return null;
        }
    }

    public boolean verifyCredentials(String username, String password) {
        try {
            VerifyCredentialsResponse resp = api.verifyCredentials(
                    new VerifyCredentialsRequest().username(username).password(password));
            return resp != null && Boolean.TRUE.equals(resp.getValid());
        } catch (ApiException | RuntimeException e) {
            // Fail closed: a store that is down must not authenticate anyone.
            LOG.warnf(e, "verifyCredentials(%s) failed; denying", username);
            return false;
        }
    }

    private static DemoUserStorageProvider.DemoUserRecord toRecord(User u) {
        if (u == null) {
            return null;
        }
        List<String> roles = u.getRoles() != null ? u.getRoles() : List.of();
        // The lookup response intentionally carries no password; credentials go
        // through verifyCredentials, so a placeholder is safe and never read.
        return new DemoUserStorageProvider.DemoUserRecord(
                u.getUsername(), "", u.getEmail(), u.getFirstName(), u.getLastName(),
                new HashSet<>(roles));
    }
}
