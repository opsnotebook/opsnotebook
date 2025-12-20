# Core Architecture: OpsNotebook

OpsNotebook is designed around a "Dumb Backend, Smart Connectors" philosophy. The core code does not know about Kubernetes, Cloud Providers, or specific Databases.

## 1. The Target Concept

The system manages **Targets**. A Target is defined in `config.json` by:

1.  **ID**: Unique identifier.
2.  **Driver Command**: A shell command string.
3.  **Tags**: Key-value pairs for organization (`env`, `region`, `name`, `variant`).
4.  **Labels**: Key-value pairs for filtering (e.g., `type: "elasticsearch"`) - used by notebooks to scope which targets appear.
5.  **Visuals**: Optional UI configuration (e.g., `color`).

### Example `config.json`

```json
{
  "group_by": ["environment", "region", "name"],
  "targets": [
    {
      "id": "prod-db-us",
      "name": "primary-db",
      "tags": {
        "environment": "prod",
        "region": "us-east",
        "name": "primary-db",
        "variant": "primary"
      },
      "labels": {
        "type": "elasticsearch"
      },
      "visual": {
        "color": "red"
      },
      "driver_cmd": "python3 drivers/pg-driver.py --host db.prod.internal"
    }
  ]
}
```

### Labels vs Tags

- **Tags**: Used by the frontend for grouping targets in the navigation tree. Flexible and can have any keys.
- **Labels**: Used by notebooks for filtering. Enable notebooks to declare which targets they work with using Kubernetes-style label selectors.

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
    - **Target:** `http://127.0.0.1:54321/some/path`
    - **Headers:** Injects the headers from the Handshake (e.g., Auth tokens).
4.  The Backend streams the response back to the Frontend.

## 4. Frontend Grouping and Filtering

The Frontend uses **Tags** to organize targets dynamically and **Labels** to filter targets per notebook.

### The `group_by` Configuration

The `group_by` array in `config.json` controls how targets are organized in the navigation tree:

```json
{
  "group_by": ["environment", "region", "name"],
  ...
}
```

**How it works:**

- Keys are nested in order: the first key creates top-level folders, subsequent keys create sub-levels
- The **last key** becomes the leaf node label in the tree
- Targets are matched into groups by their `tags` values
- The special `variant` tag identifies different targets within a group (e.g., `primary`, `replica`)

**Default:** `["environment", "region", "name"]`

**Example tree structure:**

```
├── PROD
│   ├── US-EAST
│   │   ├── users-db      (primary, replica)
│   │   └── orders-db     (primary, replica)
│   └── EU-WEST
│       └── users-db      (primary)
└── STAGING
    └── US-EAST
        └── users-db      (primary)
```

### Label-Based Target Filtering

Notebooks can declare `targetLabelSelector` in their `meta` to filter which targets appear when that notebook is active.

**How it works:**

1. When a notebook is opened, the frontend checks if it has a `targetLabelSelector`.
2. Only targets with matching labels are shown in the sidebar.
3. Uses **Kubernetes-style label selectors**:
   - Equality-based: `{ type: "elasticsearch" }` - exact match
   - Set-based: `{ type: ["elasticsearch", "es"] }` - any value matches
   - Multiple labels: all must match

**Example:**

```json
// In a notebook's meta:
{
  "targetLabelSelector": { "type": "elasticsearch" }
}

// Targets with matching labels (in config.json):
{
  "id": "cluster-old",
  "labels": { "type": "elasticsearch" },
  ...
}
```

This enables **notebook-specific target scoping**. For example, an ElasticSearch migration notebook only shows ElasticSearch targets, preventing mistakes like selecting PostgreSQL targets.

### Filtering Targets with GROUP_PATTERN

You can filter which targets are loaded at startup using the `GROUP_PATTERN` environment variable:

```bash
# Load only staging targets
GROUP_PATTERN="staging:*:*" ./run.sh

# Load only US region targets
GROUP_PATTERN="*:us-*:*" ./run.sh

# Load a specific service
GROUP_PATTERN="prod:us-east:users-db" ./run.sh
```

The pattern uses glob matching against the group key (tag values joined by `:`).

### Custom Grouping Examples

You can customize `group_by` to match your infrastructure's organization:

**By team and service:**

```json
{
  "group_by": ["team", "service"],
  ...
}
```

**By cloud provider and region:**

```json
{
  "group_by": ["provider", "region", "cluster"],
  ...
}
```

This allows for flexible topologies (Pairs, Trios, Singletons) without hardcoding logic.
