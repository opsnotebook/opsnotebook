# OpsNotebook Driver Protocol

This document describes how to create custom Drivers for OpsNotebook.

## What is a Driver?

A Driver is an executable program that acts as a **Micro-Agent** for OpsNotebook. It is responsible for establishing connections, tunneling traffic, and executing commands on the target system.

**It can be written in ANY language** (Python, Go, Node.js, etc.), as long as it speaks the HTTP protocol described below.

## The Architecture

1.  **Startup**: OpsNotebook starts your driver process.
2.  **Control Plane**: Your driver starts an HTTP server on a port provided by OpsNotebook.
3.  **Command & Control**: OpsNotebook sends commands (`/connect`, `/execute`) to your driver via HTTP.

## The Protocol

### 1. Environment Variables

When OpsNotebook starts your driver, it sets the following environment variable:

- `OPSNOTEBOOK_CONTROL_PORT`: The local TCP port where your driver **MUST** listen for HTTP requests.

### 2. HTTP Endpoints

Your driver must implement the following endpoints:

#### `GET /status`

**Purpose**: Health check. OpsNotebook polls this to know when your driver is ready.

- **Response**: `200 OK`
  ```json
  { "status": "disconnected" }
  ```

#### `POST /connect`

**Purpose**: Instructs the driver to establish the tunnel/connection (e.g., start `kubectl port-forward`).

- **Response**: `200 OK`
  ```json
  {
    "status": "connected",
    "target_url": "http://127.0.0.1:54321", // The local tunnel URL for data traffic
    "headers": {
      "Authorization": "Bearer <token>" // Optional headers to inject
    },
    "metadata": {
      "default_command": "GET /status" // Default text for the Console
    }
  }
  ```
- **Behavior**: The driver should start the tunnel, wait for it to be ready, and then return the local URL where traffic can be sent.

#### `POST /execute`

**Purpose**: Executes a shell command within the driver's context (useful if the driver has specific tools like `psql` or `kubectl` in its path).

- **Request**: `{"command": "echo hello"}`
- **Response**: `200 OK`
  ```json
  {
    "stdout": "hello\n",
    "stderr": "",
    "exit_code": 0
  }
  ```

### 3. Cleanup

When OpsNotebook shuts down or the user disconnects, it sends **SIGTERM** to your driver process.
Your driver **MUST** handle this signal to clean up resources (e.g., kill child processes like `kubectl`, close SSH tunnels) before exiting.

---

## Example (Python)

```python
import sys
import json
import os
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler

class DriverHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ready"}).encode())

    def do_POST(self):
        if self.path == '/connect':
            # 1. Start your tunnel (e.g. subprocess.Popen)
            # 2. Return the tunnel URL
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "connected",
                "target_url": "http://127.0.0.1:8080",
                "metadata": {"default_command": "GET /"}
            }).encode())

def main():
    port = int(os.environ.get("OPSNOTEBOOK_CONTROL_PORT", "0"))
    server = HTTPServer(('127.0.0.1', port), DriverHandler)

    # Handle cleanup
    def shutdown(signum, frame):
        # Kill your child processes here!
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    server.serve_forever()

if __name__ == "__main__":
    main()
```
