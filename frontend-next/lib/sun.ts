export const HOUR_MIN = 6;
export const HOUR_MAX = 18;

function phase(hour: number): number {
  const clamped = Math.min(HOUR_MAX, Math.max(HOUR_MIN, hour));
  return ((clamped - HOUR_MIN) / (HOUR_MAX - HOUR_MIN)) * Math.PI;
}

/** Irradiance in W/m2: 200 at 6 AM, 1100 at solar noon. */
export function irradianceForHour(hour: number): number {
  return Math.round(200 + 900 * Math.sin(phase(hour)));
}

/** Sun position for the directional light. The city sits at the origin. */
export function sunPosition(hour: number): [number, number, number] {
  const t = phase(hour);
  return [-Math.cos(t) * 30, 4 + Math.sin(t) * 28, 14];
}