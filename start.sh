#!/usr/bin/env bash
# Tear down any running stack and bring it back up with a full image rebuild.
# Volumes (Postgres, Keycloak data) are preserved — if you want a fully fresh
# realm, swap `down` for `down -v` below.
set -euo pipefail

cd "$(dirname "$0")"

# Pull DOCKER_HOST + RESEND_API_TOKEN in for users who don't have direnv.
if [ -f .envrc ]; then
  # shellcheck disable=SC1091
  source .envrc
fi

echo "==> Stopping any running containers (volumes preserved)"
podman compose down || true

echo "==> Rebuilding all images (keycloak + bff)"
podman compose build

echo "==> Starting stack"
podman compose up -d

echo
echo "==> Status:"
podman compose ps
echo
echo "Tail logs with: podman compose logs -f"
