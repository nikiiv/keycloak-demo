package com.example.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.component.ComponentModel;
import org.keycloak.credential.CredentialInput;
import org.keycloak.credential.CredentialInputValidator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.credential.PasswordCredentialModel;
import org.keycloak.storage.StorageId;
import org.keycloak.storage.UserStorageProvider;
import org.keycloak.storage.user.UserLookupProvider;

import java.util.Map;
import java.util.Set;

public class DemoUserStorageProvider
        implements UserStorageProvider, UserLookupProvider, CredentialInputValidator {

    private static final Logger LOG = Logger.getLogger(DemoUserStorageProvider.class);

    static final Map<String, DemoUserRecord> USERS = Map.of(
            "demoadmin", new DemoUserRecord("demoadmin", "123", "demoadmin@example.com", "Demo", "Admin", Set.of("admin", "user")),
            "demouser",  new DemoUserRecord("demouser",  "123", "demouser@example.com",  "Demo", "User",  Set.of("user"))
    );

    private final KeycloakSession session;
    private final ComponentModel model;

    public DemoUserStorageProvider(KeycloakSession session, ComponentModel model) {
        this.session = session;
        this.model = model;
    }

    @Override
    public void close() {
    }

    @Override
    public UserModel getUserById(RealmModel realm, String id) {
        LOG.infof("getUserById called with id: %s", id);
        return getUserByUsername(realm, StorageId.externalId(id));
    }

    @Override
    public UserModel getUserByUsername(RealmModel realm, String username) {
        LOG.infof("getUserByUsername called with username: %s", username);
        DemoUserRecord record = USERS.get(username);
        if (record == null) {
            LOG.infof("User not found: %s", username);
            return null;
        }
        LOG.infof("User found: %s", username);
        return new DemoUser(session, realm, model, record);
    }

    @Override
    public UserModel getUserByEmail(RealmModel realm, String email) {
        return null;
    }

    @Override
    public boolean supportsCredentialType(String credentialType) {
        return PasswordCredentialModel.TYPE.equals(credentialType);
    }

    @Override
    public boolean isConfiguredFor(RealmModel realm, UserModel user, String credentialType) {
        return supportsCredentialType(credentialType);
    }

    @Override
    public boolean isValid(RealmModel realm, UserModel user, CredentialInput input) {
        LOG.infof("isValid called for user: %s, credentialType: %s", user.getUsername(), input.getType());
        if (!supportsCredentialType(input.getType())) {
            return false;
        }
        DemoUserRecord record = USERS.get(user.getUsername());
        boolean valid = record != null && record.password().equals(input.getChallengeResponse());
        LOG.infof("isValid result for %s: %s", user.getUsername(), valid);
        return valid;
    }

    public record DemoUserRecord(String username, String password, String email, String firstName, String lastName, Set<String> roles) {
    }
}
