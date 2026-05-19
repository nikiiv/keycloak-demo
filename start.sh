#!/usr/bin/env bash
# Tear down any running stack and bring it back up with a full image rebuild.
# Volumes (Postgres, Keycloak data) are preserved — if you want a fully fresh
# realm, swap `down` for `down -v` below.
#
# Works with either Docker or Podman: the container engine is auto-detected
# (Docker preferred). Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

cd "$(dirname "$0")"

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
    exit 1
    ;;
esac

echo "==> Using ${COMPOSE[*]} (engine: $ENGINE)"

# Preflight: rootless Podman cannot publish host ports below
# net.ipv4.ip_unprivileged_port_start (default 1024), so the 80/443 binds in
# docker-compose.yml otherwise fail ~2 min in with an opaque rootlessport
# error. Fail fast here with the fix instead. No-op for Docker and rootful
# Podman. On macOS the limit lives in the podman-machine Linux VM (not the
# Mac, which has no /proc), so probe the VM over `podman machine ssh`.
# Override with ALLOW_PRIV_PORTS_UNCHECKED=1.
if [ "$ENGINE" = podman ] && [ "${ALLOW_PRIV_PORTS_UNCHECKED:-0}" != 1 ]; then
  ROOTLESS="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo true)"
  if [ "$ROOTLESS" = true ]; then
    if [ "$(uname)" = Darwin ]; then
      FLOOR="$(podman machine ssh 'cat /proc/sys/net/ipv4/ip_unprivileged_port_start' 2>/dev/null | tr -dc '0-9')"
      FIX="podman machine ssh sudo sysctl net.ipv4.ip_unprivileged_port_start=80   # inside the VM; re-run after 'podman machine' stop/recreate"
    else
      FLOOR="$(tr -dc '0-9' < /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || true)"
      FIX="sudo sysctl net.ipv4.ip_unprivileged_port_start=80   # persist: echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-podman-privports.conf"
    fi
    FLOOR="${FLOOR:-1024}"
    if [ "$FLOOR" -gt 80 ]; then
      echo "Error: rootless Podman cannot bind host ports 80/443 (ip_unprivileged_port_start=$FLOOR)." >&2
      echo "Fix:   $FIX" >&2
      echo "       (or use rootful Podman, or set ALLOW_PRIV_PORTS_UNCHECKED=1 to skip this check)" >&2
      exit 1
    fi
  fi
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
"${COMPOSE[@]}" down || true

echo "==> Rebuilding all images (keycloak + bff + user-service)"
"${COMPOSE[@]}" build

if [ "$ENGINE" = podman ]; then
  # podman-compose does NOT honour `depends_on: condition: service_healthy`,
  # so bring the data + identity tier up first and wait, then the rest.
  echo "==> Starting data + user store (postgres, user-service)"
  "${COMPOSE[@]}" up -d postgres user-service
  wait_healthy postgres
  wait_healthy user-service

  echo "==> Starting Keycloak"
  "${COMPOSE[@]}" up -d keycloak
  wait_healthy keycloak 300

  echo "==> Starting the rest (web + bff)"
  "${COMPOSE[@]}" up -d
else
  # docker compose honours depends_on health conditions itself.
  echo "==> Starting stack"
  "${COMPOSE[@]}" up -d
fi

echo
echo "==> Status:"
"${COMPOSE[@]}" ps
echo
echo "Tail logs with: ${COMPOSE[*]} logs -f"
