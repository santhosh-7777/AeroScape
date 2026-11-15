import type { CityPayload, Cover, DistrictInfo, GridResponse } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function request<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const fromJson =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new Error(fromJson ?? (text || `Request failed with status ${res.status}`));
  }
  return parsed as T;
}

export const api = {
  grid: () => request<GridResponse>("/api/grid"),

  intervene: (x: number, y: number, cover: Cover) =>
    request<GridResponse>("/api/intervene", "POST", { x, y, cover }),

  batch: (cells: { x: number; y: number; cover: Cover }[], preset?: string) =>
    request<GridResponse>("/api/batch-intervene", "POST", { cells, preset }),

  irradiance: (irradiance: number) =>
    request<GridResponse>("/api/irradiance", "POST", { irradiance }),

  reset: () => request<GridResponse>("/api/reset", "POST"),

  districts: () => request<DistrictInfo[]>("/api/districts"),

  osmCity: (key: string) =>
    request<CityPayload>(`/api/osm-city?district=${encodeURIComponent(key)}`),

  loadCity: (city: CityPayload) =>
    request<GridResponse>("/api/load-city", "POST", {
      name: city.name,
      footprint: city.footprint,
      heights: city.heights,
    }),
};