import sys
import json
import time
import os
import subprocess
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler

# State
STATE = {
    "status": "disconnected",
    "target_url": "",
    "headers": {},
    "metadata": {}
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
            # Simulate connection logic
            STATE["status"] = "connected"
            STATE["target_url"] = "http://mock.local"
            STATE["headers"] = {"X-Mock": "true"}
            STATE["metadata"] = {"default_command": "GET /mock/status"}
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "connected",
                "target_url": STATE["target_url"],
                "headers": STATE["headers"],
                "metadata": STATE["metadata"]
            }).encode())

        elif self.path == '/execute':
            length = int(self.headers.get('content-length', 0))
            body = json.loads(self.rfile.read(length))
            cmd = body.get('command')
            
            # Execute locally
            try:
                # Security: This is a test driver, allowing shell=True for 'echo' etc.
                # In prod drivers, be careful.
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                response = {
                    "stdout": res.stdout,
                    "stderr": res.stderr,
                    "exit_code": res.returncode
                }
            except Exception as e:
                response = {
                    "stdout": "",
                    "stderr": str(e),
                    "exit_code": 1
                }

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404)

def main():
    port = int(os.environ.get("OPSNOTEBOOK_CONTROL_PORT", "0"))
    if port == 0:
        print("Error: OPSNOTEBOOK_CONTROL_PORT not set", file=sys.stderr)
        sys.exit(1)

    server = HTTPServer(('127.0.0.1', port), DriverHandler)
    print(f"Driver listening on {port}", file=sys.stderr)
    
    def shutdown_handler(signum, frame):
        print("Shutting down driver...", file=sys.stderr)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
