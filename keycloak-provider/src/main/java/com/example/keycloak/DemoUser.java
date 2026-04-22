package com.example.keycloak;

import org.keycloak.common.util.MultivaluedHashMap;
import org.keycloak.component.ComponentModel;
import org.keycloak.credential.UserCredentialManager;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.SubjectCredentialManager;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserModel.RequiredAction;
import org.keycloak.storage.adapter.AbstractUserAdapter;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class DemoUser extends AbstractUserAdapter {

    private final DemoUserStorageProvider.DemoUserRecord record;

    public DemoUser(KeycloakSession session, RealmModel realm, ComponentModel storageProviderModel,
                    DemoUserStorageProvider.DemoUserRecord record) {
        super(session, realm, storageProviderModel);
        this.record = record;
    }

    @Override
    public String getUsername() {
        return record.username();
    }

    @Override
    public String getEmail() {
        return record.email();
    }

    @Override
    public String getFirstName() {
        return record.firstName();
    }

    @Override
    public String getLastName() {
        return record.lastName();
    }

    @Override
    public boolean isEmailVerified() {
        return true;
    }

    @Override
    public Map<String, List<String>> getAttributes() {
        MultivaluedHashMap<String, String> attrs = new MultivaluedHashMap<>();
        attrs.add(UserModel.USERNAME, getUsername());
        attrs.add(UserModel.EMAIL, getEmail());
        attrs.add(UserModel.FIRST_NAME, getFirstName());
        attrs.add(UserModel.LAST_NAME, getLastName());
        return attrs;
    }

    @Override
    public Stream<String> getAttributeStream(String name) {
        List<String> values = getAttributes().get(name);
        return values == null ? Stream.empty() : values.stream();
    }

    // Writes are silently ignored — the SPI is a read-only demo source.
    @Override public void setUsername(String username) {}
    @Override public void setEmail(String email) {}
    @Override public void setFirstName(String firstName) {}
    @Override public void setLastName(String lastName) {}
    @Override public void setEmailVerified(boolean verified) {}
    @Override public void setEnabled(boolean enabled) {}
    @Override public void setCreatedTimestamp(Long timestamp) {}
    @Override public void setSingleAttribute(String name, String value) {}
    @Override public void setAttribute(String name, List<String> values) {}
    @Override public void removeAttribute(String name) {}
    @Override public void addRequiredAction(String action) {}
    @Override public void removeRequiredAction(String action) {}
    @Override public void addRequiredAction(RequiredAction action) {}
    @Override public void removeRequiredAction(RequiredAction action) {}

    @Override
    public SubjectCredentialManager credentialManager() {
        return new UserCredentialManager(session, realm, this);
    }

    @Override
    protected Set<RoleModel> getRoleMappingsInternal() {
        // Auto-create missing realm roles so the demo works on a fresh realm.
        return record.roles().stream()
                .map(name -> {
                    RoleModel role = realm.getRole(name);
                    return role != null ? role : realm.addRole(name);
                })
                .collect(Collectors.toSet());
    }
}
