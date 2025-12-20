# Contributing to OpsNotebook

Thank you for your interest in contributing! OpsNotebook relies on the community to create new drivers and improve the core platform.

## Architecture

Please read [CORE_ARCHITECTURE.md](docs/CORE_ARCHITECTURE.md) to understand the "Dumb Backend, Smart Driver" philosophy.

## Developing

1.  **Backend**:
    ```bash
    make build
    ```
2.  **Frontend**:
    ```bash
    cd frontend && npm run dev
    ```
3.  **Full Stack**:
    ```bash
    ./run.sh
    ```

## Creating a New Driver

1.  Create a script in `drivers/` (e.g., `my-db-driver.py`).
2.  Implement the protocol described in `docs/DRIVER_PROTOCOL.md`:
    - Read `OPSNOTEBOOK_CONTROL_PORT`.
    - Start an HTTP server on `127.0.0.1:$OPSNOTEBOOK_CONTROL_PORT`.
    - Implement `GET /status`, `POST /connect`, and (optionally) `POST /execute`.
    - Handle `SIGTERM` for cleanup.
3.  Add a target to `config.json` using your new driver (note: `driver_cmd` is executed with `backend/` as the working directory when using `./run.sh`).

## Creating a New Notebook

Notebooks are React components that live under `frontend/src/notebooks/` and are auto-discovered.

1. Create `frontend/src/notebooks/MyNotebook.jsx`
2. Export `meta` and a default component (required)
3. Optionally export `functions` (custom pipe functions)
4. Optionally add `targetLabelSelector` and `targetColors` to `meta` for filtering and styling

See `docs/NOTEBOOKS.md` for the full format and examples, including:
- How to use `targetLabelSelector` to filter which targets appear in your notebook
- How to use `targetColors` to customize target appearance per notebook

## Pull Requests

- Ensure code is formatted (Go and JS).
- Update documentation if you change core behavior.
- Keep drivers simple and self-contained.
