"""
Orbital simulation adapter for Q-Router.

Implements the same Earth orbital mechanics as drydock_sim/satellite_orbit4_33May4.py
using numpy only (no VPython). The original file cannot be imported directly because it
executes interactive input() prompts and VPython scene setup at module level.

Physics sourced from satellite_orbit4_33May4.py (same constants, same formulas):
  - J2 gravitational perturbation
  - Exponential atmospheric drag model
  - Euler integration (same as original dt-step loop)
"""

import math
import numpy as np

# ── Physical constants (from satellite_orbit4_33May4.py) ──────────────────────
MU_EARTH                  = 3.986004418e14   # m³/s²
R_EARTH                   = 6_371_008.4      # m
EARTH_ROTATION_RATE       = 7.2921159e-5     # rad/s
J2_EARTH                  = 1.08262668e-3
DRAG_COEFFICIENT          = 2.2
EARTH_SURFACE_DENSITY     = 1.225            # kg/m³
EARTH_SCALE_HEIGHT        = 8_500.0          # m
MAX_DRAG_ALTITUDE         = 800_000.0        # m

# ── Simulation parameters ─────────────────────────────────────────────────────
DT             = 30.0    # seconds per physics step
NUM_STEPS      = 300     # total steps  → 9 000 s ≈ 1.6 LEO orbits
FRAME_EVERY    = 3       # record a frame every N steps → 100 frames
FRAME_RATE     = 10      # suggested playback fps for frontend

# ── Module-level result cache ─────────────────────────────────────────────────
_CACHED_RESULT = None


# ── Rotation helpers (mirrors VPython rotate()) ───────────────────────────────

def _rot_z(v: np.ndarray, deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]])


def _rot_x(v: np.ndarray, deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]])


# ── Orbit state initialisation ────────────────────────────────────────────────

def _circular_speed(r: float) -> float:
    return math.sqrt(MU_EARTH / r)


