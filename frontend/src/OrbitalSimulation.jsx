import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ─── Sim speed ────────────────────────────────────────────────────
// 0.12 = ~8x slower than original; one orbit takes ~3 minutes wall clock
const SIM_SPEED = 0.12;

// ─── Collision prediction ─────────────────────────────────────────
// Distance below which a future close approach triggers a conjunction alert.
// 1 scene unit ≈ 6,371 km (1 Earth radius).
// 0.04 scene units ≈ 255 km — realistic LEO conjunction warning margin.
// Slightly generous threshold so real close approaches are caught early.
// Explicit pair list prevents cross-pair false positives entirely.
const DEMO_COLLISION_THRESHOLD = 0.055;
const COLLISION_LOOKAHEAD_SECS = 260; // sim-seconds to scan ahead each check (must exceed relative orbital period ~209s)
const COLLISION_SAMPLE_STEP    = 0.5; // sim-seconds between lookahead samples

// All sat×debris pairs are checked dynamically — no hardcoded list needed.

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate per-object phi0 starting angles from a seed.
// Collision pair debris phi0 values are derived from their partner satellite's
// random phi0 so the close-approach timing is preserved regardless of seed.
function generatePhi0s(seed) {
  const rand = mulberry32(seed >>> 0);
  const TAU  = Math.PI * 2;

  const phi_sat01 = rand() * TAU;
  const phi_sat03 = rand() * TAU;

  return {
    "SAT-01":          phi_sat01,
    "SAT-03":          phi_sat03,
    "SAT-02":          rand() * TAU,
    "SAT-04":          rand() * TAU,
    "SAT-05":          rand() * TAU,
    // COSMOS converges with SAT-01 at t≈100s.
    // delta_ω = (0.30-0.55)*SIM_SPEED = -0.030 → separation at t=0 is ~3.0 rad (≈opposite side)
    "COSMOS 2251 DEB": phi_sat01 + (0.30 - 0.55) * SIM_SPEED * 100,
    // IRIDIUM converges with SAT-03 at t≈150s.
    // delta_ω = (0.27-0.50)*SIM_SPEED = -0.0276 → separation at t=0 is ~4.14 rad (≈120° apart)
    "IRIDIUM 33 DEB":  phi_sat03 + (0.27 - 0.50) * SIM_SPEED * 150,
  };
}

