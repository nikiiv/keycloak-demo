import Keycloak from 'keycloak-js';

const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: 'demo-realm',
  clientId: 'app1-client'
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;