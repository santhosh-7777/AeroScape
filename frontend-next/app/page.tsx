"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import ControlPanel, { type PresetName } from "@/components/ControlPanel";
import TelemetryBar from "@/components/TelemetryBar";
import { api } from "@/lib/api";
import { irradianceForHour } from "@/lib/sun";
import type { CellRef, Cover, DistrictInfo, GridResponse } from "@/lib/types";

// Three.js needs the browser, so the viewport is loaded on the client only.
const CityViewport = dynamic(() => import("@/components/CityViewport"), {
  ssr: false,
  loading: () => <div className="viewport-loading">Loading 3D engine...</div>,
});

const DEFAULT_HOUR = 12;

export default function Page() {
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [districts, setDistricts] = useState<DistrictInfo[]>([]);
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const [tool, setTool] = useState<Cover | null>(null);
  const [brushSize, setBrushSize] = useState<1 | 3>(1);
  const [viewMode, setViewMode] = useState<"after" | "before">("after");
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hourRef = useRef(hour);
  hourRef.current = hour;
  const irradianceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each request gets a sequence number so a slow, older response can't overwrite a newer one.
  const requestSeq = useRef(0);

  const run = useCallback(async (fn: () => Promise<GridResponse>) => {
    const id = ++requestSeq.current;
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (id === requestSeq.current) setGrid(next);
    } catch (e) {
      if (id === requestSeq.current) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally {
      if (id === requestSeq.current) setBusy(false);
    }
  }, []);

  // Initial load: district list, then sync the engine's irradiance with the slider.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, synced] = await Promise.all([
          api.districts(),
          api.irradiance(irradianceForHour(DEFAULT_HOUR)),
        ]);
        if (cancelled) return;
        setDistricts(list);
        setGrid(synced);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `Cannot reach the gateway: ${e.message}`
              : "Cannot reach the gateway"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (irradianceTimer.current) clearTimeout(irradianceTimer.current);
    };
  }, []);

  const handleHourChange = (h: number) => {
    setHour(h);
    if (irradianceTimer.current) clearTimeout(irradianceTimer.current);
    // Debounce slider drags so the engine isn't flooded with requests.
    irradianceTimer.current = setTimeout(() => {
      run(() => api.irradiance(irradianceForHour(h)));
    }, 120);
  };

  const handlePaint = (cells: CellRef[]) => {
    if (!tool || cells.length === 0) return;
    run(() => api.batch(cells.map((c) => ({ x: c.x, y: c.y, cover: tool }))));
  };

  const handlePreset = (preset: PresetName) => {
    run(() => api.batch([], preset));
  };

  // The engine's reset sets irradiance back to 1000 W/m2, so reapply the slider value afterwards.
  const handleReset = () => {
    run(async () => {
      await api.reset();
      return api.irradiance(irradianceForHour(hourRef.current));
    });
  };

  const handleLoadDistrict = (key: string) => {
    setSelected(null);
    run(async () => {
      const city = await api.osmCity(key);
      return api.loadCity(city);
    });
  };

  const selectedColumn =
    grid && selected
      ? grid.columns.find((c) => c.x === selected.x && c.y === selected.y) ?? null
      : null;

  return (
    <div className="app">
      <TelemetryBar
        grid={grid}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        busy={busy}
      />

      <main className="workspace">
        <ControlPanel
          hour={hour}
          onHourChange={handleHourChange}
          tool={tool}
          onToolChange={setTool}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          districts={districts}
          onLoadDistrict={handleLoadDistrict}
          onPreset={handlePreset}
          onReset={handleReset}
          busy={busy}
          selectedCell={selected}
          selectedColumn={selectedColumn}
        />

        <div className="stage">
          <CityViewport
            grid={grid}
            viewMode={viewMode}
            tool={tool}
            brushSize={brushSize}
            hour={hour}
            selected={selected}
            onPaint={handlePaint}
            onInspect={setSelected}
          />

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="btn btn-ghost btn-small" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}