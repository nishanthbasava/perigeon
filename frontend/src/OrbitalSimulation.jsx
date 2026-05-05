import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ─── Sim speed ────────────────────────────────────────────────────
// 0.12 = ~8x slower than original; one orbit takes ~3 minutes wall clock
const SIM_SPEED = 0.12;

// ─── Satellite / debris definitions ──────────────────────────────
// r: scene units (1 = 1 R_Earth), omega: rad/s before multiplier,
// phi0: deterministic start angle (rad), inc: inclination (rad)
const SATELLITE_DEFS = [
  { id: "SAT-01",          type: "satellite", r: 1.075, omega: 0.30 * SIM_SPEED, phi0: 0.0,  inc: 0.90 },
  { id: "SAT-03",          type: "satellite", r: 1.063, omega: 0.27 * SIM_SPEED, phi0: 1.05, inc: 0.52 },
  { id: "COSMOS 2251 DEB", type: "debris",    r: 1.082, omega: 0.31 * SIM_SPEED, phi0: 3.30, inc: 0.93 },
  { id: "IRIDIUM 33 DEB",  type: "debris",    r: 1.068, omega: 0.26 * SIM_SPEED, phi0: 5.00, inc: 1.50 },
];

const COLOR = {
  satellite: 0x00e5ff,
  debris:    0xff6600,
  earth:     0x0e2d52,
  earthGrid: 0x1a4a88,
  equator:   0x2266aa,
  conj:      0xff3333,
  maneuver:  0x22ff88,
};

// Parametric orbital position (inclination tilt around X axis in Three.js Y-up)
function orbitalPos(t, r, omega, phi0, inc) {
  const theta = omega * t + phi0;
  const xOrb  = r * Math.cos(theta);
  const yOrb  = r * Math.sin(theta);
  return new THREE.Vector3(xOrb, yOrb * Math.sin(inc), yOrb * Math.cos(inc));
}

