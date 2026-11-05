#!/usr/bin/env bash
set -euo pipefail
tmp=$(mktemp -d)
pid=
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
device() { ADP_HOME="$tmp/device" node clients/linux/cli.mjs "$@"; }
agent() { ADP_HOME="$tmp/controller" node apps/controller/cli.mjs "$@"; }
device_key=$(device init)
agent_key=$(agent init)
device pair "$agent_key"
agent pair "$device_key"
ADP_HOME="$tmp/device" node clients/linux/cli.mjs serve >"$tmp/server.log" 2>&1 &
pid=$!
for _ in {1..50}; do
  if grep -q 'Device listening' "$tmp/server.log"; then break; fi
  if ! kill -0 "$pid" 2>/dev/null; then cat "$tmp/server.log"; exit 1; fi
  sleep 0.1
done
agent discover http://127.0.0.1:23110
agent invoke http://127.0.0.1:23110 device.health
if agent invoke http://127.0.0.1:23110 camera.snapshot; then exit 1; fi
