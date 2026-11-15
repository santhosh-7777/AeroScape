mod handlers;
mod model;
mod physics;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::{
    routing::{get, post},
    Router,
};
use tracing_subscriber::EnvFilter;

use handlers::{
    batch_intervene, get_grid, health, intervene, load_city, reset, set_irradiance, Shared,
};
use model::SimState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let state: Shared = Arc::new(Mutex::new(SimState::new_default()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/grid", get(get_grid))
        .route("/intervene", post(intervene))
        .route("/batch-intervene", post(batch_intervene))
        .route("/irradiance", post(set_irradiance))
        .route("/load-city", post(load_city))
        .route("/reset", post(reset))
        .with_state(state);

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8081);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("AeroScape engine listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("could not bind engine port");
    axum::serve(listener, app).await.expect("engine server crashed");
}