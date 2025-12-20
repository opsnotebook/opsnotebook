package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"opsnotebook/backend/internal/api"
	"opsnotebook/backend/internal/config"
	"opsnotebook/backend/internal/target"
)

func main() {
	// 1. Load Config
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config.json"
	}

	targetPattern := os.Getenv("TARGET_PATTERN")

	cfg, err := config.LoadWithPattern(configPath, targetPattern)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if targetPattern != "" {
		log.Printf("Filtered targets with pattern %q: %d targets loaded", targetPattern, len(cfg.Targets))
	}

	// 2. Initialize Target Manager
	manager := target.NewManager(cfg)

	// Start connections
	go manager.ConnectAll()

	// 3. Initialize API Server
	apiServer := api.NewServer(manager)
	mux := apiServer.Routes()

	// 4. Setup Static File Server
	staticDir := "./static"
	if envDir := os.Getenv("STATIC_DIR"); envDir != "" {
		staticDir = envDir
	}
	fs := http.FileServer(http.Dir(staticDir))
	mux.Handle("/", fs)

	// 5. Start HTTP Server
	server := &http.Server{Addr: ":12808", Handler: mux}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		log.Println("Shutting down...")
		manager.Shutdown()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()

	log.Println("OpsNotebook Backend running on :12808")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