// ─── Earth texture (procedural canvas) ───────────────────────────
function createEarthTexture() {
  const W = 2048, H = 1024;
  const cv  = document.createElement("canvas");
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // Ocean
  ctx.fillStyle = "#0a2240"; ctx.fillRect(0, 0, W, H);
  const og = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.7);
  og.addColorStop(0, "rgba(22,82,148,0)"); og.addColorStop(0.5, "rgba(22,82,148,0.22)"); og.addColorStop(1, "rgba(22,82,148,0)");
  ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);

  const fill = (color, fn) => { ctx.fillStyle = color; ctx.beginPath(); fn(); ctx.fill(); };

  // North America
  fill("#2e5a1a", () => { ctx.moveTo(W*.12,H*.22); ctx.bezierCurveTo(W*.20,H*.14,W*.30,H*.18,W*.30,H*.32); ctx.bezierCurveTo(W*.30,H*.44,W*.22,H*.52,W*.17,H*.52); ctx.bezierCurveTo(W*.11,H*.46,W*.10,H*.34,W*.12,H*.22); ctx.closePath(); });
  // Central America
  fill("#336622", () => { ctx.moveTo(W*.17,H*.52); ctx.bezierCurveTo(W*.20,H*.52,W*.22,H*.57,W*.21,H*.60); ctx.bezierCurveTo(W*.18,H*.59,W*.16,H*.56,W*.17,H*.52); ctx.closePath(); });
  // South America
  fill("#2a5a16", () => { ctx.moveTo(W*.22,H*.57); ctx.bezierCurveTo(W*.30,H*.54,W*.34,H*.62,W*.32,H*.74); ctx.bezierCurveTo(W*.28,H*.84,W*.20,H*.82,W*.17,H*.74); ctx.bezierCurveTo(W*.15,H*.65,W*.17,H*.57,W*.22,H*.57); ctx.closePath(); });
  // Europe
  fill("#3a6820", () => { ctx.moveTo(W*.47,H*.22); ctx.bezierCurveTo(W*.52,H*.16,W*.58,H*.18,W*.58,H*.28); ctx.bezierCurveTo(W*.56,H*.36,W*.50,H*.38,W*.46,H*.34); ctx.bezierCurveTo(W*.44,H*.28,W*.45,H*.24,W*.47,H*.22); ctx.closePath(); });
  // Asia
  fill("#3a6a1e", () => { ctx.moveTo(W*.56,H*.14); ctx.bezierCurveTo(W*.70,H*.10,W*.88,H*.16,W*.90,H*.28); ctx.bezierCurveTo(W*.92,H*.40,W*.82,H*.46,W*.72,H*.46); ctx.bezierCurveTo(W*.62,H*.46,W*.54,H*.40,W*.54,H*.28); ctx.bezierCurveTo(W*.54,H*.20,W*.55,H*.15,W*.56,H*.14); ctx.closePath(); });
  // Africa
  fill("#4a7820", () => { ctx.moveTo(W*.50,H*.36); ctx.bezierCurveTo(W*.56,H*.30,W*.62,H*.36,W*.62,H*.50); ctx.bezierCurveTo(W*.62,H*.64,W*.56,H*.76,W*.52,H*.77); ctx.bezierCurveTo(W*.46,H*.74,W*.43,H*.62,W*.44,H*.50); ctx.bezierCurveTo(W*.44,H*.38,W*.46,H*.34,W*.50,H*.36); ctx.closePath(); });
  // Australia
  fill("#8b6914", () => { ctx.moveTo(W*.78,H*.60); ctx.bezierCurveTo(W*.84,H*.55,W*.92,H*.60,W*.91,H*.68); ctx.bezierCurveTo(W*.90,H*.74,W*.82,H*.76,W*.77,H*.72); ctx.bezierCurveTo(W*.74,H*.68,W*.74,H*.63,W*.78,H*.60); ctx.closePath(); });

  // Polar ice
  const ag = ctx.createLinearGradient(0, 0, 0, H * .22);
  ag.addColorStop(0, "rgba(235,248,255,.95)"); ag.addColorStop(1, "rgba(210,238,255,0)");
  ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H * .22);
  const pg = ctx.createLinearGradient(0, H * .80, 0, H);
  pg.addColorStop(0, "rgba(210,238,255,0)"); pg.addColorStop(1, "rgba(235,248,255,.95)");
  ctx.fillStyle = pg; ctx.fillRect(0, H * .80, W, H * .20);

  // Faint cloud wisps
  ctx.globalAlpha = 0.15; ctx.fillStyle = "#ffffff";
  [[W*.08,H*.35,W*.18,H*.04],[W*.32,H*.44,W*.14,H*.03],[W*.65,H*.42,W*.20,H*.04],[W*.82,H*.38,W*.13,H*.03]].forEach(
    ([x,y,rx,ry]) => { ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); },
  );
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(cv);
}

// ─── Base satellite / debris definitions (always present) ────────
const BASE_SAT_DEFS = [
  { id: "SAT-01",          type: "satellite", r: 1.075, omega: 0.30 * SIM_SPEED, phi0:  0.000, inc: 0.90 },
  { id: "SAT-03",          type: "satellite", r: 1.063, omega: 0.27 * SIM_SPEED, phi0:  1.050, inc: 0.52 },
  { id: "SAT-02",          type: "satellite", r: 1.160, omega: 0.14 * SIM_SPEED, phi0:  2.100, inc: 0.30 },
  { id: "SAT-04",          type: "satellite", r: 1.180, omega: 0.09 * SIM_SPEED, phi0:  4.200, inc: 0.65 },
  { id: "SAT-05",          type: "satellite", r: 1.145, omega: 0.42 * SIM_SPEED, phi0:  0.700, inc: 1.10 },
];
const BASE_DEBRIS_DEFS = [
  { id: "COSMOS 2251 DEB", type: "debris",    r: 1.078, omega: 0.55 * SIM_SPEED, phi0: -3.000, inc: 0.90 },
  { id: "IRIDIUM 33 DEB",  type: "debris",    r: 1.066, omega: 0.50 * SIM_SPEED, phi0: -3.090, inc: 0.52 },
];

