#!/usr/bin/env bash
# Run one BFF on the host with Gradle's continuous build mode, pointed at the
# compose Keycloak + user-service. Use this when iterating on bff/src/** —
# the local loop is ~3s per save vs ~90s for `compose --build --recreate`.
#
# Prereqs:
#   1. The rest of the stack is up:  ./start.sh
#   2. The dev compose overlay so the shell's BFF URL can be redirected:
#         docker compose -f docker-compose.yml -f docker-compose.dev.yml \
#                        up -d --force-recreate shell
#      (with the matching BFF_*_URL env var pointed at host.docker.internal
#      or host.containers.internal — see below).
#
# Usage:
#   ./dev-bff.sh client|ops|admin
#
# Then, in a second terminal, point the shell at your host process:
#   BFF_CLIENT_URL=http://host.docker.internal:8081 \
#     docker compose -f docker-compose.yml -f docker-compose.dev.yml \
#                    up -d --force-recreate shell
#
# When done, restore the compose BFF:
#   docker compose up -d bff-client    # (or bff-ops / bff-admin)

set -euo pipefail

which="${1:-}"
if [ -z "$which" ]; then
  echo "usage: $0 client|ops|admin" >&2
  exit 1
fi

case "$which" in
  client) name="bff-client"; port=8081; roles="" ;;
  ops)    name="bff-ops";    port=8082; roles="user,admin" ;;
  admin)  name="bff-admin";  port=8083; roles="admin" ;;
  *) echo "unknown bff: '$which' (expected client|ops|admin)" >&2; exit 1 ;;
esac

cd "$(dirname "$0")"

echo "==> Stopping the compose '$name' (so port $port is free)"
docker compose stop "$name" 2>/dev/null || true

echo "==> Reminder: point the shell at your host process"
echo "    In another terminal:"
echo
echo "      BFF_$(echo "$which" | tr '[:lower:]' '[:upper:]')_URL=http://host.docker.internal:$port \\"
echo "        docker compose -f docker-compose.yml -f docker-compose.dev.yml \\"
echo "                       up -d --force-recreate shell"
echo
echo "    (Podman: replace with host.containers.internal)"
echo
echo "==> Running $name locally on :$port via Gradle continuous"
cd bff

# Keycloak is published on the host at 8888; tokens minted via the browser
# carry that as the issuer URL, so the local BFF needs to validate against
# the same URL. user-service is reached the same way on 8090 (unused by the
# BFF itself, but the var is in application.yml).
exec env \
  APP_SOURCE="$name" \
  MICRONAUT_APPLICATION_NAME="$name" \
  CORS_ORIGIN="http://localhost:5173" \
  KEYCLOAK_AUTH_SERVER_URL="http://localhost:8888/realms/demo-realm" \
  APP_ALLOWED_ROLES="$roles" \
  MICRONAUT_SERVER_PORT="$port" \
  ./gradlew run -t --no-daemon
