"use client";

import type { GridResponse } from "@/lib/types";

export interface TelemetryBarProps {
  grid: GridResponse | null;
  viewMode: "after" | "before";
  onViewModeChange: (mode: "after" | "before") => void;
  busy: boolean;
}

type Tone = "good" | "bad";

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${tone ? `metric-${tone}` : ""}`}>{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

export default function TelemetryBar({
  grid,
  viewMode,
  onViewModeChange,
  busy,
}: TelemetryBarProps) {
  const t = grid?.telemetry;

  const saved = t ? t.delta_mw_saved : 0;
  const street = t ? t.avg_street_temp_c : 0;
  const streetBase = t ? t.baseline_avg_street_temp_c : 0;
  const streetDelta = street - streetBase;
  const streetSign = streetDelta > 0 ? "+" : "";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">AeroScape</span>
        <span className="brand-sub">{grid?.city_name ?? "Loading district"}</span>
      </div>

      <div className="metrics">
        <Metric
          label="Absorbed solar power"
          value={t ? `${t.absorbed_mw.toFixed(2)} MW` : "--"}
          sub={t ? `Baseline ${t.baseline_absorbed_mw.toFixed(2)} MW` : undefined}
        />
        <Metric
          label="Baseline vs current"
          value={
            t
              ? saved >= 0
                ? `-${saved.toFixed(2)} MW saved`
                : `+${Math.abs(saved).toFixed(2)} MW added`
              : "--"
          }
          tone={saved >= 0 ? "good" : "bad"}
        />
        <Metric
          label="Avg street air"
          value={t ? `${street.toFixed(2)} °C` : "--"}
          sub={t ? `${streetSign}${streetDelta.toFixed(2)} °C vs baseline` : undefined}
          tone={streetDelta < 0 ? "good" : streetDelta > 0 ? "bad" : undefined}
        />
        <Metric
          label="Peak AC energy savings"
          value={t ? `${t.ac_savings_pct.toFixed(1)} %` : "--"}
          sub="DOE 10 to 15 % cooling scaling"
        />
        <Metric
          label="Rust solver"
          value={t ? `${t.compute_time_ms.toFixed(2)} ms` : "--"}
          sub="Two full 3D solves"
        />
      </div>

      <div className="view-toggle">
        <div className="segmented">
          <button
            className={`seg-btn ${viewMode === "before" ? "seg-btn-active" : ""}`}
            onClick={() => onViewModeChange("before")}
          >
            Before
          </button>
          <button
            className={`seg-btn ${viewMode === "after" ? "seg-btn-active" : ""}`}
            onClick={() => onViewModeChange("after")}
          >
            After
          </button>
        </div>
        {busy && <span className="busy">Solving...</span>}
      </div>
    </header>
  );
}