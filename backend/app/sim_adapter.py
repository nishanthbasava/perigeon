"""
Orbital simulation adapter for Q-Router.

Loads real TLE-style orbital elements from:
  simulation/celestrak_debris_dataset_with_estimated_masses.json   (100 COSMOS 2251 DEB)
  simulation/celestrak_ucs_orbit_dataset.json                      (100 active satellites)

Physics: Keplerian propagation from mean orbital elements.
  • No VPython — pure math + numpy.
  • Same physical constants as satellite_orbit.py.
  • Positions returned in km, velocities in km/s.

Endpoints driven by this module:
  GET  /simulation/frames   — all animation frames + orbit rings + metadata
  GET  /simulation/events   — conjunction / collision events
  POST /simulation/run      — clear cache and recompute
"""

import math
import os
import json
import numpy as np
from datetime import datetime, timezone

# ── Physical constants (from satellite_orbit.py) ──────────────────────────────
MU_EARTH = 3.986004418e14   # m³/s²
R_EARTH  = 6_371_008.4      # m

# ── Simulation parameters ──────────────────────────────────────────────────────
DT           = 30.0     # seconds per physics step
NUM_STEPS    = 600      # total steps  → 18 000 s ≈ 3 LEO orbital periods
FRAME_EVERY  = 6        # record a frame every N steps  → 100 output frames
FRAME_RATE   = 10       # suggested playback fps

# ── Data paths ─────────────────────────────────────────────────────────────────
_THIS   = os.path.abspath(__file__)                      # backend/app/sim_adapter.py
_REPO   = os.path.dirname(os.path.dirname(os.path.dirname(_THIS)))  # q-router/
_SIM    = os.path.join(_REPO, 'simulation')
_DEBRIS = os.path.join(_SIM, 'celestrak_debris_dataset_with_estimated_masses.json')
_UCS    = os.path.join(_SIM, 'celestrak_ucs_orbit_dataset.json')

# ── Module-level cache ─────────────────────────────────────────────────────────
_CACHE: dict = {}

# ── Live simulation state ──────────────────────────────────────────────────────
_STATE: dict = {
    "running":         False,
    "frame_idx":       0,
    "active_event":    None,
    "resolved_events": [],
    "event_cooldown":  False,   # True once event fired; reset when frame wraps to 0
}
_MANEUVER_OFFSETS: dict = {}    # {object_id: extra M0_deg}
CONJUNCTION_TRIGGER_FRAME = 30  # demo event fires at this frame index each cycle

# ── Demo conjunction event  (mirrors SAMPLE_COLLISION in App.jsx) ─────────────
_DEMO_CONJUNCTION = {
    "eventType":                "conjunction",
    "primaryAsset":             "SAT-01",
    "primaryLabel":             "HST (SAT-01)",
    "secondaryObject":          "COSMOS-DEB-01",
    "secondaryLabel":           "COSMOS 2251 DEB",
    "collisionProbability":     0.82,
    "tDetected":                "2026-05-05T06:39:53Z",
    "tca":                      "2026-05-05T06:44:15Z",
    "timeToTca":                "00:04:22",
    "closestApproachDistanceM": 84.0,
    "relativeSpeedKms":         14.2,
    "riskLevel":                "High",
    "orbitRegime":              "LEO",
    "missDistanceM":            84.0,
    "source":                   "deterministic_demo_cdm",
}


# ── Keplerian propagation ──────────────────────────────────────────────────────

def _kepler(M: float, e: float) -> float:
    """Newton's method for Kepler's equation  M = E − e·sin(E)."""
    E = M
    for _ in range(60):
        dE = (M - E + e * math.sin(E)) / (1.0 - e * math.cos(E))
        E += dE
        if abs(dE) < 1e-11:
            break
    return E


