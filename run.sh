#!/bin/bash

# Script to run both backend and frontend in development mode

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Go backend on port 12808..."
cd "$SCRIPT_DIR/backend"
CONFIG_PATH="$SCRIPT_DIR/config.json" go run cmd/server/main.go &
BACKEND_PID=$!

echo "Starting Vite frontend on port 12807..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Application running:"
echo "  Frontend: http://localhost:12807"
echo "  Backend:  http://localhost:12808"
echo ""
echo "Press Ctrl+C to stop both servers"

wait
