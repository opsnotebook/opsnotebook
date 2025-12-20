# Core Architecture: OpsNotebook

OpsNotebook is designed around a "Dumb Backend, Smart Connectors" philosophy. The core code does not know about Kubernetes, Cloud Providers, or specific Databases.

## 1. The Target Concept

The system manages **Targets**. A Target is defined in `config.json` by:
1.  **ID**: Unique identifier.
2.  **Driver Command**: A shell command string.
3.  **Tags**: Key-value pairs for organization (`env`, `region`, `name`, `variant`).
4.  **Visuals**: Optional UI configuration (e.g., `color`).

### Example `config.json`
```json
{
  "targets": [
    {
      "id": "prod-db-us",
      "name": "primary-db",
      "tags": {
        "env": "prod",
        "region": "us-east",
        "variant": "primary"
      },
      "visual": {
        "color": "red"
      },
      "driver_cmd": "python3 drivers/pg-driver.py --host db.prod.internal"
    }
  ]
}
```

## 2. The Driver Protocol

Any script (Python, Bash, Ruby, Go) can be a driver.

The backend controls drivers via a **local HTTP control plane** (see `docs/DRIVER_PROTOCOL.md`).

### The Contract
1. **Start:** The backend executes the `driver_cmd`.
2. **Control Port:** The backend sets `OPSNOTEBOOK_CONTROL_PORT` in the driver environment.
3. **Ready:** The driver starts an HTTP server on `127.0.0.1:$OPSNOTEBOOK_CONTROL_PORT` and responds to `GET /status`.
4. **Connect:** The backend calls `POST /connect`. The driver performs setup (e.g., SSH tunnel, `kubectl port-forward`) and returns:
   - `target_url`: the local tunnel URL the backend should proxy to
   - optional `headers`: injected by the backend into proxied requests
   - optional `metadata`: e.g. `default_command` shown in the UI console
5. **Hold:** The driver keeps running. If it exits, the backend considers the connection closed and may reconnect.
6. **Teardown:** When the user disconnects, the backend stops the driver process; the driver should handle `SIGTERM` to clean up.

## 3. The Proxy Logic & Direct Access

Once a target is "Connected":

**Proxy Mode:**
1.  The Frontend sends a request to `/api/targets/{id}/proxy/some/path`.
2.  The Backend looks up the `url` and `headers` provided during the Handshake.
3.  The Backend rewrites the request:
    *   **Target:** `http://127.0.0.1:54321/some/path`
    *   **Headers:** Injects the headers from the Handshake (e.g., Auth tokens).
4.  The Backend streams the response back to the Frontend.

## 4. Frontend Grouping

The Frontend uses **Tags** to organize targets dynamically.
*   **Tree View:** Dynamically builds a hierarchy based on `tags.environment` -> `tags.region` -> `tags.name`.
*   **Groups:** Targets sharing the same hierarchy are grouped together. Within a group, targets are distinguished by their `tags.variant` (e.g., "old", "new", "primary", "dr").

This allows for flexible topologies (Pairs, Trios, Singletons) without hardcoding logic.
