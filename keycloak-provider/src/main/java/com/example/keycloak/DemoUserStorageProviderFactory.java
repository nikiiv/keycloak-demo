package com.example.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProviderFactory;

public class DemoUserStorageProviderFactory implements UserStorageProviderFactory<DemoUserStorageProvider> {

    private static final Logger LOG = Logger.getLogger(DemoUserStorageProviderFactory.class);

    public static final String PROVIDER_ID = "demo-user-provider";

    @Override
    public DemoUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        LOG.info("Creating DemoUserStorageProvider");
        return new DemoUserStorageProvider(session, model);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getHelpText() {
        return "Demo user storage provider with hardcoded users (demoadmin, demouser).";
    }
}
