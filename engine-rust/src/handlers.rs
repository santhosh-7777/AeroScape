use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::model::{
    baseline_covers, col, preset_covers, Cover, Footprint, SimState, IRRADIANCE_DEFAULT,
    IRRADIANCE_MAX, IRRADIANCE_MIN, NX, NY, NZ, N_COLS,
};
use crate::physics::{absorbed_power_w, idx, solve};

pub type Shared = Arc<Mutex<SimState>>;
type ApiResult = Result<Json<GridResponse>, (StatusCode, String)>;

fn lock(state: &Shared) -> MutexGuard<'_, SimState> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn bad_request(msg: impl Into<String>) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, msg.into())
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[derive(Serialize)]
pub struct ColumnOut {
    pub x: usize,
    pub y: usize,
    pub cover: Cover,
    pub footprint: Footprint,
    pub height_m: u16,
    pub surface_temp: f64,
    pub baseline_surface_temp: f64,
    pub air_temps: [f64; 4],
    pub baseline_air_temps: [f64; 4],
}

#[derive(Serialize)]
pub struct Telemetry {
    pub absorbed_mw: f64,
    pub baseline_absorbed_mw: f64,
    pub delta_mw_saved: f64,
    pub avg_street_temp_c: f64,
    pub baseline_avg_street_temp_c: f64,
    pub ac_savings_pct: f64,
    pub compute_time_ms: f64,
}

#[derive(Serialize)]
pub struct GridResponse {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    pub city_name: String,
    pub irradiance: f64,
    pub ambient: f64,
    pub columns: Vec<ColumnOut>,
    pub telemetry: Telemetry,
}

