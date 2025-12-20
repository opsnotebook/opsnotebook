import argparse
import subprocess
import sys
import json
import socket
import base64
import signal
import os
import re

def decode_base64(s):
    if not s: return ""
    return base64.b64decode(s).decode('utf-8')

def run_command(cmd_args, capture_output=True):
    try:
        if capture_output:
            return subprocess.check_output(cmd_args, stderr=subprocess.PIPE).decode('utf-8')
        else:
            subprocess.check_call(cmd_args)
            return None
    except subprocess.CalledProcessError as e:
        cmd_str = " ".join(cmd_args)
        sys.stderr.write(f"Error running command: {cmd_str}\n{e.stderr.decode('utf-8') if e.stderr else str(e)}\n")
        return None

def get_secret(context, namespace, secret_name):
    cmd = ["kubectl", "get", "secret", secret_name, "-n", namespace, "--context", context, "-o", "json"]
    output = run_command(cmd)
    if output:
        return json.loads(output)
    return None

from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

def monitor_kubectl_process():
    """Monitor kubectl subprocess and exit driver if it dies."""
    process = STATE["process"]
    if process is None:
        return

    # Wait for process to exit
    process.wait()

    # If we get here, kubectl died unexpectedly
    print(f"kubectl port-forward exited with code {process.returncode}", file=sys.stderr)
    os._exit(1)  # Force exit to trigger backend reconnect

# Global State
STATE = {
    "status": "disconnected",
    "process": None,
    "target_url": "",
    "headers": {},
    "metadata": {"default_command": "GET /_cluster/health"}
}

class DriverHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": STATE["status"]
            }).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/connect':
            if STATE["status"] == "connected":
                self._send_json({
                    "status": "connected",
                    "target_url": STATE["target_url"],
                    "headers": STATE["headers"],
                    "metadata": STATE["metadata"]
                })
                return

            try:
                self._do_connect()
                self._send_json({
                    "status": "connected",
                    "target_url": STATE["target_url"],
                    "headers": STATE["headers"],
                    "metadata": STATE["metadata"]
                })
            except Exception as e:
                STATE["status"] = "error"
                sys.stderr.write(f"Connection failed: {e}\n")
                self.send_error(500, str(e))

        elif self.path == '/execute':
            length = int(self.headers.get('content-length', 0))
            body = json.loads(self.rfile.read(length))
            cmd = body.get('command')

            try:
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                self._send_json({
                    "stdout": res.stdout,
                    "stderr": res.stderr,
                    "exit_code": res.returncode
                })
            except Exception as e:
                self._send_json({
                    "stdout": "",
                    "stderr": str(e),
                    "exit_code": 1
                })
        else:
            self.send_error(404)

    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _do_connect(self):
        # We parse args from sys.argv because the backend passed them to the process
        # even though we are triggered via HTTP.
        parser = argparse.ArgumentParser()
        parser.add_argument("--context", required=True)
        parser.add_argument("--namespace", required=True)
        parser.add_argument("--cluster-name", required=True)
        # Parse known args, ignoring potential future HTTP-related args
        args, unknown = parser.parse_known_args()

        # 1. Resolve Credentials
        secret_patterns = [
            f"{args.cluster_name}-elastic-user-secret"
        ]

        user = ""
        password = ""

        for secret_name in secret_patterns:
            secret = get_secret(args.context, args.namespace, secret_name)
            if not secret:
                continue
            data = secret.get('data', {})
            if 'username' in data: user = decode_base64(data['username'])
            if 'password' in data: password = decode_base64(data['password'])
            elif 'elastic' in data:
                password = decode_base64(data['elastic'])
                user = "elastic"
            if user and password: break

        if not user or not password:
            raise Exception(f"Could not find credentials for {args.cluster_name}")

        # 2. Start port-forward
        service_name = f"{args.cluster_name}-es-http"
        cmd = [
            "kubectl", "port-forward",
            f"service/{service_name}",
            ":9200",
            "-n", args.namespace,
            "--context", args.context
        ]

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)

        # 3. Wait for port
        local_port = 0
        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                stderr = process.stderr.read()
                raise Exception(f"Port forward failed: {stderr}")
            if "Forwarding from" in line:
                match = re.search(r'127\.0\.0\.1:(\d+)', line)
                if match:
                    local_port = int(match.group(1))
                    break

        STATE["process"] = process
        STATE["status"] = "connected"
        auth_str = f"{user}:{password}"
        auth_b64 = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')
        STATE["target_url"] = f"http://127.0.0.1:{local_port}"
        STATE["headers"] = {"Authorization": f"Basic {auth_b64}"}

        # Start background thread to monitor kubectl process
        monitor_thread = Thread(target=monitor_kubectl_process, daemon=True)
        monitor_thread.start()

def main():
    port = int(os.environ.get("OPSNOTEBOOK_CONTROL_PORT", "0"))
    if port == 0:
        print("Error: OPSNOTEBOOK_CONTROL_PORT not set", file=sys.stderr)
        sys.exit(1)

    server = HTTPServer(('127.0.0.1', port), DriverHandler)
    print(f"Driver listening on {port}", file=sys.stderr)
    
    # Handle shutdown gracefully
    def shutdown_handler(signum, frame):
        print("Shutting down driver...", file=sys.stderr)
        # Kill kubectl if running
        if STATE["process"] and STATE["process"].poll() is None:
            STATE["process"].terminate()
            try:
                STATE["process"].wait(timeout=2)
            except subprocess.TimeoutExpired:
                STATE["process"].kill()
        
        # Stop HTTP server
        # We need to run this in a thread or force exit because serve_forever blocks
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutdown_handler(None, None)

if __name__ == "__main__":
    main()
