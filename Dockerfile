# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM golang:1.22-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/go.mod ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# Stage 3: Final image
FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy the Go binary
COPY --from=backend-builder /app/server .

# Copy the frontend build
COPY --from=frontend-builder /app/frontend/dist ./static

# Copy config (can be overridden via volume mount)
COPY config.json .

ENV CONFIG_PATH=/app/config.json

EXPOSE 12808

CMD ["./server"]