// Generate a seeded-random extra object def beyond the base list
function generateDynamicDef(type, index) {
  const rand  = mulberry32((type === "satellite" ? 0x1000 : 0x2000) + index);
  const r     = type === "satellite" ? 1.05 + rand() * 0.15 : 1.04 + rand() * 0.14;
  const omega = type === "satellite"
    ? (0.10 + rand() * 0.38) * SIM_SPEED
    : (0.35 + rand() * 0.28) * SIM_SPEED;
  const phi0  = rand() * Math.PI * 2;
  const inc   = rand() * 1.4;
  const num   = String(index + 1).padStart(2, "0");
  return { id: type === "satellite" ? `SAT-EX-${num}` : `DEB-EX-${num}`, type, r, omega, phi0, inc };
}

// Build the full def list for a given population
function buildAllDefs(satCount, debCount) {
  const sats = Array.from({ length: satCount }, (_, i) =>
    i < BASE_SAT_DEFS.length ? BASE_SAT_DEFS[i] : generateDynamicDef("satellite", i));
  const debs = Array.from({ length: debCount }, (_, i) =>
    i < BASE_DEBRIS_DEFS.length ? BASE_DEBRIS_DEFS[i] : generateDynamicDef("debris", i));
  return [...sats, ...debs];
}

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
//   running              boolean   – advances sim time when true
//   resetKey             number    – increment to restart from t=0
//   speedMultiplier      number    – 1 | 2 | 4 | 8 (default 1)
//   satelliteCount       number    – how many satellites to show (default 5)
//   debrisCount          number    – how many debris objects to show (default 2)
//   onCollisionDetected  function  – called once per pair when lookahead finds close approach
//   activeConjunctions   [{primaryAsset, secondaryObject}]
//   executedAssets       Set<string>  – assets that had maneuver executed
//   highlightedObjects   Set<string>  – object IDs to highlight in the scene
// ─────────────────────────────────────────────────────────────────
export default function OrbitalSimulation({
  running,
  resetKey,
  speedMultiplier = 1,
  satelliteCount  = 5,
  debrisCount     = 2,
  onCollisionDetected,
  activeConjunctions,
  executedAssets,
  highlightedObjects,
}) {
  const mountRef = useRef(null);

  // Mutable refs updated from props without re-running the main effect
  const runningRef              = useRef(running);
  const speedRef                = useRef(speedMultiplier);
  const onCollisionDetectedRef  = useRef(onCollisionDetected);
  const detectedPairsRef        = useRef(new Map()); // pairKey → sim-time after which re-detection is allowed
  const phi0sRef                = useRef(generatePhi0s(Date.now())); // randomized each run
  const activeConjRef           = useRef(activeConjunctions ?? []);
  const executedRef             = useRef(executedAssets ?? new Set());
  const highlightedRef          = useRef(highlightedObjects ?? new Set());

  // Scene refs
  const sceneRef          = useRef(null);
  const objMeshesRef      = useRef({});
  const orbitRingsRef     = useRef({});   // def.id → THREE.LineLoop (tracked for dynamic add/remove)
  const conjLinesRef      = useRef({});   // key "A-vs-B" → THREE.Line
  const maneuverArcsRef   = useRef({});   // key assetId (and assetId+"-ring") → line
  const dynamicDefsRef    = useRef(buildAllDefs(satelliteCount, debrisCount)); // live def list
  const simTimeRef        = useRef(0);
  const lastNowRef        = useRef(null);
  const toDisposeRef      = useRef([]);

  // Keep mutable refs in sync with props
  useEffect(() => { runningRef.current             = running; }, [running]);
  useEffect(() => { speedRef.current               = speedMultiplier; }, [speedMultiplier]);
  useEffect(() => { onCollisionDetectedRef.current = onCollisionDetected; }, [onCollisionDetected]);
  useEffect(() => { activeConjRef.current          = activeConjunctions ?? []; }, [activeConjunctions]);
  useEffect(() => { executedRef.current            = executedAssets ?? new Set(); }, [executedAssets]);
  useEffect(() => { highlightedRef.current         = highlightedObjects ?? new Set(); }, [highlightedObjects]);

  // ── Reset on resetKey change ──────────────────────────────────
  useEffect(() => {
    simTimeRef.current       = 0;
    lastNowRef.current       = null;
    detectedPairsRef.current = new Map();           // allow re-detection after restart
    phi0sRef.current         = generatePhi0s(Date.now()); // new random starting positions

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

    for (const def of dynamicDefsRef.current) {
      if (!executedAssets?.has(def.id)) continue;
      if (maneuverArcsRef.current[def.id]) continue; // already drawn

      const r_new = def.r + 0.018;
      const t     = simTimeRef.current;
      const currentTheta = def.omega * t + (phi0sRef.current[def.id] ?? def.phi0);

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

    // Earth — textured with atmosphere glow
    const earthTex = createEarthTexture();
    const earthGeo = new THREE.SphereGeometry(1.0, 64, 32);
    const earthMat = new THREE.MeshPhongMaterial({
      map: earthTex, specular: 0x224488, shininess: 24,
      emissive: 0x020810, emissiveIntensity: 0.35,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);
    toDisposeRef.current.push({ geo: earthGeo, mat: earthMat });

    // Atmosphere haze — rendered from inside so it glows around the limb
    const atmGeo = new THREE.SphereGeometry(1.030, 64, 32);
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x2255cc, side: THREE.BackSide,
      transparent: true, opacity: 0.20,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    scene.add(new THREE.Mesh(atmGeo, atmMat));
    toDisposeRef.current.push({ geo: atmGeo, mat: atmMat });

    const gridGeo = new THREE.SphereGeometry(1.004, 24, 12);
    const gridMat = new THREE.MeshBasicMaterial({
      color: COLOR.earthGrid, wireframe: true, transparent: true, opacity: 0.06,
    });
    scene.add(new THREE.Mesh(gridGeo, gridMat));
    toDisposeRef.current.push({ geo: gridGeo, mat: gridMat });

    const eqGeo = new THREE.TorusGeometry(1.006, 0.0015, 4, 256);
    const eqMat = new THREE.MeshBasicMaterial({ color: COLOR.equator, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Mesh(eqGeo, eqMat));
    toDisposeRef.current.push({ geo: eqGeo, mat: eqMat });

    // Orbit rings — tracked by ID for dynamic add/remove
    for (const def of dynamicDefsRef.current) {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const th   = (i / 128) * 2 * Math.PI;
        const xOrb = def.r * Math.cos(th);
        const yOrb = def.r * Math.sin(th);
        pts.push(new THREE.Vector3(xOrb, yOrb * Math.sin(def.inc), yOrb * Math.cos(def.inc)));
      }
      const geo  = new THREE.BufferGeometry().setFromPoints(pts);
      const col  = def.type === "satellite" ? 0x004466 : 0x552200;
      const mat  = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.28 });
      const ring = new THREE.LineLoop(geo, mat);
      scene.add(ring);
      orbitRingsRef.current[def.id] = ring;
    }

    // Object meshes – start at current sim positions
    const objMeshes = {};
    for (const def of dynamicDefsRef.current) {
      const isSat = def.type === "satellite";
      const geo   = new THREE.SphereGeometry(isSat ? 0.028 : 0.022, 10, 8);
      const mat   = new THREE.MeshPhongMaterial({
        color:             isSat ? COLOR.satellite : COLOR.debris,
        emissive:          isSat ? COLOR.satellite : COLOR.debris,
        emissiveIntensity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(orbitalPos(0, def.r, def.omega, phi0sRef.current[def.id] ?? def.phi0, def.inc));
      scene.add(mesh);
      objMeshes[def.id] = mesh;
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
    let frameCount = 0;
    function animate(now) {
      rafId = requestAnimationFrame(animate);
      frameCount++;

      // Advance sim time only when running, scaled by speed multiplier
      if (runningRef.current && lastNowRef.current !== null) {
        simTimeRef.current += (now - lastNowRef.current) / 1000 * speedRef.current;
      }
      lastNowRef.current = now;

      const t = simTimeRef.current;

      // Update satellite positions and highlight state
      for (const def of dynamicDefsRef.current) {
        const mesh = objMeshesRef.current[def.id];
        if (!mesh) continue;
        // Raise orbit after maneuver
        const r = (def.id === "SAT-01" && executedRef.current.has("SAT-01"))
          ? def.r + 0.018
          : def.r;
        mesh.position.copy(orbitalPos(t, r, def.omega, phi0sRef.current[def.id] ?? def.phi0, def.inc));

        // Pulse emissive intensity when highlighted
        const highlighted = highlightedRef.current.has(def.id);
        mesh.material.emissiveIntensity = highlighted
          ? 1.0 + 0.5 * Math.sin(now * 0.004)
          : 0.6;
        mesh.scale.setScalar(highlighted ? 1.45 : 1.0);
      }

      // ── Collision lookahead scan (every 90 frames ≈ once per wall-second) ──
      if (runningRef.current && frameCount % 90 === 0 && onCollisionDetectedRef.current) {
        const liveDefs = dynamicDefsRef.current;
        const liveSats = liveDefs.filter(d => d.type === "satellite");
        const liveDebs = liveDefs.filter(d => d.type === "debris");

        for (const sat of liveSats) {
          for (const deb of liveDebs) {
          const pairKey = `${sat.id}||${deb.id}`;
          const cooldownUntil = detectedPairsRef.current.get(pairKey) ?? 0;
          if (t < cooldownUntil) continue;

            // Sample future positions to find minimum approach distance
            let minDist = Infinity;
            let minAhead = 0;
            const satR = (sat.id === "SAT-01" && executedRef.current.has("SAT-01"))
              ? sat.r + 0.018 : sat.r;

            for (let ahead = 0; ahead <= COLLISION_LOOKAHEAD_SECS; ahead += COLLISION_SAMPLE_STEP) {
              const ft   = t + ahead;
              const pSat = orbitalPos(ft, satR, sat.omega, phi0sRef.current[sat.id] ?? sat.phi0, sat.inc);
              const pDeb = orbitalPos(ft, deb.r, deb.omega, phi0sRef.current[deb.id] ?? deb.phi0, deb.inc);
              const d    = pSat.distanceTo(pDeb);
              if (d < minDist) { minDist = d; minAhead = ahead; }
            }

            if (minDist < DEMO_COLLISION_THRESHOLD) {
              // Suppress re-detection until 40 sim-sec after the close approach passes
              detectedPairsRef.current.set(pairKey, t + minAhead + 40);

              // Estimate relative velocity at closest approach point
              const tca   = t + minAhead;
              const dt    = 0.5;
              const satPhi0 = phi0sRef.current[sat.id] ?? sat.phi0;
              const debPhi0 = phi0sRef.current[deb.id] ?? deb.phi0;
              const ps1   = orbitalPos(tca,      satR,  sat.omega, satPhi0, sat.inc);
              const ps2   = orbitalPos(tca + dt, satR,  sat.omega, satPhi0, sat.inc);
              const pd1   = orbitalPos(tca,      deb.r, deb.omega, debPhi0, deb.inc);
              const pd2   = orbitalPos(tca + dt, deb.r, deb.omega, debPhi0, deb.inc);
              const relVelScenePerSec = ps1.clone().sub(pd1)
                .distanceTo(ps2.clone().sub(pd2)) / dt;
              const relVelKms = Math.round(relVelScenePerSec * 6371 * 10) / 10;

              console.log(
                `[Conjunction] ${sat.id} vs ${deb.id} | minDist=${minDist.toFixed(4)} | in ${minAhead.toFixed(1)} sim-s | relVel=${relVelKms} km/s`,
              );

              onCollisionDetectedRef.current({
                satId:                    sat.id,
                debrisId:                 deb.id,
                closestDistSceneUnits:    minDist,
                timeToClosestApproachSecs: minAhead,
                relativeSpeedKms:         relVelKms,
              });
            }
          } // end deb loop
        } // end sat loop
      }

      // Manage conjunction lines
      const activeConj = activeConjRef.current;
      const activeKeys = new Set();

      for (const conj of activeConj) {
        const key = `${conj.primaryAsset}-vs-${conj.secondaryObject}`;
        activeKeys.add(key);

        const m1 = objMeshesRef.current[conj.primaryAsset];
        const m2 = objMeshesRef.current[conj.secondaryObject];
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
      for (const ring of Object.values(orbitRingsRef.current)) {
        ring.geometry?.dispose(); ring.material?.dispose();
      }
      for (const mesh of Object.values(objMeshesRef.current)) {
        mesh.geometry?.dispose(); mesh.material?.dispose();
      }
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

  // ── Sync population when satellite/debris counts change ──────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return; // scene not built yet — initial setup handles it

    const newDefs  = buildAllDefs(satelliteCount, debrisCount);
    const oldDefs  = dynamicDefsRef.current;
    const newIdSet = new Set(newDefs.map(d => d.id));
    const oldIdSet = new Set(oldDefs.map(d => d.id));

    // Remove objects no longer in the list
    for (const def of oldDefs) {
      if (newIdSet.has(def.id)) continue;
      const mesh = objMeshesRef.current[def.id];
      if (mesh) { scene.remove(mesh); mesh.geometry?.dispose(); mesh.material?.dispose(); delete objMeshesRef.current[def.id]; }
      const ring = orbitRingsRef.current[def.id];
      if (ring) { scene.remove(ring); ring.geometry?.dispose(); ring.material?.dispose(); delete orbitRingsRef.current[def.id]; }
    }

    // Add newly introduced objects
    for (const def of newDefs) {
      if (oldIdSet.has(def.id)) continue;

      // Orbit ring
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const th = (i / 128) * 2 * Math.PI;
        pts.push(new THREE.Vector3(def.r * Math.cos(th), def.r * Math.sin(th) * Math.sin(def.inc), def.r * Math.sin(th) * Math.cos(def.inc)));
      }
      const rGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const rMat = new THREE.LineBasicMaterial({ color: def.type === "satellite" ? 0x004466 : 0x552200, transparent: true, opacity: 0.28 });
      const ring = new THREE.LineLoop(rGeo, rMat);
      scene.add(ring);
      orbitRingsRef.current[def.id] = ring;

      // Mesh
      const isSat = def.type === "satellite";
      const mGeo  = new THREE.SphereGeometry(isSat ? 0.028 : 0.022, 10, 8);
      const mMat  = new THREE.MeshPhongMaterial({ color: isSat ? COLOR.satellite : COLOR.debris, emissive: isSat ? COLOR.satellite : COLOR.debris, emissiveIntensity: 0.6 });
      const mesh  = new THREE.Mesh(mGeo, mMat);
      mesh.position.copy(orbitalPos(simTimeRef.current, def.r, def.omega, phi0sRef.current[def.id] ?? def.phi0, def.inc));
      scene.add(mesh);
      objMeshesRef.current[def.id] = mesh;
    }

    dynamicDefsRef.current = newDefs;
  }, [satelliteCount, debrisCount]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <p>Satellites: <span className="text-cyan-400">{satelliteCount}</span></p>
          <p>Debris: <span className="text-orange-400">{debrisCount} tracked</span></p>
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