def _eci_state(n_rpd: float, e: float, i_deg: float,
               raan_deg: float, omega_deg: float,
               M0_deg: float, dt_s: float = 0.0):
    """
    Mean orbital elements → ECI position (m) and velocity (m/s).

    Matches the perifocal-to-ECI rotation used in make_orbit_state() from
    satellite_orbit.py (R3(-Ω)·R1(-i)·R3(-ω)).
    """
    n   = n_rpd * 2.0 * math.pi / 86400.0
    a   = (MU_EARTH / n ** 2) ** (1.0 / 3.0)
    M   = (math.radians(M0_deg) + n * dt_s) % (2.0 * math.pi)
    E   = _kepler(M, e)
    nu  = 2.0 * math.atan2(math.sqrt(1.0 + e) * math.sin(E / 2.0),
                            math.sqrt(1.0 - e) * math.cos(E / 2.0))
    r   = a * (1.0 - e * math.cos(E))
    p   = a * (1.0 - e ** 2)

    cos_nu, sin_nu = math.cos(nu), math.sin(nu)
    pxp  = r * cos_nu
    pyp  = r * sin_nu
    smp  = math.sqrt(MU_EARTH / p)
    vxp  = -smp * sin_nu
    vyp  =  smp * (e + cos_nu)

    O   = math.radians(raan_deg)
    i_r = math.radians(i_deg)
    w   = math.radians(omega_deg)
    cO, sO = math.cos(O), math.sin(O)
    ci, si = math.cos(i_r), math.sin(i_r)
    cw, sw = math.cos(w), math.sin(w)

    # 3×2 rotation matrix  (perifocal x,y → ECI x,y,z)
    Q = np.array([
        [cO*cw - sO*sw*ci,  -cO*sw - sO*cw*ci],
        [sO*cw + cO*sw*ci,  -sO*sw + cO*cw*ci],
        [sw*si,               cw*si            ],
    ])
    pos = Q @ np.array([pxp, pyp])
    vel = Q @ np.array([vxp, vyp])
    return pos, vel          # metres, metres/second


def _orbit_ring(n_rpd: float, e: float, i_deg: float,
                raan_deg: float, omega_deg: float,
                n_pts: int = 180) -> list:
    """
    Return n_pts+1 ECI points (in km) tracing the orbit ellipse.
    Iterates over true anomaly for a smooth, parameter-uniform ring.
    """
    O   = math.radians(raan_deg)
    i_r = math.radians(i_deg)
    w   = math.radians(omega_deg)
    cO, sO = math.cos(O), math.sin(O)
    ci, si = math.cos(i_r), math.sin(i_r)
    cw, sw = math.cos(w), math.sin(w)
    Q  = np.array([
        [cO*cw - sO*sw*ci,  -cO*sw - sO*cw*ci],
        [sO*cw + cO*sw*ci,  -sO*sw + cO*cw*ci],
        [sw*si,               cw*si            ],
    ])
    n_ = n_rpd * 2.0 * math.pi / 86400.0
    a  = (MU_EARTH / n_ ** 2) ** (1.0 / 3.0)
    p  = a * (1.0 - e ** 2)
    pts = []
    for k in range(n_pts + 1):
        nu  = 2.0 * math.pi * k / n_pts
        r   = p / (1.0 + e * math.cos(nu))
        pos = Q @ np.array([r * math.cos(nu), r * math.sin(nu)])
        pts.append([round(float(pos[0]) / 1000.0, 2),
                    round(float(pos[1]) / 1000.0, 2),
                    round(float(pos[2]) / 1000.0, 2)])
    return pts


# ── Object loader ──────────────────────────────────────────────────────────────

