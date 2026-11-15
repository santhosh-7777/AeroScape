import * as THREE from "three";
import type { Cover, Footprint } from "./types";

const COOL = new THREE.Color("#2563eb");
const MID = new THREE.Color("#10b981");
const HOT = new THREE.Color("#dc2626");

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Cool blue at 32 C, emerald at 35.5 C, hot red at 40 C and above. */
export function thermalColor(
  tempC: number,
  target: THREE.Color = new THREE.Color()
): THREE.Color {
  if (tempC <= 35.5) {
    return target.copy(COOL).lerp(MID, clamp01((tempC - 32) / 3.5));
  }
  return target.copy(MID).lerp(HOT, clamp01((tempC - 35.5) / 4.5));
}

const COVER_HEX: Record<Cover, string> = {
  asphalt: "#475569",
  white_paint: "#f8fafc",
  trees: "#15803d",
  water: "#0ea5e9",
};

export function coverColor(cover: Cover): string {
  return COVER_HEX[cover];
}

const BASELINE: Record<Footprint, Cover> = {
  road: "asphalt",
  building: "asphalt",
  park: "trees",
  water: "water",
};

/** The untreated surface for a footprint type, used for the "Before" view. */
export function baselineCover(footprint: Footprint): Cover {
  return BASELINE[footprint];
}