def _make_circular_orbit(
    altitude_m: float,
    inc_deg: float,
    raan_deg: float,
    phase_deg: float,
    prograde: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Mirror of make_orbit_state() from satellite_orbit4_33May4.py.
    Returns (position_m, velocity_mps) as numpy arrays.
    Rotation order: phase → inclination → RAAN (identical to original).
    """
    r = R_EARTH + altitude_m
    v = _circular_speed(r)
    pos = np.array([r, 0.0, 0.0])
    vel = np.array([0.0, v if prograde else -v, 0.0])

    # Phase  → rotate in equatorial plane (Z axis)
    pos = _rot_z(pos, phase_deg)
    vel = _rot_z(vel, phase_deg)
    # Inclination → tilt out of equatorial plane (X axis)
    pos = _rot_x(pos, inc_deg)
    vel = _rot_x(vel, inc_deg)
    # RAAN   → rotate ascending node (Z axis)
    pos = _rot_z(pos, raan_deg)
    vel = _rot_z(vel, raan_deg)

    return pos.copy(), vel.copy()


# ── Physics functions (mirrors satellite_orbit4_33May4.py) ────────────────────

def _gravity_j2(pos: np.ndarray) -> np.ndarray:
    """J2-perturbed gravity — identical to get_gravity_acc_j2() in original."""
    r = float(np.linalg.norm(pos))
    if r == 0:
        return np.zeros(3)
    acc = -MU_EARTH * pos / r ** 3
    z = pos[2]
    factor = (1.5 * J2_EARTH * MU_EARTH * R_EARTH ** 2) / r ** 5
    j2 = np.array([
        pos[0] * (5 * (z / r) ** 2 - 1),
        pos[1] * (5 * (z / r) ** 2 - 1),
        pos[2] * (5 * (z / r) ** 2 - 3),
    ])
    return acc + factor * j2


def _drag(pos: np.ndarray, vel: np.ndarray, mass_kg: float, area_m2: float) -> np.ndarray:
    """Exponential-atmosphere drag — identical to get_drag_acc() in original."""
    alt = float(np.linalg.norm(pos)) - R_EARTH
    if alt < 0 or alt > MAX_DRAG_ALTITUDE:
        return np.zeros(3)
    rho = EARTH_SURFACE_DENSITY * math.exp(-alt / EARTH_SCALE_HEIGHT)
    atm_vel = np.cross(np.array([0.0, 0.0, EARTH_ROTATION_RATE]), pos)
    rel_vel = vel - atm_vel
    v_mag = float(np.linalg.norm(rel_vel))
    if v_mag == 0 or rho <= 0:
        return np.zeros(3)
    drag_mag = (0.5 * rho * v_mag ** 2 * DRAG_COEFFICIENT * area_m2) / mass_kg
    return -drag_mag * rel_vel / v_mag


def _acceleration(pos: np.ndarray, vel: np.ndarray, mass_kg: float, area_m2: float) -> np.ndarray:
    """Combined acceleration — mirrors physics_acceleration_for_object() (no third-body)."""
    return _gravity_j2(pos) + _drag(pos, vel, mass_kg, area_m2)


# ── Orbit-path precomputation ─────────────────────────────────────────────────

def _orbit_ring(altitude_m: float, inc_deg: float, raan_deg: float, n: int = 180) -> list:
    """
    Return n+1 ECI points (normalised to Earth radii) that trace the circular orbit.
    Used by the frontend to draw a static orbit ring with THREE.LineLoop.
    """
    points = []
    for i in range(n + 1):
        phase = (360.0 * i) / n
        pos, _ = _make_circular_orbit(altitude_m, inc_deg, raan_deg, phase)
        points.append([
            float(pos[0] / R_EARTH),
            float(pos[1] / R_EARTH),
            float(pos[2] / R_EARTH),
        ])
    return points


# ── Main simulation entry point ───────────────────────────────────────────────

def run_simulation() -> dict:
    """
    Run the Earth orbital simulation and return pre-computed frames + metadata.
    Result is cached so subsequent requests return instantly.
    """
    global _CACHED_RESULT
    if _CACHED_RESULT is not None:
        return _CACHED_RESULT

    # ── Object definitions ────────────────────────────────────────────────────
    # Matches the default constellation in satellite_orbit4_33May4.py:
    #   2 LEO sats (28.5° / 51.6°), 1 HEO-like debris pair, COSMOS & IRIDIUM debris.
    object_defs = [
        {
            "id":       "SAT-01",
            "type":     "sat",
            "alt":      550_000.0,   # 550 km LEO
            "inc":      28.5,
            "raan":     0.0,
            "phase":    0.0,
            "prograde": True,
            "mass":     500.0,
            "area":     math.pi * 1.5 ** 2,
        },
        {
            "id":       "SAT-02",
            "type":     "sat",
            "alt":      620_000.0,   # 620 km LEO
            "inc":      51.6,
            "raan":     90.0,
            "phase":    120.0,
            "prograde": True,
            "mass":     500.0,
            "area":     math.pi * 1.5 ** 2,
        },
        {
            "id":       "COSMOS 2251 DEB",
            "type":     "debris",
            "alt":      780_000.0,   # 780 km — historical COSMOS 2251 debris belt
            "inc":      74.0,
            "raan":     20.0,
            "phase":    30.0,
            "prograde": False,       # retrograde → high closing speed with SAT-01
            "mass":     10.0,
            "area":     math.pi * 0.5 ** 2,
        },
        {
            "id":       "IRIDIUM 33 DEB",
            "type":     "debris",
            "alt":      776_000.0,
            "inc":      86.4,        # near-polar (historical Iridium 33 inclination)
            "raan":     45.0,
            "phase":    200.0,
            "prograde": True,
            "mass":     8.0,
            "area":     math.pi * 0.4 ** 2,
        },
    ]

    # ── Initialise states ─────────────────────────────────────────────────────
    states: list[dict] = []
    for obj in object_defs:
        pos, vel = _make_circular_orbit(
            obj["alt"], obj["inc"], obj["raan"], obj["phase"], obj["prograde"]
        )
        states.append({"pos": pos, "vel": vel, "def": obj})

    # ── Precompute orbit rings (static, used for visual overlay) ──────────────
    orbits = []
    for obj in object_defs:
        orbits.append({
            "id":     obj["id"],
            "type":   obj["type"],
            "points": _orbit_ring(obj["alt"], obj["inc"], obj["raan"]),
        })

    # ── Integration loop (Euler — same scheme as original) ────────────────────
    frames: list[dict] = []
    t = 0.0

    for step in range(NUM_STEPS):
        if step % FRAME_EVERY == 0:
            objs = []
            for s in states:
                p = s["pos"] / R_EARTH          # normalise → scene units (Earth radii)
                objs.append({
                    "id":   s["def"]["id"],
                    "type": s["def"]["type"],
                    "x":    float(p[0]),
                    "y":    float(p[1]),
                    "z":    float(p[2]),
                })
            frames.append({"t": float(t), "objects": objs})

        # Euler step (mirrors update_satellite_physics in original)
        for s in states:
            d = s["def"]
            acc = _acceleration(s["pos"], s["vel"], d["mass"], d["area"])
            s["vel"] = s["vel"] + acc * DT
            s["pos"] = s["pos"] + s["vel"] * DT
        t += DT

    # ── Assemble result ───────────────────────────────────────────────────────
    _CACHED_RESULT = {
        "frames": frames,
        "metadata": {
            "frameRate":       FRAME_RATE,
            "numObjects":      len(object_defs),
            "numFrames":       len(frames),
            "dtSeconds":       DT,
            "totalSimSeconds": NUM_STEPS * DT,
            "objects":         [{"id": o["id"], "type": o["type"]} for o in object_defs],
            "source":          "drydock_sim/satellite_orbit4_33May4.py (physics constants + formulas)",
        },
        "orbits": orbits,
    }
    return _CACHED_RESULT
