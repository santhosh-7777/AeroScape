"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellRef, ColumnState, Cover, GridResponse } from "@/lib/types";
import { baselineCover, coverColor, thermalColor } from "@/lib/thermal";
import { sunPosition } from "@/lib/sun";

const GRID = 20;
const OFFSET = (GRID - 1) / 2;

export interface CityViewportProps {
  grid: GridResponse | null;
  viewMode: "after" | "before";
  tool: Cover | null;
  brushSize: 1 | 3;
  hour: number;
  selected: CellRef | null;
  onPaint: (cells: CellRef[]) => void;
  onInspect: (cell: CellRef | null) => void;
}

interface CellObjects {
  body: THREE.Mesh;
  canopy: THREE.Mesh;
  plume: THREE.Mesh;
}

const worldX = (x: number) => x - OFFSET;
const worldZ = (y: number) => y - OFFSET;
const cellKey = (c: CellRef) => `${c.x},${c.y}`;

function brushCells(cx: number, cy: number, size: 1 | 3): CellRef[] {
  const r = size === 3 ? 1 : 0;
  const out: CellRef[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < GRID && y < GRID) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

function bodyHeight(col: ColumnState): number {
  switch (col.footprint) {
    case "building":
      return Math.max(0.2, col.height_m * 0.03);
    case "park":
      return 0.12;
    case "water":
      return 0.03;
    default:
      return 0.05;
  }
}

export default function CityViewport(props: CityViewportProps) {
  const { grid, viewMode, hour, selected } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const objectsRef = useRef<CellObjects[]>([]);
  const controlsRef = useRef<OrbitControls | null>(null);
  const lightRef = useRef<THREE.DirectionalLight | null>(null);
  const hoverLineRef = useRef<THREE.LineSegments | null>(null);
  const selectedLineRef = useRef<THREE.LineSegments | null>(null);

  useEffect(() => {
    propsRef.current = props;
  });

  // Scene setup: runs once on mount and tears everything down on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");
    scene.fog = new THREE.Fog("#f8fafc", 60, 130);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    camera.position.set(17, 19, 24);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 8;
    controls.maxDistance = 70;
    controls.update();
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight("#ffffff", "#94a3b8", 0.9));

    const sun = new THREE.DirectionalLight("#fff7ed", 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowCam = sun.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -18;
    shadowCam.right = 18;
    shadowCam.top = 18;
    shadowCam.bottom = -18;
    shadowCam.near = 1;
    shadowCam.far = 120;
    shadowCam.updateProjectionMatrix();
    scene.add(sun);
    scene.add(sun.target);
    lightRef.current = sun;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID + 6, GRID + 6),
      new THREE.MeshStandardMaterial({ color: "#e2e8f0", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(GRID, GRID, "#cbd5e1", "#cbd5e1");
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.SphereGeometry(0.38, 16, 12);
    const plumeGeo = new THREE.BoxGeometry(0.9, 0.6, 0.9);

    const objects: CellObjects[] = [];
    const bodies: THREE.Mesh[] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const body = new THREE.Mesh(
          boxGeo,
          new THREE.MeshStandardMaterial({ color: "#475569", roughness: 0.85 })
        );
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData = { x, y };

        const canopy = new THREE.Mesh(
          canopyGeo,
          new THREE.MeshStandardMaterial({ color: "#15803d", roughness: 0.9 })
        );
        canopy.castShadow = true;
        canopy.visible = false;

        const plume = new THREE.Mesh(
          plumeGeo,
          new THREE.MeshBasicMaterial({
            color: "#2563eb",
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
          })
        );

        scene.add(body, canopy, plume);
        objects[y * GRID + x] = { body, canopy, plume };
        bodies.push(body);
      }
    }
    objectsRef.current = objects;

    const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.02, 1));
    const hoverLine = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({ color: "#0284c7" })
    );
    hoverLine.visible = false;
    const selectedLine = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({ color: "#059669" })
    );
    selectedLine.visible = false;
    scene.add(hoverLine, selectedLine);
    hoverLineRef.current = hoverLine;
    selectedLineRef.current = selectedLine;

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const pick = (e: PointerEvent): CellRef | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(bodies, false)[0];
      if (!hit) return null;
      const { x, y } = hit.object.userData as CellRef;
      return { x, y };
    };

    const setHover = (cell: CellRef | null) => {
      if (!cell) {
        hoverLine.visible = false;
        return;
      }
      const obj = objects[cell.y * GRID + cell.x];
      const span = propsRef.current.tool ? propsRef.current.brushSize : 1;
      hoverLine.visible = true;
      hoverLine.scale.set(span, 1, span);
      hoverLine.position.set(worldX(cell.x), obj.body.scale.y + 0.02, worldZ(cell.y));
    };

    let painting = false;
    let moved = false;
    let downAt: { x: number; y: number } | null = null;
    const stroke = new Map<string, CellRef>();

    const addStroke = (cell: CellRef) => {
      for (const c of brushCells(cell.x, cell.y, propsRef.current.brushSize)) {
        stroke.set(cellKey(c), c);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const cell = pick(e);
      downAt = { x: e.clientX, y: e.clientY };
      moved = false;
      if (cell && propsRef.current.tool) {
        painting = true;
        stroke.clear();
        addStroke(cell);
      }
    };

    const onMove = (e: PointerEvent) => {
      const cell = pick(e);
      setHover(cell);
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
        moved = true;
      }
      if (painting && cell) addStroke(cell);
    };

    const onLeave = () => setHover(null);

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (painting) {
        painting = false;
        const cells = Array.from(stroke.values());
        stroke.clear();
        if (cells.length > 0) propsRef.current.onPaint(cells);
      } else if (downAt && !moved) {
        propsRef.current.onInspect(pick(e));
      }
      downAt = null;
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerup", onUp);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp);
      controls.dispose();

      for (const o of objects) {
        (o.body.material as THREE.Material).dispose();
        (o.canopy.material as THREE.Material).dispose();
        (o.plume.material as THREE.Material).dispose();
      }
      boxGeo.dispose();
      canopyGeo.dispose();
      plumeGeo.dispose();
      outlineGeo.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();

      objectsRef.current = [];
      controlsRef.current = null;
      lightRef.current = null;
      hoverLineRef.current = null;
      selectedLineRef.current = null;
    };
  }, []);

  // Orbit is only active in inspect mode, so left-drag can paint in tool mode.
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enableRotate = props.tool === null;
    }
  }, [props.tool]);

  // Push the latest surface, height and temperature data into the 3D objects.
  useEffect(() => {
    const objects = objectsRef.current;
    if (!grid || objects.length === 0) return;

    for (const col of grid.columns) {
      const o = objects[col.y * GRID + col.x];
      const h = bodyHeight(col);
      const x = worldX(col.x);
      const z = worldZ(col.y);

      const cover: Cover = viewMode === "before" ? baselineCover(col.footprint) : col.cover;

      o.body.position.set(x, 0, z);
      o.body.scale.set(0.96, h, 0.96);
      (o.body.material as THREE.MeshStandardMaterial).color.set(coverColor(cover));

      o.canopy.visible = cover === "trees";
      o.canopy.position.set(x, h + 0.3, z);

      const temp = viewMode === "before" ? col.baseline_air_temps[0] : col.air_temps[0];
      thermalColor(temp, (o.plume.material as THREE.MeshBasicMaterial).color);
      o.plume.position.set(x, h + 0.75, z);
    }
  }, [grid, viewMode]);

  // Keep the selected-cell outline on the right cell when the grid changes.
  useEffect(() => {
    const line = selectedLineRef.current;
    const objects = objectsRef.current;
    if (!line) return;
    if (!selected || objects.length === 0) {
      line.visible = false;
      return;
    }
    const o = objects[selected.y * GRID + selected.x];
    line.visible = true;
    line.position.set(worldX(selected.x), o.body.scale.y + 0.03, worldZ(selected.y));
  }, [selected, grid]);

  // Move the sun and dim the light toward sunrise and sunset.
  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    const [x, y, z] = sunPosition(hour);
    light.position.set(x, y, z);
    const strength = Math.min(1, Math.max(0, (y - 4) / 28));
    light.intensity = 0.5 + 0.9 * strength;
  }, [hour]);

  return (
    <div className="viewport">
      <div ref={containerRef} className="viewport-canvas" />

      <div className="legend">
        <div className="legend-title">Street air temperature</div>
        <div className="legend-bar" />
        <div className="legend-labels">
          <span>32 °C</span>
          <span>35.5 °C</span>
          <span>40 °C+</span>
        </div>
      </div>

      {!grid && <div className="viewport-loading">Connecting to the simulation engine...</div>}
    </div>
  );
}