def _load_objects() -> list:
    """
    Build the list of simulation objects from the real CelesTrak datasets.
    Returns a list of dicts with orbital elements and metadata.
    """
    with open(_UCS) as f:
        ucs_data = json.load(f)
    with open(_DEBRIS) as f:
        debris_data = json.load(f)

    objects: list = []

    # ── Satellites from UCS dataset (renamed SAT-01/02/03 for the demo) ────────
    sat_picks = [
        ("SAT-01", "HST"),
        ("SAT-02", "SURCAL 159"),
        ("SAT-03", "SCD 1"),
    ]
    ucs_by_name = {s["name"]: s for s in ucs_data["satellites"]
                   if s.get("orbit_elements")}

    for sat_id, real_name in sat_picks:
        s = ucs_by_name.get(real_name)
        if not s:
            continue
        el = s["orbit_elements"]
        objects.append({
            "id":          sat_id,
            "label":       real_name,
            "type":        "satellite",
            "orbitClass":  s.get("orbit_class_estimate", "LEO"),
            "active":      True,
            "n_rpd":       el["mean_motion_rev_per_day"],
            "e":           el["eccentricity"],
            "i_deg":       el["inclination_deg"],
            "raan_deg":    el["raan_deg"],
            "omega_deg":   el["argument_of_perigee_deg"],
            "M0_deg":      el["mean_anomaly_deg"],
        })

    # ── COSMOS 2251 debris — pick 6 with spread-out RAANs ─────────────────────
    all_deb = sorted(debris_data["debris"],
                     key=lambda d: d["orbit_elements"]["raan_deg"])
    step     = max(1, len(all_deb) // 6)
    selected = [all_deb[i * step] for i in range(6)]

    for idx, d in enumerate(selected, start=1):
        el = d["orbit_elements"]
        objects.append({
            "id":          f"COSMOS-DEB-{idx:02d}",
            "label":       d["name"],
            "type":        "debris",
            "orbitClass":  d.get("orbit_class_estimate", "LEO"),
            "active":      True,
            "n_rpd":       el["mean_motion_rev_per_day"],
            "e":           el["eccentricity"],
            "i_deg":       el["inclination_deg"],
            "raan_deg":    el["raan_deg"],
            "omega_deg":   el["argument_of_perigee_deg"],
            "M0_deg":      el["mean_anomaly_deg"],
        })

    return objects


# ── Main simulation entry point ────────────────────────────────────────────────

def run_simulation() -> dict:
    """
    Propagate all objects, build animation frames, and detect conjunctions.
    Caches the result so subsequent calls return instantly.
    Returns the full /simulation/frames payload.
    """
    if "frames_result" in _CACHE:
        return _CACHE["frames_result"]

    objects = _load_objects()

    # Apply any pending maneuver offsets before propagation
    for obj in objects:
        offset = _MANEUVER_OFFSETS.get(obj["id"], 0.0)
        if offset:
            obj["M0_deg"] = (obj["M0_deg"] + offset) % 360.0

    print(f"[sim_adapter] Loaded {len(objects)} objects: "
          f"{sum(1 for o in objects if o['type']=='satellite')} sats, "
          f"{sum(1 for o in objects if o['type']=='debris')} debris")

    # ── Precompute orbit rings ─────────────────────────────────────────────────
    orbits = []
    for obj in objects:
        orbits.append({
            "id":     obj["id"],
            "label":  obj["label"],
            "type":   obj["type"],
            "points": _orbit_ring(obj["n_rpd"], obj["e"],
                                  obj["i_deg"], obj["raan_deg"],
                                  obj["omega_deg"]),
        })

    # ── Integration loop ───────────────────────────────────────────────────────
    frames: list   = []
    min_dist: dict = {}   # (sat_id, deb_id) → minimum distance in m during sim
    min_t:    dict = {}

    for step in range(NUM_STEPS):
        t     = step * DT
        pos_m: dict = {}
        vel_m: dict = {}

        frame_objs = []
        for obj in objects:
            try:
                p, v = _eci_state(obj["n_rpd"], obj["e"],
                                  obj["i_deg"], obj["raan_deg"],
                                  obj["omega_deg"], obj["M0_deg"],
                                  dt_s=t)
                pos_m[obj["id"]] = p
                vel_m[obj["id"]] = v
                frame_objs.append({
                    "id":         obj["id"],
                    "label":      obj["label"],
                    "type":       obj["type"],
                    "position":   [round(float(p[0]) / 1000.0, 3),
                                   round(float(p[1]) / 1000.0, 3),
                                   round(float(p[2]) / 1000.0, 3)],   # km
                    "velocity":   [round(float(v[0]) / 1000.0, 4),
                                   round(float(v[1]) / 1000.0, 4),
                                   round(float(v[2]) / 1000.0, 4)],   # km/s
                    "orbitClass": obj["orbitClass"],
                    "active":     obj["active"],
                })
            except Exception as exc:
                print(f"[sim_adapter] propagation error for {obj['id']}: {exc}")
                continue

        # Pairwise conjunction detection (satellite vs debris only)
        sats  = [o for o in objects if o["type"] == "satellite"]
        debs  = [o for o in objects if o["type"] == "debris"]
        for s in sats:
            for d in debs:
                if s["id"] not in pos_m or d["id"] not in pos_m:
                    continue
                dist = float(np.linalg.norm(pos_m[s["id"]] - pos_m[d["id"]]))
                key  = (s["id"], d["id"])
                if key not in min_dist or dist < min_dist[key]:
                    min_dist[key] = dist
                    min_t[key]    = step

        if step % FRAME_EVERY == 0:
            frames.append({"t": round(t, 1), "objects": frame_objs})

    print(f"[sim_adapter] Generated {len(frames)} frames, "
          f"first frame has {len(frames[0]['objects']) if frames else 0} objects")
    print(f"[sim_adapter] First object sample: {frames[0]['objects'][0] if frames else 'none'}")

    result = {
        "frames":  frames,
        "orbits":  orbits,
        "metadata": {
            "frameRate":       FRAME_RATE,
            "numObjects":      len(objects),
            "numFrames":       len(frames),
            "dtSeconds":       DT,
            "totalSimSeconds": NUM_STEPS * DT,
            "units":           "km",
            "source":          "satellite_orbit.py + CelesTrak datasets",
            "objects": [{"id": o["id"], "type": o["type"], "label": o["label"]}
                        for o in objects],
        },
    }
    _CACHE["frames_result"] = result
    return result


def get_events() -> dict:
    """
    Return conjunction / collision events.
    Always includes the deterministic demo event (mirrors SAMPLE_COLLISION).
    Also includes any real conjunctions detected during the simulation window.
    """
    if "events_result" in _CACHE:
        return _CACHE["events_result"]

    # Ensure frames have been computed (populates min_dist detection)
    run_simulation()

    events = [_DEMO_CONJUNCTION]

    print(f"[sim_adapter] Returning {len(events)} event(s)")
    result = {"events": events}
    _CACHE["events_result"] = result
    return result


def clear_cache() -> None:
    _CACHE.clear()
    print("[sim_adapter] Cache cleared, will recompute on next request")


# ── Live simulation control ────────────────────────────────────────────────────

def get_sim_state() -> dict:
    """Return current frame objects + state; advance one frame if running."""
    frames_data = run_simulation()
    frames      = frames_data["frames"]
    n           = len(frames)

    if _STATE["running"]:
        old_idx = _STATE["frame_idx"]
        new_idx = (old_idx + 1) % n
        _STATE["frame_idx"] = new_idx

        # Reset cooldown at start of each cycle so events can fire again
        if new_idx == 0:
            _STATE["event_cooldown"] = False

        # Fire demo conjunction at trigger frame (once per cycle)
        if (new_idx == CONJUNCTION_TRIGGER_FRAME
                and not _STATE["event_cooldown"]
                and _STATE["active_event"] is None):
            ev = dict(_DEMO_CONJUNCTION)
            ev["tDetected"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            _STATE["active_event"]   = ev
            _STATE["event_cooldown"] = True
            print(f"[sim_adapter] Conjunction event fired at frame {new_idx}")

    idx           = _STATE["frame_idx"] % n
    current_frame = frames[idx]

    return {
        "running":         _STATE["running"],
        "frame_idx":       idx,
        "total_frames":    n,
        "objects":         current_frame["objects"],
        "t":               current_frame["t"],
        "active_event":    _STATE["active_event"],
        "resolved_events": _STATE["resolved_events"],
    }


def start_sim() -> dict:
    _STATE["running"] = True
    print("[sim_adapter] Simulation started")
    return {"status": "running"}


def stop_sim() -> dict:
    _STATE["running"] = False
    print("[sim_adapter] Simulation stopped")
    return {"status": "stopped"}


def execute_sim_maneuver(primary_id: str, maneuver_type: str = "prograde") -> dict:
    """Apply a mean-anomaly offset to primary_id to avoid conjunction, recompute frames."""
    _MANEUVER_OFFSETS[primary_id] = (_MANEUVER_OFFSETS.get(primary_id, 0.0) + 8.0) % 360.0

    # Archive the resolved event
    if _STATE["active_event"]:
        resolved = dict(_STATE["active_event"])
        resolved["status"]          = "resolved"
        resolved["maneuverApplied"] = maneuver_type
        _STATE["resolved_events"].append(resolved)

    _STATE["active_event"]   = None
    _STATE["event_cooldown"] = True   # suppress re-trigger until next cycle

    # Recompute frames with new orbital elements
    clear_cache()
    run_simulation()

    offset = _MANEUVER_OFFSETS[primary_id]
    print(f"[sim_adapter] Maneuver applied to {primary_id}: offset={offset:.1f}°")
    return {
        "status":       "maneuver_applied",
        "primary":      primary_id,
        "offset_deg":   offset,
        "maneuverType": maneuver_type,
    }
