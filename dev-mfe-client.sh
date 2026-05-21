#!/usr/bin/env bash
# Convenience wrapper: bring up only the containers needed to develop mfe-client.
# See ./dev-mfe.sh for what this actually does.
exec "$(dirname "$0")/dev-mfe.sh" client "$@"