// ─────────────────────────────────────────────────────────────────
// Props:
//   running            boolean  – advances sim time when true
//   resetKey           number   – increment to restart from t=0
//   activeConjunctions [{primaryAsset, secondaryObject}]
//   executedAssets     Set<string>  – assets that had maneuver executed
// ─────────────────────────────────────────────────────────────────
export default function OrbitalSimulation({
  running,
  resetKey,
  activeConjunctions,
  executedAssets,
}) {
  const mountRef = useRef(null);

  // Mutable refs updated from props without re-running the main effect
  const runningRef        = useRef(running);
  const activeConjRef     = useRef(activeConjunctions ?? []);
  const executedRef       = useRef(executedAssets ?? new Set());

  // Scene refs
  const sceneRef          = useRef(null);
  const objMeshesRef      = useRef({});
  const conjLinesRef      = useRef({});   // key "A-vs-B" → THREE.Line
  const maneuverArcsRef   = useRef({});   // key assetId (and assetId+"-ring") → line
  const simTimeRef        = useRef(0);
  const lastNowRef        = useRef(null);
  const toDisposeRef      = useRef([]);

  // Keep mutable refs in sync with props
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { activeConjRef.current = activeConjunctions ?? []; }, [activeConjunctions]);
  useEffect(() => { executedRef.current  = executedAssets ?? new Set(); }, [executedAssets]);

  // ── Reset on resetKey change ──────────────────────────────────
  useEffect(() => {
    simTimeRef.current  = 0;
    lastNowRef.current  = null;

    const scene = sceneRef.current;
    if (!scene) return;

    // Remove all maneuver arcs / rings
    for (const line of Object.values(maneuverArcsRef.current)) {
      scene.remove(line);
      line.geometry?.dispose();
      line.material?.dispose();
    }
    maneuverArcsRef.current = {};

    // Remove all conjunction lines
    for (const line of Object.values(conjLinesRef.current)) {
      scene.remove(line);
      line.geometry?.dispose();
      line.material?.dispose();
    }
    conjLinesRef.current = {};
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add maneuver arc + new orbit ring when an asset is executed ─
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const def of SATELLITE_DEFS) {
      if (!executedAssets?.has(def.id)) continue;
      if (maneuverArcsRef.current[def.id]) continue; // already drawn

      const r_new = def.r + 0.018;
      const t     = simTimeRef.current;
      const currentTheta = def.omega * t + def.phi0;

      // Short green arc showing the burn trajectory
      const arcPts = [];
      for (let i = 0; i <= 48; i++) {
        const th   = currentTheta + (i / 48) * (Math.PI * 0.75);
        const xOrb = r_new * Math.cos(th);
        const yOrb = r_new * Math.sin(th);
        arcPts.push(new THREE.Vector3(xOrb, yOrb * Math.sin(def.inc), yOrb * Math.cos(def.inc)));
      }
      const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
      const arcMat = new THREE.LineBasicMaterial({ color: COLOR.maneuver, transparent: true, opacity: 0.90 });
      const arc    = new THREE.Line(arcGeo, arcMat);
      scene.add(arc);
      maneuverArcsRef.current[def.id] = arc;

      // Full new orbit ring in green (replaces old ring visually)
      const ringPts = [];
      for (let i = 0; i <= 128; i++) {
        const th   = (i / 128) * 2 * Math.PI;
        const xOrb = r_new * Math.cos(th);
        const yOrb = r_new * Math.sin(th);
        ringPts.push(new THREE.Vector3(xOrb, yOrb * Math.sin(def.inc), yOrb * Math.cos(def.inc)));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const ringMat = new THREE.LineBasicMaterial({ color: COLOR.maneuver, transparent: true, opacity: 0.45 });
      const ring    = new THREE.LineLoop(ringGeo, ringMat);
      scene.add(ring);
      maneuverArcsRef.current[`${def.id}-ring`] = ring;
    }
  }, [executedAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build Three.js scene once ─────────────────────────────────
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let mounted = true;
    let rafId   = null;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x00000a);
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50, container.clientWidth / container.clientHeight, 0.01, 2000,
    );
    camera.position.set(2.0, 1.8, 4.5);
    camera.lookAt(0, 0, 0);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance   = 1.2;
    controls.maxDistance   = 30;

    // Lights
    scene.add(new THREE.AmbientLight(0x223344, 2.0));
    const sun = new THREE.DirectionalLight(0x99ccff, 2.5);
    sun.position.set(12, 6, 5);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x334466, 0.5);
    fill.position.set(-6, -3, -4);
    scene.add(fill);

    // Stars
    const starVerts = [];
    for (let i = 0; i < 2800; i++) {
      const θ = Math.random() * 2 * Math.PI;
      const φ = Math.acos(2 * Math.random() - 1);
      const r = 180 + Math.random() * 20;
      starVerts.push(r * Math.sin(φ) * Math.cos(θ), r * Math.sin(φ) * Math.sin(θ), r * Math.cos(φ));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));
    toDisposeRef.current.push({ geo: starGeo, mat: starMat });

    // Earth
    const earthGeo = new THREE.SphereGeometry(1.0, 64, 32);
    const earthMat = new THREE.MeshPhongMaterial({
      color: COLOR.earth, emissive: 0x07101a, specular: 0x1a3a5c, shininess: 18,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);
    toDisposeRef.current.push({ geo: earthGeo, mat: earthMat });

    const gridGeo = new THREE.SphereGeometry(1.004, 24, 12);
    const gridMat = new THREE.MeshBasicMaterial({
      color: COLOR.earthGrid, wireframe: true, transparent: true, opacity: 0.10,
    });
    scene.add(new THREE.Mesh(gridGeo, gridMat));
    toDisposeRef.current.push({ geo: gridGeo, mat: gridMat });

    const eqGeo = new THREE.TorusGeometry(1.006, 0.0015, 4, 256);
    const eqMat = new THREE.MeshBasicMaterial({ color: COLOR.equator, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Mesh(eqGeo, eqMat));
    toDisposeRef.current.push({ geo: eqGeo, mat: eqMat });

    // Static orbit rings
    for (const def of SATELLITE_DEFS) {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const th   = (i / 128) * 2 * Math.PI;
        const xOrb = def.r * Math.cos(th);
        const yOrb = def.r * Math.sin(th);
        pts.push(new THREE.Vector3(xOrb, yOrb * Math.sin(def.inc), yOrb * Math.cos(def.inc)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const col = def.type === "satellite" ? 0x004466 : 0x552200;
      const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.28 });
      scene.add(new THREE.LineLoop(geo, mat));
      toDisposeRef.current.push({ geo, mat });
    }

    // Object meshes – start at deterministic initial positions
    const objMeshes = {};
    for (const def of SATELLITE_DEFS) {
      const isSat = def.type === "satellite";
      const geo   = new THREE.SphereGeometry(isSat ? 0.028 : 0.022, 10, 8);
      const mat   = new THREE.MeshPhongMaterial({
        color:             isSat ? COLOR.satellite : COLOR.debris,
        emissive:          isSat ? COLOR.satellite : COLOR.debris,
        emissiveIntensity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(orbitalPos(0, def.r, def.omega, def.phi0, def.inc));
      scene.add(mesh);
      objMeshes[def.id] = mesh;
      toDisposeRef.current.push({ geo, mat });
    }
    objMeshesRef.current = objMeshes;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!mounted) return;
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    // Animation loop
    function animate(now) {
      rafId = requestAnimationFrame(animate);

      // Advance sim time only when running
      if (runningRef.current && lastNowRef.current !== null) {
        simTimeRef.current += (now - lastNowRef.current) / 1000;
      }
      lastNowRef.current = now;

      const t = simTimeRef.current;

      // Update satellite positions
      for (const def of SATELLITE_DEFS) {
        const mesh = objMeshes[def.id];
        if (!mesh) continue;
        // Raise orbit after maneuver
        const r = (def.id === "SAT-01" && executedRef.current.has("SAT-01"))
          ? def.r + 0.018
          : def.r;
        mesh.position.copy(orbitalPos(t, r, def.omega, def.phi0, def.inc));
      }

      // Manage conjunction lines
      const activeConj = activeConjRef.current;
      const activeKeys = new Set();

      for (const conj of activeConj) {
        const key = `${conj.primaryAsset}-vs-${conj.secondaryObject}`;
        activeKeys.add(key);

        const m1 = objMeshes[conj.primaryAsset];
        const m2 = objMeshes[conj.secondaryObject];
        if (!m1 || !m2) continue;

        if (!conjLinesRef.current[key]) {
          const geo = new THREE.BufferGeometry().setFromPoints([m1.position.clone(), m2.position.clone()]);
          const mat = new THREE.LineBasicMaterial({ color: COLOR.conj, transparent: true, opacity: 0.75 });
          conjLinesRef.current[key] = new THREE.Line(geo, mat);
          scene.add(conjLinesRef.current[key]);
        } else {
          const pts = new Float32Array([
            m1.position.x, m1.position.y, m1.position.z,
            m2.position.x, m2.position.y, m2.position.z,
          ]);
          conjLinesRef.current[key].geometry.setAttribute(
            "position", new THREE.Float32BufferAttribute(pts, 3),
          );
          conjLinesRef.current[key].geometry.attributes.position.needsUpdate = true;
        }
      }

      // Remove stale conjunction lines
      for (const [key, line] of Object.entries(conjLinesRef.current)) {
        if (!activeKeys.has(key)) {
          scene.remove(line);
          line.geometry?.dispose();
          line.material?.dispose();
          delete conjLinesRef.current[key];
        }
      }

      earthMesh.rotation.y += 0.0004;
      controls.update();
      renderer.render(scene, camera);
    }

    rafId = requestAnimationFrame(animate);

    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      for (const { geo, mat } of toDisposeRef.current) { geo?.dispose(); mat?.dispose(); }
      for (const line of Object.values(conjLinesRef.current)) {
        line.geometry?.dispose(); line.material?.dispose();
      }
      for (const line of Object.values(maneuverArcsRef.current)) {
        line.geometry?.dispose(); line.material?.dispose();
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 min-w-0 bg-[#00000a] rounded-2xl border border-neutral-800 relative overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Status header */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 pt-4 text-center pointer-events-none select-none">
        <p className="text-xs text-neutral-200 font-mono tracking-wide">
          {running ? "Simulation live" : "Simulation paused"}
          &nbsp;&nbsp;|&nbsp;&nbsp;Regime: LEO&nbsp;&nbsp;|&nbsp;&nbsp;Earth Orbital Simulation
        </p>
        <p className="text-[11px] text-cyan-400/80 font-mono mt-0.5">
          Physics: Keplerian propagation · LEO constellation · Scale: 1 unit = 1 R⊕
        </p>
      </div>

      {/* Dashboard */}
      <div className="absolute top-4 right-4 z-10 bg-neutral-950/85 border border-neutral-700/50 rounded-lg px-3.5 py-3 backdrop-blur-sm pointer-events-none select-none">
        <p className="text-[9px] text-neutral-500 uppercase tracking-widest mb-2 font-semibold">
          SIM DASHBOARD
        </p>
        <div className="space-y-0.5 text-[10px] font-mono text-neutral-400">
          <p>Objects: <span className="text-neutral-200">{SATELLITE_DEFS.length}</span></p>
          <p>SAT-01: <span className="text-cyan-400">LEO 475 km</span></p>
          <p>SAT-03: <span className="text-cyan-400">LEO 415 km</span></p>
          <p>Hazards: <span className="text-orange-400">2 debris tracked</span></p>
          <p>Status: <span className={running ? "text-green-400" : "text-amber-400"}>
            {running ? "live" : "paused"}
          </span></p>
        </div>

        {activeConjunctions && activeConjunctions.length > 0 && (
          <div className="mt-2 pt-2 border-t border-neutral-700/40">
            <p className="text-[9px] text-red-400 uppercase tracking-widest mb-1">⚠ Active Conjunctions</p>
            {activeConjunctions.map((c, i) => (
              <p key={i} className="text-[10px] font-mono text-red-300">
                {c.primaryAsset} / {c.secondaryObject.split(" ").slice(0, 2).join(" ")}
              </p>
            ))}
          </div>
        )}

        {executedAssets && executedAssets.size > 0 && (
          <div className="mt-2 pt-2 border-t border-neutral-700/40">
            <p className="text-[9px] text-green-400 uppercase tracking-widest mb-1">✓ Maneuver Executed</p>
            {[...executedAssets].map((a) => (
              <p key={a} className="text-[10px] font-mono text-green-300">{a} trajectory adjusted</p>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none select-none space-y-0.5">
        <p className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest mb-1">Legend</p>
        <p className="text-[10px] font-mono"><span className="text-cyan-400">●</span> Satellite</p>
        <p className="text-[10px] font-mono"><span className="text-orange-400">●</span> Debris</p>
        <p className="text-[10px] font-mono"><span className="text-red-400">—</span> Conjunction</p>
        <p className="text-[10px] font-mono"><span className="text-green-400">—</span> Maneuver arc</p>
        <p className="text-[10px] font-mono text-neutral-600 mt-1">Drag to rotate · Scroll to zoom</p>
      </div>
    </div>
  );
}
