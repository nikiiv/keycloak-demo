import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: 'demo-realm',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID
});

export default keycloak;
