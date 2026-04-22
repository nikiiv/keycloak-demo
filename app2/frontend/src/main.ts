import './App';

// Only react to real back/forward navigation. Do NOT rewrite the URL on
// initial load — keycloak-js needs the ?state=…&code=… query params that
// Keycloak appends when redirecting back after login.
window.addEventListener('popstate', () => {
  document.body.dispatchEvent(new CustomEvent('pathchange'));
});
