import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const API = "http://127.0.0.1:8000";
const R_EARTH_KM = 6371.0;

// ECI (km) → Three.js scene units.  ECI: X/Y equatorial plane, Z north pole.
// Three.js: Y-up.  Mapping: THREE(x, y, z) = ECI(x/R, z/R, y/R)
function eciKmToScene(x, y, z) {
  return new THREE.Vector3(x / R_EARTH_KM, z / R_EARTH_KM, y / R_EARTH_KM);
}

const COLOR = {
  satellite: 0x00e5ff,
  debris:    0xff6600,
  earth:     0x0e2d52,
  earthGrid: 0x1a4a88,
  equator:   0x2266aa,
  star:      0xffffff,
  conj:      0xff2222,
};

export default function OrbitalSimulation({ onSimEvent, running }) {
  const mountRef = useRef(null);

  const [simStatus, setSimStatus] = useState("loading");
  const [frameInfo, setFrameInfo] = useState({ frame: 0, t: 0, total: 0, objects: 0 });
  const [eventInfo, setEventInfo] = useState(null);

  // Refs shared between the scene-setup effect and the polling effect
  const onSimEventRef  = useRef(onSimEvent);
  const sceneRef       = useRef(null);
  const objMeshesRef   = useRef({});
  const conjLineRef    = useRef(null);
  const lastEventIdRef = useRef(null);
  const toDisposeRef   = useRef([]);

  useEffect(() => { onSimEventRef.current = onSimEvent; }, [onSimEvent]);

  // ── Build Three.js scene once on mount ──────────────────────────────────────
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
    controls.target.set(0, 0, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0x223344, 2.0));
    const sunLight = new THREE.DirectionalLight(0x99ccff, 2.5);
    sunLight.position.set(12, 6, 5);
    scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x334466, 0.5);
    fillLight.position.set(-6, -3, -4);
    scene.add(fillLight);

    // Stars
    const starVerts = [];
    for (let i = 0; i < 2800; i++) {
      const θ = Math.random() * 2 * Math.PI;
      const φ = Math.acos(2 * Math.random() - 1);
      const r = 180 + Math.random() * 20;
      starVerts.push(
        r * Math.sin(φ) * Math.cos(θ),
        r * Math.sin(φ) * Math.sin(θ),
        r * Math.cos(φ),
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: COLOR.star, size: 0.09, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));

    // Earth
    const earthGeo  = new THREE.SphereGeometry(1.0, 64, 32);
    const earthMat  = new THREE.MeshPhongMaterial({
      color: COLOR.earth, emissive: 0x07101a, specular: 0x1a3a5c, shininess: 18,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);

    const gridGeo = new THREE.SphereGeometry(1.004, 24, 12);
    const gridMat = new THREE.MeshBasicMaterial({
      color: COLOR.earthGrid, wireframe: true, transparent: true, opacity: 0.10,
    });
    scene.add(new THREE.Mesh(gridGeo, gridMat));

    const eqGeo = new THREE.TorusGeometry(1.006, 0.0015, 4, 256);
    const eqMat = new THREE.MeshBasicMaterial({ color: COLOR.equator, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Mesh(eqGeo, eqMat));

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!mounted) return;
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    // Render loop — positions are updated by the polling effect, this just renders
    function animate() {
      rafId = requestAnimationFrame(animate);
      controls.update();
      earthMesh.rotation.y += 0.0006;
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(animate);

    // Fetch precomputed frames to build orbit rings + object meshes
    async function fetchFrames() {
      try {
        const res = await fetch(`${API}/simulation/frames`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!mounted) return;

        const toDispose = toDisposeRef.current;

        // Orbit rings (static — show predicted paths)
        for (const orb of data.orbits ?? []) {
          const pts = orb.points.map(([x, y, z]) => eciKmToScene(x, y, z));
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const col = orb.type === "satellite" ? 0x004466 : 0x552200;
          const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35 });
          const line = new THREE.LineLoop(geo, mat);
          scene.add(line);
          toDispose.push({ geo, mat });
        }

        // Object spheres (positions updated by polling)
        for (const obj of data.metadata?.objects ?? []) {
          const isSat = obj.type === "satellite";
          const geo   = new THREE.SphereGeometry(isSat ? 0.028 : 0.022, 10, 8);
          const mat   = new THREE.MeshPhongMaterial({
            color:             isSat ? COLOR.satellite : COLOR.debris,
            emissive:          isSat ? COLOR.satellite : COLOR.debris,
            emissiveIntensity: 0.6,
          });
          const mesh = new THREE.Mesh(geo, mat);
          scene.add(mesh);
          toDispose.push({ geo, mat });
          objMeshesRef.current[obj.id] = mesh;
        }

        if (mounted) {
          setSimStatus("paused");
          setFrameInfo(fi => ({
            ...fi,
            total:   data.metadata?.numFrames  ?? 0,
            objects: data.metadata?.numObjects ?? 0,
          }));
        }
      } catch (err) {
        if (!mounted) return;
        console.error("[OrbitalSim] fetchFrames error:", err);
        setSimStatus("error");
      }
    }
    fetchFrames();

    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      for (const { geo, mat } of toDisposeRef.current) { geo?.dispose(); mat?.dispose(); }
      earthGeo.dispose(); earthMat.dispose();
      gridGeo.dispose();  gridMat.dispose();
      eqGeo.dispose();    eqMat.dispose();
      starGeo.dispose();  starMat.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll /simulation/state when running ─────────────────────────────────────
  useEffect(() => {
    if (!running) {
      setSimStatus(s => s === "live" ? "paused" : s);
      return;
    }

    setSimStatus("live");

    const poll = async () => {
      try {
        const res = await fetch(`${API}/simulation/state`);
        if (!res.ok) return;
        const state = await res.json();

        // Update object positions from current simulation frame
        const objMeshes = objMeshesRef.current;
        for (const obj of state.objects ?? []) {
          const mesh = objMeshes[obj.id];
          if (!mesh) continue;
          const [x, y, z] = obj.position;
          mesh.position.copy(eciKmToScene(x, y, z));
        }

        setFrameInfo({
          frame:   state.frame_idx ?? 0,
          t:       state.t        ?? 0,
          total:   state.total_frames ?? 0,
          objects: (state.objects ?? []).length,
        });

        const scene = sceneRef.current;
        const ev    = state.active_event;

        // Manage conjunction line
        if (scene) {
          if (conjLineRef.current && !ev) {
            // Event resolved — remove line
            scene.remove(conjLineRef.current);
            conjLineRef.current.geometry.dispose();
            conjLineRef.current.material.dispose();
            conjLineRef.current = null;
            setEventInfo(null);
          }

          if (ev) {
            const m1 = objMeshes[ev.primaryAsset];
            const m2 = objMeshes[ev.secondaryObject];
            if (m1 && m2) {
              if (!conjLineRef.current) {
                // Create new conjunction line
                const geo = new THREE.BufferGeometry().setFromPoints([
                  m1.position.clone(), m2.position.clone(),
                ]);
                const mat  = new THREE.LineBasicMaterial({ color: COLOR.conj, transparent: true, opacity: 0.75 });
                const line = new THREE.Line(geo, mat);
                scene.add(line);
                conjLineRef.current = line;
                toDisposeRef.current.push({ geo, mat });
              } else {
                // Update existing line to follow moving objects
                const pts = new Float32Array([
                  m1.position.x, m1.position.y, m1.position.z,
                  m2.position.x, m2.position.y, m2.position.z,
                ]);
                conjLineRef.current.geometry.setAttribute(
                  "position", new THREE.Float32BufferAttribute(pts, 3),
                );
                conjLineRef.current.geometry.attributes.position.needsUpdate = true;
              }
            }

            // Fire onSimEvent once per unique event
            const evId = ev.tDetected ?? ev.tca ?? "event";
            if (evId !== lastEventIdRef.current) {
              lastEventIdRef.current = evId;
              setEventInfo(ev);
              onSimEventRef.current?.(ev);
            }
          }
        }
      } catch (err) {
        console.error("[OrbitalSim] poll error:", err);
      }
    };

    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [running]);

  // ── Status overlay text ──────────────────────────────────────────────────────
  const topLine =
    simStatus === "live"
      ? `T+${frameInfo.t.toFixed(0)} s  |  Frame ${frameInfo.frame + 1}/${frameInfo.total}  |  ${frameInfo.objects} objects`
      : simStatus === "error"
      ? "Sim: offline — check backend"
      : simStatus === "paused"
      ? "Simulation paused — press Start to begin"
      : "Sim: connecting…";

  return (
    <div className="flex-1 min-w-0 bg-[#00000a] rounded-2xl border border-neutral-800 relative overflow-hidden">

      {/* Three.js canvas */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Loading banner */}
      {simStatus === "loading" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <p className="text-cyan-400 font-mono text-xs tracking-widest animate-pulse">
            LOADING ORBITAL DATA…
          </p>
        </div>
      )}

      {/* Telemetry header */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 pt-4 text-center pointer-events-none select-none">
        <p className="text-xs text-neutral-200 font-mono tracking-wide">
          {topLine}&nbsp;&nbsp;|&nbsp;&nbsp;Regime: LEO&nbsp;&nbsp;|&nbsp;&nbsp;Earth Orbital Simulation
        </p>
        <p className="text-[11px] text-cyan-400/80 font-mono mt-0.5">
          Physics: Keplerian propagation · real CelesTrak TLE elements
        </p>
        <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
          Renderer: Three.js&nbsp;&nbsp;|&nbsp;&nbsp;dt = 30 s&nbsp;&nbsp;|&nbsp;&nbsp;Scale: 1 unit = 1 R⊕
        </p>
      </div>

      {/* SIM DASHBOARD */}
      <div className="absolute top-4 right-4 z-10 bg-neutral-950/85 border border-neutral-700/50 rounded-lg px-3.5 py-3 backdrop-blur-sm pointer-events-none select-none">
        <p className="text-[9px] text-neutral-500 uppercase tracking-widest mb-2 font-semibold">
          SIM DASHBOARD
        </p>
        <div className="space-y-0.5 text-[10px] font-mono text-neutral-400">
          <p>Objects: <span className="text-neutral-200">{frameInfo.objects || "—"}</span></p>
          <p>Frames:  <span className="text-neutral-200">{frameInfo.total   || "—"}</span></p>
          <p>SAT-01:  <span className="text-cyan-400">HST · LEO 485 km</span></p>
          <p>Hazard:  <span className="text-orange-400">COSMOS 2251 DEB</span></p>
          <p>Sim time: <span className="text-neutral-200">
            {simStatus === "live" ? `${frameInfo.t.toFixed(0)} s` : "—"}
          </span></p>
          <p>Status: <span className={
            simStatus === "live"   ? "text-green-400" :
            simStatus === "error"  ? "text-red-400"   :
            simStatus === "paused" ? "text-amber-400"  : "text-yellow-400"
          }>{simStatus}</span></p>
        </div>

        {eventInfo && (
          <div className="mt-2 pt-2 border-t border-neutral-700/40">
            <p className="text-[9px] text-red-400 uppercase tracking-widest mb-1">⚠ Conjunction</p>
            <p className="text-[10px] font-mono text-red-300">
              Pc = {(eventInfo.collisionProbability * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] font-mono text-red-300">
              {eventInfo.closestApproachDistanceM?.toFixed(0)} m miss
            </p>
            <p className="text-[10px] font-mono text-red-300">
              TCA: {eventInfo.timeToTca}
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none select-none space-y-0.5">
        <p className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest mb-1">Legend</p>
        <p className="text-[10px] font-mono"><span className="text-cyan-400">●</span> Satellite</p>
        <p className="text-[10px] font-mono"><span className="text-orange-400">●</span> Debris</p>
        <p className="text-[10px] font-mono"><span className="text-red-400">—</span> Conjunction path</p>
        <p className="text-[10px] font-mono text-neutral-600 mt-1">Drag to rotate · Scroll to zoom</p>
      </div>

    </div>
  );
}
