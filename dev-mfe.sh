#!/usr/bin/env bash
# Bring up only the containers needed to develop ONE MFE in Level 2 (dev) mode.
# Saves on RAM / CPU / boot time when you're only iterating on one MFE.
#
# Usage:
#   ./dev-mfe.sh client|ops|admin
#
# What this starts (always — the minimum needed for login + the shell):
#   postgres, user-service, keycloak    auth backbone
#   shell                                the host that loads MFE remotes
#   bff-client                           serves /api/whoami for the shell
#
# What it adds per MFE:
#   client → mfe-client                 (bff-client is already up)
#   ops    → mfe-ops + bff-ops
#   admin  → mfe-admin + bff-admin
#
# Mode: always Level 2 (uses docker-compose.dev.yml). The chosen MFE container
# runs `vite build --watch` + `vite preview`, so edits in apps/mfe-<which>/src/**
# rebuild in ~1-2s; hard-refresh the browser to pick up the new chunks.
#
# Login as the user with the matching role:
#   client → democlient / 123
#   ops    → demouser  / 123   (demoadmin also works)
#   admin  → demoadmin / 123
#
# Caveats:
#   * Nav still shows links for the other two MFEs; clicking them gives a
#     federation-remote 404 since those containers aren't up. Stay on /<which>.
#   * For fast BFF edit loops, use ./dev-bff.sh (Level 3) — this script only
#     covers the MFE side.
#   * Works with docker or podman; auto-detected (override with CONTAINER_ENGINE).

set -euo pipefail

cd "$(dirname "$0")"

which="${1:-}"
case "$which" in
  -h|--help|help) sed -n '2,30p' "$0"; exit 0 ;;
  "") echo "usage: $0 client|ops|admin" >&2; exit 1 ;;
esac

case "$which" in
  client) mfe_svc="mfe-client"; bff_svc="" ;;     # bff-client already in always-on list
  ops)    mfe_svc="mfe-ops";    bff_svc="bff-ops" ;;
  admin)  mfe_svc="mfe-admin";  bff_svc="bff-admin" ;;
  *) echo "Error: unknown mfe '$which' (expected client|ops|admin)." >&2; exit 1 ;;
esac

# Pull DOCKER_HOST + RESEND_API_TOKEN in for users who don't have direnv.
if [ -f .envrc ]; then
  # shellcheck disable=SC1091
  source .envrc
fi

# --- Detect engine + compose command --------------------------------------
ENGINE="${CONTAINER_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  if command -v docker >/dev/null 2>&1; then
    ENGINE=docker
  elif command -v podman >/dev/null 2>&1; then
    ENGINE=podman
  else
    echo "Error: neither 'docker' nor 'podman' found on PATH." >&2
    exit 1
  fi
fi

case "$ENGINE" in
  docker)
    if docker compose version >/dev/null 2>&1; then
      COMPOSE=(docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then
      COMPOSE=(docker-compose)
    else
      echo "Error: 'docker' found but no compose ('docker compose' or 'docker-compose')." >&2
      exit 1
    fi ;;
  podman)
    if podman compose version >/dev/null 2>&1; then
      COMPOSE=(podman compose)
    elif command -v podman-compose >/dev/null 2>&1; then
      COMPOSE=(podman-compose)
    else
      echo "Error: 'podman' found but no compose ('podman compose' or 'podman-compose')." >&2
      exit 1
    fi ;;
  *) echo "Error: unknown CONTAINER_ENGINE='$ENGINE' (expected 'docker' or 'podman')." >&2; exit 1 ;;
esac

FILES=(-f docker-compose.yml -f docker-compose.dev.yml)

# Always-on services + the chosen MFE (and its BFF, if not already in always-on).
ALWAYS=(postgres user-service keycloak shell bff-client)
SERVICES=("${ALWAYS[@]}" "$mfe_svc")
[ -n "$bff_svc" ] && SERVICES+=("$bff_svc")

PROJECT="$(basename "$PWD")"

# podman-compose ignores `depends_on: condition: service_healthy`, so we poll
# the data + identity tier ourselves before starting the rest. Docker honours
# the condition itself.
wait_healthy() {
  local svc="$1" timeout="${2:-240}" elapsed=0 cid status
  echo "    waiting for '$svc' to become healthy (timeout ${timeout}s)..."
  while true; do
    cid="$(podman ps -aq \
      --filter "label=com.docker.compose.project=$PROJECT" \
      --filter "label=com.docker.compose.service=$svc" | head -1)"
    if [ -n "$cid" ]; then
      status="$(podman inspect "$cid" \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        2>/dev/null || echo '')"
      case "$status" in
        healthy) echo "    '$svc' is healthy."; return 0 ;;
        exited|dead)
          echo "    '$svc' $status before becoming healthy — recent logs:" >&2
          podman logs --tail 40 "$cid" 2>&1 | sed 's/^/      /' >&2 || true
          return 1 ;;
      esac
    fi
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "    '$svc' did not become healthy within ${timeout}s." >&2
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
}

echo "==> Using ${COMPOSE[*]} ${FILES[*]} (engine: $ENGINE)"
echo "==> MFE in focus: $which"
echo "==> Services: ${SERVICES[*]}"

# Build only the custom images we'll actually run. No-op if up to date.
echo "==> Ensuring custom images are built"
build_targets=(keycloak user-service bff-client)
[ -n "$bff_svc" ] && build_targets+=("$bff_svc")
"${COMPOSE[@]}" "${FILES[@]}" build "${build_targets[@]}"

if [ "$ENGINE" = podman ]; then
  echo "==> Starting data + user store (postgres, user-service)"
  "${COMPOSE[@]}" "${FILES[@]}" up -d postgres user-service
  wait_healthy postgres
  wait_healthy user-service

  echo "==> Starting Keycloak"
  "${COMPOSE[@]}" "${FILES[@]}" up -d keycloak
  wait_healthy keycloak 300

  echo "==> Starting shell + selected MFE/BFF"
  "${COMPOSE[@]}" "${FILES[@]}" up -d "${SERVICES[@]}"
else
  echo "==> Starting selected services"
  "${COMPOSE[@]}" "${FILES[@]}" up -d "${SERVICES[@]}"
fi

case "$which" in
  client) login="democlient / 123" ;;
  ops)    login="demouser / 123 (demoadmin also works)" ;;
  admin)  login="demoadmin / 123" ;;
esac

echo
echo "==> Status:"
"${COMPOSE[@]}" "${FILES[@]}" ps
echo
cat <<EOF
------------------------------------------------------------------
MFE '$which' dev stack is up.

  Open:     http://localhost:5173/$which
  Login as: $login

Save apps/mfe-$which/src/** → ~1-2s incremental rebuild → hard-refresh.

Other MFEs aren't running; clicking their Nav links will 404 on the
federation remote. To bring one up later:
  ${COMPOSE[*]} ${FILES[*]} up -d mfe-<other> bff-<other>

Tail logs with:
  ${COMPOSE[*]} ${FILES[*]} logs -f $mfe_svc
------------------------------------------------------------------
EOF
