"use client";

import { useState } from "react";
import type { CellRef, ColumnState, Cover, DistrictInfo } from "@/lib/types";
import { HOUR_MAX, HOUR_MIN, irradianceForHour } from "@/lib/sun";
import { coverColor } from "@/lib/thermal";

export type PresetName = "baseline" | "cool_roof_mandate" | "green_street_hybrid";

export interface ControlPanelProps {
  hour: number;
  onHourChange: (hour: number) => void;
  tool: Cover | null;
  onToolChange: (tool: Cover | null) => void;
  brushSize: 1 | 3;
  onBrushSizeChange: (size: 1 | 3) => void;
  districts: DistrictInfo[];
  onLoadDistrict: (key: string) => void;
  onPreset: (preset: PresetName) => void;
  onReset: () => void;
  busy: boolean;
  selectedCell: CellRef | null;
  selectedColumn: ColumnState | null;
}

const TOOLS: { id: Cover; label: string; hint: string }[] = [
  { id: "white_paint", label: "White cool roof", hint: "Albedo 0.80" },
  { id: "trees", label: "Urban trees", hint: "Shade and evapotranspiration" },
  { id: "water", label: "Cooling water", hint: "Evaporative sink" },
  { id: "asphalt", label: "Dark asphalt", hint: "Albedo 0.10" },
];

const PRESETS: { id: PresetName; label: string }[] = [
  { id: "baseline", label: "1. Baseline heat island" },
  { id: "cool_roof_mandate", label: "2. Cool roof mandate (white roofs)" },
  { id: "green_street_hybrid", label: "3. Green street + cool roof hybrid" },
];

const COVER_LABEL: Record<Cover, string> = {
  asphalt: "Dark asphalt",
  white_paint: "White cool roof",
  trees: "Urban trees",
  water: "Cooling water",
};

const FOOTPRINT_LABEL: Record<string, string> = {
  road: "Road",
  building: "Building",
  park: "Park",
  water: "Water",
};

function formatHour(h: number): string {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  const period = whole >= 12 ? "PM" : "AM";
  const h12 = whole % 12 === 0 ? 12 : whole % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export default function ControlPanel(props: ControlPanelProps) {
  const {
    hour,
    onHourChange,
    tool,
    onToolChange,
    brushSize,
    onBrushSizeChange,
    districts,
    onLoadDistrict,
    onPreset,
    onReset,
    busy,
    selectedCell,
    selectedColumn,
  } = props;

  const [pickedDistrict, setPickedDistrict] = useState("");
  const currentDistrict = pickedDistrict || districts[0]?.key || "";

  return (
    <aside className="sidebar">
      <section className="panel">
        <h2 className="panel-title">Solar time of day</h2>
        <div className="solar-readout">
          <span className="solar-time">{formatHour(hour)}</span>
          <span className="solar-irr">{irradianceForHour(hour)} W/m²</span>
        </div>
        <input
          type="range"
          className="slider"
          min={HOUR_MIN}
          max={HOUR_MAX}
          step={0.25}
          value={hour}
          onChange={(e) => onHourChange(Number(e.target.value))}
          aria-label="Time of day"
        />
        <div className="slider-scale">
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Intervention brush</h2>
        <div className="tool-list">
          <button
            className={`tool ${tool === null ? "tool-active" : ""}`}
            onClick={() => onToolChange(null)}
          >
            <span className="swatch swatch-none" />
            <span className="tool-text">
              <strong>Inspect and orbit</strong>
              <small>Drag to rotate, click a cell for details</small>
            </span>
          </button>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool ${tool === t.id ? "tool-active" : ""}`}
              onClick={() => onToolChange(t.id)}
            >
              <span className="swatch" style={{ background: coverColor(t.id) }} />
              <span className="tool-text">
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="segmented segmented-wide">
          {([1, 3] as const).map((size) => (
            <button
              key={size}
              className={`seg-btn ${brushSize === size ? "seg-btn-active" : ""}`}
              onClick={() => onBrushSizeChange(size)}
            >
              {size === 1 ? "1 x 1 building" : "3 x 3 block"}
            </button>
          ))}
        </div>
        <p className="hint">
          {tool
            ? "Paint mode: click or drag on the city. Pick Inspect and orbit to rotate the view."
            : "Inspect mode: drag to rotate, scroll to zoom, click a cell for its numbers."}
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Demo scenarios</h2>
        <div className="stack">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className="btn"
              disabled={busy}
              onClick={() => onPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button className="btn btn-ghost" disabled={busy} onClick={onReset}>
            Reset city
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Real urban districts</h2>
        <div className="district-row">
          <select
            className="select"
            value={currentDistrict}
            onChange={(e) => setPickedDistrict(e.target.value)}
            disabled={busy || districts.length === 0}
          >
            {districts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            disabled={busy || !currentDistrict}
            onClick={() => onLoadDistrict(currentDistrict)}
          >
            Load
          </button>
        </div>
        <p className="hint">
          Building footprints come from OpenStreetMap. A procedural district is used if the service is offline.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Cell inspector</h2>
        {selectedCell && selectedColumn ? (
          <dl className="inspector">
            <div>
              <dt>Cell</dt>
              <dd>
                ({selectedCell.x}, {selectedCell.y})
              </dd>
            </div>
            <div>
              <dt>Surface</dt>
              <dd>{COVER_LABEL[selectedColumn.cover]}</dd>
            </div>
            <div>
              <dt>Footprint</dt>
              <dd>{FOOTPRINT_LABEL[selectedColumn.footprint] ?? selectedColumn.footprint}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{selectedColumn.height_m} m</dd>
            </div>
            <div>
              <dt>Street air</dt>
              <dd>{selectedColumn.air_temps[0].toFixed(2)} °C</dd>
            </div>
            <div>
              <dt>Baseline street air</dt>
              <dd>{selectedColumn.baseline_air_temps[0].toFixed(2)} °C</dd>
            </div>
          </dl>
        ) : (
          <p className="hint">Click a cell in the city to see its numbers.</p>
        )}
      </section>
    </aside>
  );
}