pub fn build_grid(st: &SimState) -> GridResponse {
    let started = Instant::now();
    let baseline = baseline_covers(&st.footprint);
    let base_t = solve(&baseline, st.irradiance, st.ambient);
    let cur_t = solve(&st.covers, st.irradiance, st.ambient);
    let compute_ms = started.elapsed().as_secs_f64() * 1000.0;

    let mut columns = Vec::with_capacity(N_COLS);
    let mut cur_street = 0.0;
    let mut base_street = 0.0;

    for y in 0..NY {
        for x in 0..NX {
            let c = col(x, y);
            let mut air = [0.0f64; 4];
            let mut base_air = [0.0f64; 4];
            for z in 1..NZ {
                air[z - 1] = cur_t[idx(x, y, z)];
                base_air[z - 1] = base_t[idx(x, y, z)];
            }
            cur_street += air[0];
            base_street += base_air[0];

            columns.push(ColumnOut {
                x,
                y,
                cover: st.covers[c],
                footprint: st.footprint[c],
                height_m: st.heights[c],
                surface_temp: round2(cur_t[idx(x, y, 0)]),
                baseline_surface_temp: round2(base_t[idx(x, y, 0)]),
                air_temps: air.map(round2),
                baseline_air_temps: base_air.map(round2),
            });
        }
    }

    let n = N_COLS as f64;
    let cur_avg = cur_street / n;
    let base_avg = base_street / n;
    let ambient = st.ambient;
    let removed = if base_avg - ambient > 0.05 {
        ((base_avg - cur_avg) / (base_avg - ambient)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let absorbed_w = absorbed_power_w(&st.covers, st.irradiance);
    let base_absorbed_w = absorbed_power_w(&baseline, st.irradiance);

    GridResponse {
        nx: NX,
        ny: NY,
        nz: NZ,
        city_name: st.city_name.clone(),
        irradiance: st.irradiance,
        ambient: st.ambient,
        columns,
        telemetry: Telemetry {
            absorbed_mw: round2(absorbed_w / 1.0e6),
            baseline_absorbed_mw: round2(base_absorbed_w / 1.0e6),
            delta_mw_saved: round2((base_absorbed_w - absorbed_w) / 1.0e6),
            avg_street_temp_c: round2(cur_avg),
            baseline_avg_street_temp_c: round2(base_avg),
            ac_savings_pct: round2(removed * 15.0),
            compute_time_ms: round2(compute_ms),
        },
    }
}

pub async fn health() -> &'static str {
    "ok"
}

pub async fn get_grid(State(state): State<Shared>) -> Json<GridResponse> {
    let st = lock(&state);
    Json(build_grid(&st))
}

#[derive(Deserialize)]
pub struct InterveneReq {
    pub x: usize,
    pub y: usize,
    pub cover: Cover,
}

pub async fn intervene(State(state): State<Shared>, Json(req): Json<InterveneReq>) -> ApiResult {
    if req.x >= NX || req.y >= NY {
        return Err(bad_request(format!(
            "cell ({}, {}) is outside the {}x{} grid",
            req.x, req.y, NX, NY
        )));
    }
    let mut st = lock(&state);
    st.covers[col(req.x, req.y)] = req.cover;
    Ok(Json(build_grid(&st)))
}

#[derive(Deserialize)]
pub struct CellPaint {
    pub x: usize,
    pub y: usize,
    pub cover: Cover,
}

#[derive(Deserialize)]
pub struct BatchReq {
    #[serde(default)]
    pub cells: Vec<CellPaint>,
    pub preset: Option<String>,
}

pub async fn batch_intervene(State(state): State<Shared>, Json(req): Json<BatchReq>) -> ApiResult {
    if req.cells.is_empty() && req.preset.is_none() {
        return Err(bad_request("provide 'cells' or 'preset'"));
    }
    if let Some(bad) = req.cells.iter().find(|c| c.x >= NX || c.y >= NY) {
        return Err(bad_request(format!(
            "cell ({}, {}) is outside the grid",
            bad.x, bad.y
        )));
    }

    let mut st = lock(&state);
    if let Some(name) = req.preset.as_deref() {
        let covers = preset_covers(name, &st.footprint)
            .ok_or_else(|| bad_request(format!("unknown preset '{name}'")))?;
        st.covers = covers;
    }
    for c in &req.cells {
        st.covers[col(c.x, c.y)] = c.cover;
    }
    Ok(Json(build_grid(&st)))
}

#[derive(Deserialize)]
pub struct IrradianceReq {
    pub irradiance: f64,
}

pub async fn set_irradiance(
    State(state): State<Shared>,
    Json(req): Json<IrradianceReq>,
) -> ApiResult {
    if !(IRRADIANCE_MIN..=IRRADIANCE_MAX).contains(&req.irradiance) {
        return Err(bad_request("irradiance must be between 200 and 1100 W/m2"));
    }
    let mut st = lock(&state);
    st.irradiance = req.irradiance;
    Ok(Json(build_grid(&st)))
}

#[derive(Deserialize)]
pub struct LoadCityReq {
    pub name: String,
    pub footprint: Vec<u8>,
    pub heights: Vec<u16>,
}

pub async fn load_city(State(state): State<Shared>, Json(req): Json<LoadCityReq>) -> ApiResult {
    if req.footprint.len() != N_COLS || req.heights.len() != N_COLS {
        return Err(bad_request(
            "footprint and heights must each contain 400 values (20x20, row-major)",
        ));
    }
    if req.heights.iter().any(|h| *h > 300) {
        return Err(bad_request("building heights must be between 0 and 300 m"));
    }

    let mut footprint = Vec::with_capacity(N_COLS);
    for code in &req.footprint {
        match Footprint::from_code(*code) {
            Some(f) => footprint.push(f),
            None => return Err(bad_request(format!("unknown footprint code {code}"))),
        }
    }

    let name = req.name.trim();
    let city_name: String = if name.is_empty() {
        "Custom District".to_string()
    } else {
        name.chars().take(80).collect()
    };

    let mut st = lock(&state);
    st.covers = baseline_covers(&footprint);
    st.footprint = footprint;
    st.heights = req.heights;
    st.city_name = city_name;
    Ok(Json(build_grid(&st)))
}

pub async fn reset(State(state): State<Shared>) -> Json<GridResponse> {
    let mut st = lock(&state);
    let covers = baseline_covers(&st.footprint);
    st.covers = covers;
    st.irradiance = IRRADIANCE_DEFAULT;
    Json(build_grid(&st))
}