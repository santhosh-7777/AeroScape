use serde::{Deserialize, Serialize};

pub const NX: usize = 20;
pub const NY: usize = 20;
pub const NZ: usize = 5;
pub const N_COLS: usize = NX * NY;
pub const TOTAL_CELLS: usize = NX * NY * NZ;

pub const IRRADIANCE_MIN: f64 = 200.0;
pub const IRRADIANCE_MAX: f64 = 1100.0;
pub const IRRADIANCE_DEFAULT: f64 = 1000.0;
pub const AMBIENT_C: f64 = 30.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cover {
    Asphalt,
    WhitePaint,
    Trees,
    Water,
}

impl Cover {
    pub fn albedo(self) -> f64 {
        match self {
            Cover::Asphalt => 0.10,
            Cover::WhitePaint => 0.80,
            Cover::Trees => 0.20,
            Cover::Water => 0.06,
        }
    }

    pub fn evap_w_m2(self) -> f64 {
        match self {
            Cover::Asphalt | Cover::WhitePaint => 0.0,
            Cover::Trees => 340.0,
            Cover::Water => 420.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Footprint {
    Road,
    Building,
    Park,
    Water,
}

impl Footprint {
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Footprint::Road),
            1 => Some(Footprint::Building),
            2 => Some(Footprint::Park),
            3 => Some(Footprint::Water),
            _ => None,
        }
    }

    pub fn baseline_cover(self) -> Cover {
        match self {
            Footprint::Road | Footprint::Building => Cover::Asphalt,
            Footprint::Park => Cover::Trees,
            Footprint::Water => Cover::Water,
        }
    }
}

#[inline]
pub fn col(x: usize, y: usize) -> usize {
    y * NX + x
}

#[derive(Debug, Clone)]
pub struct SimState {
    pub city_name: String,
    pub footprint: Vec<Footprint>,
    pub heights: Vec<u16>,
    pub covers: Vec<Cover>,
    pub irradiance: f64,
    pub ambient: f64,
}

impl SimState {
    pub fn new_default() -> Self {
        let (footprint, heights) = default_city();
        let covers = baseline_covers(&footprint);
        SimState {
            city_name: "Demo Grid District".into(),
            footprint,
            heights,
            covers,
            irradiance: IRRADIANCE_DEFAULT,
            ambient: AMBIENT_C,
        }
    }
}

pub fn baseline_covers(footprint: &[Footprint]) -> Vec<Cover> {
    footprint.iter().map(|f| f.baseline_cover()).collect()
}

pub fn default_city() -> (Vec<Footprint>, Vec<u16>) {
    let mut footprint = Vec::with_capacity(N_COLS);
    let mut heights = Vec::with_capacity(N_COLS);
    for y in 0..NY {
        for x in 0..NX {
            let kind = if x % 5 == 0 || y % 5 == 0 {
                Footprint::Road
            } else if (x / 5 + y / 5) % 4 == 0 {
                Footprint::Park
            } else {
                Footprint::Building
            };
            let dx = x as i32 - 10;
            let dy = y as i32 - 10;
            let core_bonus: u16 = if dx * dx + dy * dy < 36 { 30 } else { 0 };
            let base: u16 = 14 + ((x * 37 + y * 91) % 40) as u16;
            footprint.push(kind);
            heights.push(if kind == Footprint::Building { base + core_bonus } else { 0 });
        }
    }
    (footprint, heights)
}

fn apply_cool_roofs(footprint: &[Footprint], covers: &mut [Cover]) {
    for i in 0..N_COLS {
        if footprint[i] == Footprint::Building {
            covers[i] = Cover::WhitePaint;
        }
    }
}

fn apply_green_corridor(footprint: &[Footprint], covers: &mut [Cover]) {
    for y in 8..=11 {
        for x in 0..NX {
            let i = col(x, y);
            if footprint[i] != Footprint::Building {
                covers[i] = Cover::Trees;
            }
        }
    }
}

pub fn preset_covers(name: &str, footprint: &[Footprint]) -> Option<Vec<Cover>> {
    let mut covers = baseline_covers(footprint);
    match name {
        "baseline" => {}
        "cool_roof_mandate" => apply_cool_roofs(footprint, &mut covers),
        "green_corridor" => apply_green_corridor(footprint, &mut covers),
        "green_street_hybrid" => {
            apply_cool_roofs(footprint, &mut covers);
            apply_green_corridor(footprint, &mut covers);
        }
        _ => return None,
    }
    Some(covers)
}