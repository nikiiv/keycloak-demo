#!/usr/bin/env bash
# Tear down any running stack and bring it back up with a full image rebuild.
# Volumes (Postgres, Keycloak data) are preserved — for a fully fresh realm
# run `docker compose down -v` before this script.
#
# Modes:
#   ./start.sh           Level 1 (demo).      Default-mode stack as defined in
#                                              docker-compose.yml — MFE containers
#                                              run `build && preview`.
#   ./start.sh --dev     Level 2 (MFE dev).   Adds docker-compose.dev.yml. MFE
#                                              containers run `vite build --watch`
#                                              + `vite preview` concurrently, so
#                                              source edits rebuild in ~1-2s.
#                                              Hard-refresh the browser to pick
#                                              up the new federation chunks.
#
# Level 3 (BFF on the host) is reached via ./dev-bff.sh — it requires the
# stack to be up first (typically via ./start.sh --dev so the shell's BFF URL
# overrides are wired).
#
# Works with either Docker or Podman: the container engine is auto-detected
# (Docker preferred). Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

cd "$(dirname "$0")"

# --- Parse args ------------------------------------------------------------
DEV=0
case "${1:-}" in
  ""|--default|default) DEV=0 ;;
  --dev|dev)            DEV=1 ;;
  -h|--help|help)
    sed -n '2,18p' "$0"
    exit 0 ;;
  *)
    echo "Error: unknown argument '$1' (expected '--dev' or nothing)." >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1 ;;
esac

# Pull DOCKER_HOST + RESEND_API_TOKEN in for users who don't have direnv.
if [ -f .envrc ]; then
  # shellcheck disable=SC1091
  source .envrc
fi

# --- Detect the container engine and its compose command -------------------
# Sets COMPOSE to an array, e.g. (docker compose) or (podman compose).
ENGINE="${CONTAINER_ENGINE:-}"

if [ -z "$ENGINE" ]; then
  if command -v docker >/dev/null 2>&1; then
    ENGINE=docker
  elif command -v podman >/dev/null 2>&1; then
    ENGINE=podman
  else
    echo "Error: neither 'docker' nor 'podman' found on PATH." >&2
    echo "Install one, or set CONTAINER_ENGINE=docker|podman." >&2
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
    fi
    ;;
  podman)
    if podman compose version >/dev/null 2>&1; then
      COMPOSE=(podman compose)
    elif command -v podman-compose >/dev/null 2>&1; then
      COMPOSE=(podman-compose)
    else
      echo "Error: 'podman' found but no compose ('podman compose' or 'podman-compose')." >&2
      exit 1
    fi
    ;;
  *)
    echo "Error: unknown CONTAINER_ENGINE='$ENGINE' (expected 'docker' or 'podman')." >&2
    exit 1 ;;
esac

# Add `-f docker-compose.dev.yml` to every compose call when --dev was passed.
FILES=(-f docker-compose.yml)
if [ "$DEV" = 1 ]; then
  FILES+=(-f docker-compose.dev.yml)
fi

echo "==> Using ${COMPOSE[*]} ${FILES[*]} (engine: $ENGINE)"
if [ "$DEV" = 1 ]; then
  echo "==> DEV mode: MFE containers will run vite build --watch + preview"
fi

PROJECT="$(basename "$PWD")"

# Block until a compose service reports a healthy container (or fail loudly).
# Used only on the podman path — see below.
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
        healthy)
          echo "    '$svc' is healthy."
          return 0 ;;
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

echo "==> Stopping any running containers (volumes preserved)"
"${COMPOSE[@]}" "${FILES[@]}" down --remove-orphans || true

echo "==> Rebuilding all images (keycloak + bff + user-service)"
"${COMPOSE[@]}" "${FILES[@]}" build

if [ "$ENGINE" = podman ]; then
  # podman-compose does NOT honour `depends_on: condition: service_healthy`,
  # so bring the data + identity tier up first and wait, then the rest.
  echo "==> Starting data + user store (postgres, user-service)"
  "${COMPOSE[@]}" "${FILES[@]}" up -d postgres user-service
  wait_healthy postgres
  wait_healthy user-service

  echo "==> Starting Keycloak"
  "${COMPOSE[@]}" "${FILES[@]}" up -d keycloak
  wait_healthy keycloak 300

  echo "==> Starting the rest (web + bff)"
  "${COMPOSE[@]}" "${FILES[@]}" up -d
else
  # docker compose honours depends_on health conditions itself.
  echo "==> Starting stack"
  "${COMPOSE[@]}" "${FILES[@]}" up -d
fi

echo
echo "==> Status:"
"${COMPOSE[@]}" "${FILES[@]}" ps
echo
if [ "$DEV" = 1 ]; then
  echo "Level 2 dev mode is ON. Edits to apps/mfe-X/src/** rebuild in-place;"
  echo "hard-refresh the browser to pick up new federation chunks."
fi
echo "Tail logs with: ${COMPOSE[*]} ${FILES[*]} logs -f"
