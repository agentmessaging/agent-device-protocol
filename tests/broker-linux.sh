#!/usr/bin/env bash
# Runs only in ephemeral Linux CI, as root.
set -euo pipefail
test "$(id -u)" = 0
repo=/opt/adp-broker-ci
state=/var/lib/adp-broker-ci
socket=/run/adp-broker-ci.sock
mkdir -p "$repo" "$state"
cp -a . "$repo/"
chown -R root:root "$repo"
chmod -R go-w "$repo"
chmod 700 "$state"
node_path=$(readlink -f "$(command -v node)")
# CI's setup-node cache can be user-owned. Copy the binary into the protected tree.
cp "$node_path" "$repo/node"
chown root:root "$repo/node"
chmod 755 "$repo/node"
ADP_HOME="$state" "$repo/node" "$repo/apps/controller/cli.mjs" init
printf '{"agent":"lola@ci.local","devices":{}}\n' > "$state/controller.json"
chmod 600 "$state/"*.json
useradd --system --no-create-home adp-ci-agent
agent_uid=$(id -u adp-ci-agent)
printf '{"agents":{"%s":{"agent":"lola@ci.local","state":"%s"}}}\n' "$agent_uid" "$state" > "$state/broker.json"
chmod 600 "$state/broker.json"
python3 "$repo/services/broker/server.py" --policy "$state/broker.json" --socket "$socket" --node "$repo/node" --worker "$repo/services/broker/worker.mjs" &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$socket"' EXIT
for _ in {1..100}; do
  [ -S "$socket" ] && break
  kill -0 "$pid"
  sleep .1
done
cat > "$repo/check.py" <<'PY'
import json,socket,sys
with socket.socket(socket.AF_UNIX) as connection:
    connection.connect("/run/adp-broker-ci.sock")
    connection.sendall(b'{"name":"device_list","args":{}}\n')
    response=json.loads(connection.makefile("r").readline())
    if sys.argv[1]=="allow":
        assert response["result"]["content"][0]["text"]=="[]", response
    else:
        assert "error" in response, response
PY
chown root:root "$repo/check.py"
runuser -u adp-ci-agent -- python3 "$repo/check.py" allow
runuser -u nobody -- python3 "$repo/check.py" deny
if runuser -u adp-ci-agent -- cat "$state/identity.json" >/dev/null 2>&1; then exit 1; fi
if runuser -u nobody -- cat "$state/identity.json" >/dev/null 2>&1; then exit 1; fi
