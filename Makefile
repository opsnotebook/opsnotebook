PKG_LIST := $(shell go list ./... | grep -v /vendor/)

.PHONY: all build clean test

all: build

build:
	@echo "Building backend..."
	@cd backend && go build -o ../bin/opsnotebook ./cmd/server

run: build
	@echo "Running..."
	@./bin/opsnotebook

test:
	@echo "Running tests..."
	@cd backend && go test -v ./...

clean:
	@rm -rf bin/
