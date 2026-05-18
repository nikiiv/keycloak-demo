package com.example.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProviderFactory;

public class DemoUserStorageProviderFactory implements UserStorageProviderFactory<DemoUserStorageProvider> {

    private static final Logger LOG = Logger.getLogger(DemoUserStorageProviderFactory.class);

    public static final String PROVIDER_ID = "demo-user-provider";

    private static final String CONFIG_KEY = "userServiceUrl";
    private static final String ENV_KEY = "USER_SERVICE_URL";
    private static final String DEFAULT_URL = "http://user-service:8080";

    @Override
    public DemoUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        String baseUrl = resolveBaseUrl(model);
        LOG.infof("Creating DemoUserStorageProvider (user-service: %s)", baseUrl);
        return new DemoUserStorageProvider(session, model, new UserServiceClient(baseUrl));
    }

    /** Precedence: component config → USER_SERVICE_URL env var → default. */
    private String resolveBaseUrl(ComponentModel model) {
        if (model != null && model.getConfig() != null) {
            String configured = model.getConfig().getFirst(CONFIG_KEY);
            if (configured != null && !configured.isBlank()) {
                return configured.trim();
            }
        }
        String env = System.getenv(ENV_KEY);
        if (env != null && !env.isBlank()) {
            return env.trim();
        }
        return DEFAULT_URL;
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getHelpText() {
        return "Demo user storage provider backed by the standalone user-service REST API.";
    }
}
