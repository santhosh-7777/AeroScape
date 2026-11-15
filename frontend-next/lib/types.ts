export const GRID_NX = 20;
export const GRID_NY = 20;

export type Cover = "asphalt" | "white_paint" | "trees" | "water";
export type Footprint = "road" | "building" | "park" | "water";

export interface ColumnState {
  x: number;
  y: number;
  cover: Cover;
  footprint: Footprint;
  height_m: number;
  surface_temp: number;
  baseline_surface_temp: number;
  air_temps: [number, number, number, number];
  baseline_air_temps: [number, number, number, number];
}

export interface Telemetry {
  absorbed_mw: number;
  baseline_absorbed_mw: number;
  delta_mw_saved: number;
  avg_street_temp_c: number;
  baseline_avg_street_temp_c: number;
  ac_savings_pct: number;
  compute_time_ms: number;
}

export interface GridResponse {
  nx: number;
  ny: number;
  nz: number;
  city_name: string;
  irradiance: number;
  ambient: number;
  columns: ColumnState[];
  telemetry: Telemetry;
}

export interface CityPayload {
  name: string;
  source: "overpass" | "preset";
  lat: number;
  lon: number;
  radius_m: number;
  footprint: number[];
  heights: number[];
}

export interface DistrictInfo {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CellRef {
  x: number;
  y: number;
}