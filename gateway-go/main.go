package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	engineURL := getenv("RUST_ENGINE_URL", "http://localhost:8081")
	port := getenv("PORT", "8080")

	mux := http.NewServeMux()
	newAPI(engineURL).routes(mux)

	var handler http.Handler = mux
	handler = recoverMiddleware(handler)
	handler = rateLimitMiddleware(handler, 240, time.Minute)
	handler = corsMiddleware(handler, allowedOrigins())
	handler = loggingMiddleware(handler)
	handler = http.TimeoutHandler(handler, 25*time.Second, `{"error":"request timed out"}`)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("AeroScape gateway listening on :%s (engine: %s)", port, engineURL)
	log.Fatal(srv.ListenAndServe())
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}