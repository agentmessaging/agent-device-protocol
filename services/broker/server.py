"""Linux signer broker. UID-to-agent policy and key directories belong to root."""
import argparse
import json
import os
import select
import socket
import socketserver
import stat
import struct
import subprocess
import threading
import time

ALLOWED = {"device_list", "device_health", "device_snapshot", "device_camera_live",
           "device_microphone", "device_speaker"}
SLOTS = threading.BoundedSemaphore(4)


def secure_path(path, directory=False):
    info = os.lstat(path)
    if info.st_uid != 0 or info.st_mode & 0o077 or stat.S_ISLNK(info.st_mode):
        raise ValueError("Broker files must be root-owned and inaccessible to other users")
    if directory != stat.S_ISDIR(info.st_mode):
        raise ValueError("Unexpected broker path type")


def trusted_code(path):
    path = os.path.realpath(path)
    while True:
        info = os.stat(path)
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("Broker code and runtime must have root-owned, non-writable ancestors")
        parent = os.path.dirname(path)
        if parent == path:
            return
        path = parent


def authorize(policy, uid):
    entry = policy["agents"].get(str(uid))
    if uid == 0 or not entry:
        raise PermissionError("Caller UID is not assigned to an agent")
    return entry


class Broker(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = False


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        process = None
        if not SLOTS.acquire(blocking=False):
            return
        try:
            _, uid, _ = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            trusted_code(self.server.policy_path)
            secure_path(self.server.policy_path)
            with open(self.server.policy_path, encoding="utf-8") as stream:
                policy = json.load(stream)
            entry = authorize(policy, uid)
            state_dir = entry["state"]
            trusted_code(state_dir)
            secure_path(state_dir, True)
            for filename in ("identity.json", "controller.json"):
                secure_path(os.path.join(state_dir, filename))
            with open(os.path.join(state_dir, "controller.json"), encoding="utf-8") as stream:
                if json.load(stream)["agent"] != entry["agent"]:
                    raise PermissionError("Controller identity differs from broker policy")
            raw = self.rfile.readline(600002)
            if len(raw) > 600000 or not raw.endswith(b"\n"):
                raise ValueError("Request too large")
            request = json.loads(raw)
            if set(request) != {"name", "args"} or request["name"] not in ALLOWED:
                raise ValueError("Unsupported operation")
            # Both paths are supplied by the trusted service configuration.
            process = subprocess.Popen(
                [self.server.node, self.server.worker],
                env={"ADP_HOME": state_dir, "PATH": "/usr/bin:/bin"},
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            process.stdin.write(raw)
            process.stdin.close()
            self.connection.setblocking(False)
            output = bytearray()
            deadline = time.monotonic() + 75
            while time.monotonic() < deadline:
                ready, _, _ = select.select([self.connection, process.stdout], [], [], 0.2)
                if self.connection in ready:
                    if not self.connection.recv(1, socket.MSG_PEEK):
                        raise ConnectionError("Client disconnected")
                    raise ValueError("Only one request per connection")
                if process.stdout in ready:
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    output.extend(chunk)
                    if len(output) > 2000000:
                        raise ValueError("Result too large")
            else:
                raise TimeoutError("Operation timed out")
            self.connection.setblocking(True)
            self.connection.settimeout(5)
            self.wfile.write(output or b'{"error":"Operation failed"}\n')
        except Exception as error:
            try:
                self.connection.setblocking(True)
                self.connection.settimeout(1)
                # Avoid returning file paths or subprocess details to untrusted callers.
                message = str(error) if isinstance(error, PermissionError) else "Broker operation failed"
                self.wfile.write((json.dumps({"error": message}) + "\n").encode())
            except OSError:
                pass
        finally:
            if process:
                if process.poll() is None:
                    os.killpg(process.pid, 9)
                process.wait()
            SLOTS.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--worker", required=True)
    args = parser.parse_args()
    if os.getuid() != 0:
        raise SystemExit("Run the broker as its root-owned system service")
    secure_path(args.policy)
    trusted_code(args.node)
    trusted_code(args.worker)
    trusted_code(__file__)
    source_root = os.path.realpath(os.path.join(os.path.dirname(args.worker), "../.."))
    for root, directories, filenames in os.walk(source_root):
        for name in directories + filenames:
            trusted_code(os.path.join(root, name))
    if os.path.exists(args.socket):
        raise SystemExit("Socket already exists; verify the prior broker has stopped")
    with Broker(args.socket, Handler) as server:
        server.policy_path, server.node, server.worker = args.policy, args.node, args.worker
        os.chmod(args.socket, 0o666)
        try:
            server.serve_forever()
        finally:
            os.unlink(args.socket)


if __name__ == "__main__":
    main()
