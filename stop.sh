#!/usr/bin/env bash
# Stop the stack started by ./start.sh.
#
# Modes:
#   ./stop.sh            Stop containers, keep volumes (Postgres data,
#                        Keycloak realm state). Default — symmetric with
#                        ./start.sh which also preserves volumes.
#   ./stop.sh --wipe     Also remove volumes. Next ./start.sh will reimport
#                        the realm from scratch on an empty database.
#
# Always passes both docker-compose.yml AND docker-compose.dev.yml so it
# tears down Level 1 and Level 2 stacks alike — compose ignores files whose
# services aren't running.
#
# Works with either Docker or Podman: the container engine is auto-detected
# (Docker preferred). Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

cd "$(dirname "$0")"

# --- Parse args ------------------------------------------------------------
WIPE=0
case "${1:-}" in
  "")                  WIPE=0 ;;
  --wipe|wipe|-v)      WIPE=1 ;;
  -h|--help|help)
    sed -n '2,15p' "$0"
    exit 0 ;;
  *)
    echo "Error: unknown argument '$1' (expected '--wipe' or nothing)." >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1 ;;
esac

# Pull DOCKER_HOST in for users who don't have direnv (podman compose needs it).
if [ -f .envrc ]; then
  # shellcheck disable=SC1091
  source .envrc
fi

# --- Detect the container engine and its compose command -------------------
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

# Include the dev overlay if present so Level 2 services are also torn down.
FILES=(-f docker-compose.yml)
if [ -f docker-compose.dev.yml ]; then
  FILES+=(-f docker-compose.dev.yml)
fi

DOWN_ARGS=(down)
if [ "$WIPE" = 1 ]; then
  DOWN_ARGS+=(-v)
  echo "==> Stopping stack AND removing volumes (Postgres + Keycloak data will be lost)"
else
  echo "==> Stopping stack (volumes preserved)"
fi

echo "==> Using ${COMPOSE[*]} ${FILES[*]} (engine: $ENGINE)"
"${COMPOSE[@]}" "${FILES[@]}" "${DOWN_ARGS[@]}"

echo
echo "==> Done. Restart with: ./start.sh  (or ./start.sh --dev)"
