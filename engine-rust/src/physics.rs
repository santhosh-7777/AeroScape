use crate::model::{col, Cover, NX, NY, NZ, N_COLS, TOTAL_CELLS};

/// Each surface cell covers 10 m x 10 m.
pub const CELL_AREA_M2: f64 = 100.0;

const DT_S: f64 = 30.0;
const STEPS: usize = 400;

/// Effective thermal capacity (J/K) of a surface cell and an air cell.
const C_SURFACE: f64 = 5.0e6;
const C_AIR: f64 = 6.0e5;

/// Conductances in W/K for the lumped energy balance.
const G_SURF_AIR: f64 = 5000.0;
const G_SURF_LAT: f64 = 500.0;
const G_AIR_LAT: f64 = 1500.0;
const G_AIR_VERT: f64 = 1500.0;
const G_AIR_VENT: f64 = 2200.0;

const DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

#[inline]
pub fn idx(x: usize, y: usize, z: usize) -> usize {
    z * NX * NY + y * NX + x
}

#[inline]
fn neighbour(x: usize, y: usize, dx: i32, dy: i32) -> Option<(usize, usize)> {
    let nx = x as i32 + dx;
    let ny = y as i32 + dy;
    if nx < 0 || ny < 0 || nx >= NX as i32 || ny >= NY as i32 {
        None
    } else {
        Some((nx as usize, ny as usize))
    }
}

/// Total absorbed solar power in watts across the surface layer.
pub fn absorbed_power_w(covers: &[Cover], irradiance: f64) -> f64 {
    covers
        .iter()
        .map(|c| irradiance * CELL_AREA_M2 * (1.0 - c.albedo()))
        .sum()
}

/// Explicit time-stepping of the 3D energy balance.
/// Returns temperatures in row-major order: z-layer major, then y, then x.
pub fn solve(covers: &[Cover], irradiance: f64, ambient: f64) -> Vec<f64> {
    let mut q_net = vec![0.0f64; N_COLS];
    for (i, cover) in covers.iter().enumerate() {
        q_net[i] = irradiance * CELL_AREA_M2 * (1.0 - cover.albedo())
            - cover.evap_w_m2() * CELL_AREA_M2;
    }

    let mut t = vec![ambient; TOTAL_CELLS];
    let mut next = vec![ambient; TOTAL_CELLS];

    for _ in 0..STEPS {
        for z in 0..NZ {
            for y in 0..NY {
                for x in 0..NX {
                    let i = idx(x, y, z);
                    let ti = t[i];
                    let mut flux = 0.0;
                    let cap;

                    if z == 0 {
                        cap = C_SURFACE;
                        flux += q_net[col(x, y)];
                        flux -= G_SURF_AIR * (ti - t[idx(x, y, 1)]);
                        for (dx, dy) in DIRS {
                            if let Some((nx, ny)) = neighbour(x, y, dx, dy) {
                                flux -= G_SURF_LAT * (ti - t[idx(nx, ny, 0)]);
                            }
                        }
                    } else {
                        cap = C_AIR;
                        if z == 1 {
                            flux += G_SURF_AIR * (t[idx(x, y, 0)] - ti);
                        } else {
                            flux += G_AIR_VERT * (t[idx(x, y, z - 1)] - ti);
                        }
                        if z + 1 < NZ {
                            flux += G_AIR_VERT * (t[idx(x, y, z + 1)] - ti);
                        }
                        flux += G_AIR_VENT * (ambient - ti);
                        for (dx, dy) in DIRS {
                            if let Some((nx, ny)) = neighbour(x, y, dx, dy) {
                                flux += G_AIR_LAT * (t[idx(nx, ny, z)] - ti);
                            }
                        }
                    }

                    next[i] = ti + DT_S * flux / cap;
                }
            }
        }
        std::mem::swap(&mut t, &mut next);
    }

    t
}