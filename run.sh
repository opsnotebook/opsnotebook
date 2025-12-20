#!/bin/bash

# Script to run both backend and frontend in development mode
# Exit immediately if any command fails
set -e

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Go backend on port 12808..."
cd "$SCRIPT_DIR/backend"
CONFIG_PATH="$SCRIPT_DIR/config.json" go run cmd/server/main.go &
BACKEND_PID=$!

# Wait a moment and check if backend is still running
sleep 1
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend failed to start! Check if port 12808 is already in use."
    exit 1
fi

echo "Starting Vite frontend on port 12807..."
cd "$SCRIPT_DIR/frontend"
# Use --strictPort to fail instead of auto-incrementing port
npm run dev -- --strictPort &
FRONTEND_PID=$!

# Wait a moment and check if frontend is still running
sleep 1
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "ERROR: Frontend failed to start! Check if port 12807 is already in use."
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "Application running:"
echo "  Frontend: http://localhost:12807"
echo "  Backend:  http://localhost:12808"
echo ""
echo "Press Ctrl+C to stop both servers"

wait
