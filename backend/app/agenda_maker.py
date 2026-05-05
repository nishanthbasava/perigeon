"""
agenda_maker.py
---------------
Deterministic scoring + agenda assembly layer.

Pipeline:
    collision JSON  →  parse scenario  →  RAG retrieval
    →  rule-based scoring  →  3 agenda options  →  structured response

No LLM calls. No vector DB rebuilding.
Calls retrieve_relevant_tasks() from the existing task_retriever module.
"""

from vector_db.task_retriever import retrieve_relevant_tasks

# ── Constants ──────────────────────────────────────────────────────────────────

_RISK_RANK = {"high": 3, "medium": 2, "low": 1}


# ── Safe value helpers ─────────────────────────────────────────────────────────

def _safe_float(v, default=None):
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _safe_bool(v, default=None):
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower() in ("true", "yes", "1", "nominal", "ok")
    return bool(v)


# ── Task classification helpers ────────────────────────────────────────────────

def _name_has(task: dict, *keywords) -> bool:
    name = task.get("task_name", "").lower()
    return any(kw.lower() in name for kw in keywords)


def _cat_has(task: dict, *keywords) -> bool:
    cat = task.get("task_category", "").lower()
    return any(kw.lower() in cat for kw in keywords)


# ── Scenario extraction ────────────────────────────────────────────────────────

def _extract_llm_features(collision_json: dict) -> list:
    """Return all feature objects where feature_group == 'llm'."""
    return [
        f for f in collision_json.get("features", [])
        if f.get("feature_group") == "llm"
    ]


def _select_scenario(llm_features: list) -> dict:
    """
    Pick the highest-priority scenario from the LLM feature rows.

    Priority order:
      1. risk_class: high > medium > low
      2. collision_probability_estimate (higher = worse)
      3. time_to_closest_approach_s (lower = more urgent)
      4. miss_distance_margin_m (lower = more dangerous)
    """
    if not llm_features:
        return {}

    def sort_key(f):
        risk  = str(f.get("risk_class") or "").lower()
        rank  = _RISK_RANK.get(risk, 0)
        pc    = _safe_float(f.get("collision_probability_estimate"), 0.0)
        tca   = _safe_float(f.get("time_to_closest_approach_s"),    1e9)
        miss  = _safe_float(f.get("miss_distance_margin_m"),        1e9)
        return (-rank, -(pc or 0), tca, miss)

    return sorted(llm_features, key=sort_key)[0]


# ── RAG query builder (direct-field format) ───────────────────────────────────

def _build_rag_query(s: dict) -> str:
    """Build a retrieval query from a scenario dict (direct-field LLM feature)."""
    def g(k):
        val = s.get(k)
        if val is None:
            return "unknown"
        if isinstance(val, list):
            return ", ".join(str(v) for v in val) or "none"
        return str(val)

    return (
        "Satellite collision avoidance scenario.\n"
        f"Risk class: {g('risk_class')}\n"
        f"Collision probability: {g('collision_probability_estimate')}\n"
        f"Time to closest approach: {g('time_to_closest_approach_s')} seconds\n"
        f"Closest approach distance: {g('closest_approach_distance_m')} meters\n"
        f"Target satellite: {g('target_satellite_id')}\n"
        f"Hazard object: {g('hazard_id')}\n"
        f"Can maneuver: {g('can_maneuver')}\n"
        f"Delta-v budget: {g('delta_v_budget_mps')} m/s\n"
        f"Fuel remaining: {g('fuel_remaining_kg')} kg\n"
        f"Thruster status: {g('thruster_status')}\n"
        f"Allowed maneuver types: {g('allowed_maneuver_types')}\n"
        f"Power risk: {g('power_risk_level')}\n"
        f"Thermal risk: {g('thermal_risk_level')}\n"
        f"Communication available: {g('communication_link_available')}\n"
        f"Communication risk: {g('communication_risk_level')}\n"
        f"Sensor confidence: {g('sensor_confidence')}\n"
        f"Trust level: {g('trust_level')}\n"
        f"Safe autonomous control: {g('safe_to_use_for_autonomous_control')}\n"
        "Retrieve tasks for orbit propagation, collision avoidance maneuver planning, "
        "sensor validation, communications, mission scheduling, human review, "
        "and quantum/classical optimization if relevant."
    )


# ── Task scoring ───────────────────────────────────────────────────────────────

def _score_tasks(tasks: list, s: dict) -> list:
    """
    Apply rule-based scoring on top of each task's RAG similarity score.

    Returns the same list enriched with:
        agenda_score, blocked (bool), warnings (list[str]), reason (str)
    Sorted descending by agenda_score.
    """
    risk        = str(s.get("risk_class") or "").lower()
    tca         = _safe_float(s.get("time_to_closest_approach_s"), 1e9)
    can_maneuver = _safe_bool(s.get("can_maneuver"), True)
    thruster    = str(s.get("thruster_status") or "").lower()
    thruster_ok = thruster in ("nominal", "ok", "operational", "good")
    dv_budget   = _safe_float(s.get("delta_v_budget_mps"),  1.0)
    fuel_kg     = _safe_float(s.get("fuel_remaining_kg"),   1.0)
    sensor_conf = _safe_float(s.get("sensor_confidence"),   1.0)
    trust       = str(s.get("trust_level") or "").lower()
    trust_low   = "downweighted" in trust or trust == "low"
    power_risk  = str(s.get("power_risk_level") or "").lower()
    power_crit  = power_risk in ("critical", "high")
    comms_ok    = _safe_bool(s.get("communication_link_available"), True)

    scored = []
    for t in tasks:
        base     = t["similarity_score"]
        delta    = 0.0
        warnings = []
        reasons  = []
        blocked  = False

        tid      = t.get("task_id", "")
        net_req  = t.get("network_required", "").lower()
        deadline = t.get("deadline_class",   "").lower()
        qcand    = t.get("quantum_candidate","").upper()

        # ── 1. Collision avoidance ─────────────────────────────────────────
        if _name_has(t, "collision avoidance") or tid == "SAT-03":
            if risk == "high":
                delta  += 0.35
                reasons.append("High-risk conjunction — avoidance maneuver prioritised.")
            elif risk == "medium":
                delta  += 0.25
                reasons.append("Medium-risk conjunction — avoidance maneuver relevant.")
            else:
                delta  += 0.10
                reasons.append("Low-risk conjunction — maneuver included for safety.")

        # ── 2. Orbit propagation ───────────────────────────────────────────
        if _name_has(t, "orbit propagation") or tid == "SAT-01":
            delta  += 0.25
            reasons.append("Orbit propagation required to refine close-approach prediction.")

        # ── 3. Scheduling / tasking ────────────────────────────────────────
        if (_name_has(t, "scheduling", "tasking", "ato", "constellation")
                or tid in ("SAT-02", "C2-05")):
            delta  += 0.20
            reasons.append("Scheduling task needed to coordinate multi-step response.")
            if qcand == "Y":
                delta  += 0.15
                reasons.append("Quantum optimisation candidate for scheduling.")

        # ── 4. Sensor validation boost (low trust / confidence) ────────────
        if sensor_conf < 0.75 or trust_low:
            if (_cat_has(t, "rf sensor", "sensor")
                    or _name_has(t, "geolocation", "tracking", "fusion",
                                  "classification", "aoa", "tdoa", "esprit",
                                  "music", "emitter", "modulation")):
                delta  += 0.25
                reasons.append("Sensor confidence is low — validation task boosted.")

        # ── 5. Comms penalty ───────────────────────────────────────────────
        if not comms_ok and net_req not in ("local", "none", "n/a", ""):
            delta   -= 0.40
            warnings.append(
                "Communication link unavailable — network-dependent task penalised."
            )

        # ── 6. Power penalty (non-essential sensing) ───────────────────────
        if power_crit:
            safety_critical = (
                _name_has(t, "collision avoidance", "orbit propagation")
                or tid in ("SAT-01", "SAT-03")
            )
            if not safety_critical and _name_has(t, "imaging", "camera", "video", "fmv"):
                delta   -= 0.25
                warnings.append("Power critical — non-essential imaging task penalised.")

        # ── 7. Thruster / can_maneuver block ──────────────────────────────
        if _name_has(t, "collision avoidance", "maneuver") or tid == "SAT-03":
            if not can_maneuver or not thruster_ok:
                delta  -= 0.75
                blocked = True
                msg = "Maneuver blocked:"
                if not thruster_ok:
                    msg += " thruster not nominal."
                if not can_maneuver:
                    msg += " satellite cannot maneuver."
                msg += " Requires human review."
                warnings.append(msg)

        # ── 8. Delta-v / fuel block ────────────────────────────────────────
        if _name_has(t, "collision avoidance", "maneuver") or tid == "SAT-03":
            if dv_budget is not None and dv_budget <= 0:
                blocked = True
                warnings.append("Delta-v budget exhausted — maneuver task blocked.")
            if fuel_kg is not None and fuel_kg <= 0:
                blocked = True
                warnings.append("Fuel depleted — maneuver task blocked.")

        # ── 9. Deadline urgency ────────────────────────────────────────────
        if tca is not None and tca < 600:   # < 10 minutes
            if deadline in ("hard-realtime", "soft-realtime"):
                delta  += 0.15
                reasons.append("Imminent TCA — realtime task boosted.")
            elif deadline == "batch":
                safety_critical = (
                    _name_has(t, "collision avoidance", "orbit propagation",
                               "constellation", "scheduling")
                    or tid in ("SAT-01", "SAT-02", "SAT-03", "C2-05")
                )
                if not safety_critical:
                    delta  -= 0.20
                    warnings.append("Imminent TCA — non-essential batch task penalised.")

        # ── 10. Quantum bonus (only for planning/optimisation tasks) ──────
        if qcand == "Y":
            quantum_ok = _name_has(t, "scheduling", "tasking", "routing",
                                    "assignment", "optimisation", "optimization",
                                    "constellation", "vehicle", "ato", "logistics")
            if quantum_ok:
                delta  += 0.10
                reasons.append("Quantum optimisation candidate for planning.")

        scored.append({
            **t,
            "agenda_score": round(base + delta, 4),
            "blocked":  blocked,
            "warnings": warnings,
            "reason":   " ".join(reasons) if reasons
                        else "Relevant to collision avoidance scenario.",
        })

    return sorted(scored, key=lambda x: x["agenda_score"], reverse=True)


# ── Task finders ───────────────────────────────────────────────────────────────

def _find(tasks: list, *predicates):
    """Return the first unblocked task matching any predicate."""
    for pred in predicates:
        for t in tasks:
            if not t.get("blocked") and pred(t):
                return t
    return None


def _find_orbit_prop(tasks):
    return _find(tasks,
        lambda t: t.get("task_id") == "SAT-01",
        lambda t: _name_has(t, "orbit propagation"),
    )


def _find_collision_avoid(tasks):
    return _find(tasks,
        lambda t: t.get("task_id") == "SAT-03",
        lambda t: _name_has(t, "collision avoidance"),
    )


def _find_scheduling(tasks):
    return _find(tasks,
        lambda t: t.get("task_id") in ("C2-05", "SAT-02"),
        lambda t: _name_has(t, "mission scheduling", "constellation tasking"),
        lambda t: _name_has(t, "scheduling", "tasking", "ato"),
    )


def _find_sensor_validation(tasks):
    return _find(tasks,
        lambda t: t.get("task_id") in ("RF-12", "RF-09", "RF-10", "RF-07", "RF-08"),
        lambda t: _name_has(t, "geolocation", "esprit", "music", "aoa"),
        lambda t: _cat_has(t, "rf sensor"),
        lambda t: _name_has(t, "track", "fusion", "correlation", "emitter"),
    )


def _find_routing(tasks):
    return _find(tasks,
        lambda t: t.get("task_id") in ("C2-03", "C2-02", "C2-06"),
        lambda t: _name_has(t, "multi-vehicle routing", "route planning", "logistics"),
        lambda t: _name_has(t, "routing"),
    )


# ── Formatting helpers ─────────────────────────────────────────────────────────

def _fmt_task(scored_task: dict, seq: int, sat_id: str,
              reason_override: str = None) -> dict:
    """Format a scored task dict for inclusion in an agenda task list."""
    return {
        "task_id":           scored_task["task_id"],
        "task_name":         scored_task["task_name"],
        "task_category":     scored_task["task_category"],
        "assigned_satellite": sat_id or "UNKNOWN",
        "sequence_order":    seq,
        "similarity_score":  scored_task["similarity_score"],
        "agenda_score":      scored_task["agenda_score"],
        "reason":            reason_override or scored_task.get("reason", ""),
    }


# ── Feasibility + confidence ───────────────────────────────────────────────────

def _assess(scored_refs: list, s: dict) -> tuple:
    """Return (feasibility: str, confidence: float) for an agenda."""
    can_maneuver  = _safe_bool(s.get("can_maneuver"), True)
    thruster      = str(s.get("thruster_status") or "").lower()
    thruster_ok   = thruster in ("nominal", "ok", "operational", "good")
    power_risk    = str(s.get("power_risk_level") or "").lower()
    comms_ok      = _safe_bool(s.get("communication_link_available"), True)
    auto_ok       = _safe_bool(s.get("safe_to_use_for_autonomous_control"), True)
    blocked_count = sum(1 for t in scored_refs if t.get("blocked"))
    avg           = (sum(t.get("agenda_score", 0) for t in scored_refs)
                     / len(scored_refs)) if scored_refs else 0

    issues = sum([
        not can_maneuver,
        not thruster_ok,
        power_risk in ("critical", "high"),
        not comms_ok,
        not auto_ok,
        blocked_count > 0,
    ])

    if issues == 0:
        return "high",   round(min(0.95, avg * 1.6), 2)
    elif issues <= 2:
        return "medium", round(min(0.72, avg * 1.3), 2)
    else:
        return "low",    round(min(0.40, avg),        2)


def _needs_review(s: dict, scored_refs: list) -> bool:
    can_maneuver = _safe_bool(s.get("can_maneuver"), True)
    thruster     = str(s.get("thruster_status") or "").lower()
    thruster_ok  = thruster in ("nominal", "ok", "operational", "good")
    auto_ok      = _safe_bool(s.get("safe_to_use_for_autonomous_control"), True)
    trust        = str(s.get("trust_level") or "").lower()
    risk         = str(s.get("risk_class") or "").lower()
    pc           = _safe_float(s.get("collision_probability_estimate"), 0.0)
    return any([
        not can_maneuver,
        not thruster_ok,
        not auto_ok,
        "downweighted" in trust,
        (risk == "high" and (pc or 0) > 0.1),
        any(t.get("blocked") for t in scored_refs),
    ])


def _unique_warnings(scored_refs: list) -> list:
    seen, out = set(), []
    for t in scored_refs:
        for w in t.get("warnings", []):
            if w not in seen:
                seen.add(w)
                out.append(w)
    return out


# ── Main pipeline ──────────────────────────────────────────────────────────────

def generate_agendas_from_collision(collision_json: dict,
                                     top_k: int = 10) -> dict:
    """
    Full agenda generation pipeline.

    Parameters
    ----------
    collision_json : dict with a 'features' list.  Feature objects with
                     feature_group == 'llm' should use the direct-field
                     format (e.g. feature['risk_class'], feature['can_maneuver']).
    top_k          : Number of tasks to retrieve from the vector DB.

    Returns
    -------
    Dict matching the agenda output spec, including:
        selected_collision_scenario, rag, reasoning_steps, agendas
    """
    steps = []

    def step(n, title, status, detail):
        steps.append({"step": n, "title": title,
                       "status": status, "detail": detail})

    # ── Step 1: Parse scenario ────────────────────────────────────────────
    llm_features = _extract_llm_features(collision_json)
    s = _select_scenario(llm_features)

    target_id  = s.get("target_satellite_id") or "UNKNOWN"
    hazard_id  = s.get("hazard_id")           or "UNKNOWN"
    risk_class = str(s.get("risk_class") or "unknown").lower()
    pc         = _safe_float(s.get("collision_probability_estimate"))
    tca        = _safe_float(s.get("time_to_closest_approach_s"))

    step(1, "Parsed collision scenario", "complete",
         f"Selected {target_id} vs {hazard_id}. "
         f"Risk: {risk_class}, Pc: {pc}, TCA: {tca} s.")

    # ── Step 2: Build RAG query ───────────────────────────────────────────
    rag_query = _build_rag_query(s)
    step(2, "Generated RAG query", "complete",
         "Built query using risk, maneuver, power, thermal, comms, and trust fields.")

    # ── Step 3: Retrieve tasks ─────────────────────────────────────────────
    try:
        retrieved = retrieve_relevant_tasks(rag_query, top_k=top_k)
    except (FileNotFoundError, ValueError) as exc:
        step(3, "Retrieved candidate tasks", "error", str(exc))
        return {
            "error": str(exc),
            "reasoning_steps": steps,
            "agendas": [],
        }

    if not retrieved:
        step(3, "Retrieved candidate tasks", "error",
             "No tasks found. Rebuild the task vector DB.")
        return {
            "error": "No tasks retrieved. Rebuild the task vector DB.",
            "reasoning_steps": steps,
            "agendas": [],
        }

    step(3, "Retrieved candidate tasks", "complete",
         f"Retrieved {len(retrieved)} tasks from the Chroma vector DB.")

    # ── Step 4: Logic gates / scoring ─────────────────────────────────────
    scored = _score_tasks(retrieved, s)
    blocked_n = sum(1 for t in scored if t.get("blocked"))
    step(4, "Applied logic gates", "complete",
         f"Applied safety constraints. "
         f"{blocked_n} task(s) blocked."
         + (" Maneuver requires human review." if blocked_n else ""))

    step(5, "Scored tasks", "complete",
         "Combined RAG similarity with feasibility, urgency, and mission constraints.")

    # ── Step 6: Build agendas ─────────────────────────────────────────────
    agendas = []

    # ── Agenda 1: Direct Collision Avoidance ──────────────────────────────
    op1  = _find_orbit_prop(scored)
    ca1  = _find_collision_avoid(scored)
    sch1 = _find_scheduling(scored)

    if op1 and ca1:
        task_refs = [op1, ca1]
        task_list = [
            _fmt_task(op1, 1, target_id,
                "Refine conjunction prediction before committing to burn."),
            _fmt_task(ca1, 2, target_id,
                "Execute collision avoidance maneuver."),
        ]
        if sch1:
            task_refs.append(sch1)
            task_list.append(_fmt_task(sch1, 3, target_id,
                "Coordinate maneuver with constellation scheduling."))

        feas1, conf1 = _assess(task_refs, s)
        agendas.append({
            "agenda_rank": 1,
            "agenda_name": "Direct Collision Avoidance",
            "agenda_type": "direct_avoidance",
            "target_satellite_id": target_id,
            "hazard_id": hazard_id,
            "risk_class": risk_class,
            "requires_human_review": _needs_review(s, task_refs),
            "estimated_feasibility": feas1,
            "confidence_score": conf1,
            "reasoning_summary": (
                f"Direct avoidance path for {target_id} vs {hazard_id}. "
                "Propagate orbit, execute burn, update constellation schedule."
            ),
            "tasks": task_list,
            "warnings": _unique_warnings(task_refs),
        })

    # ── Agenda 2: Validate Then Avoid ─────────────────────────────────────
    sens2 = _find_sensor_validation(scored)
    op2   = _find_orbit_prop(scored)
    ca2   = _find_collision_avoid(scored)
    sch2  = _find_scheduling(scored)

    task_refs2 = []
    task_list2 = []
    seq = 1
    if sens2:
        task_refs2.append(sens2)
        task_list2.append(_fmt_task(sens2, seq, target_id,
            "Validate sensor data and confirm conjunction geometry."))
        seq += 1
    if op2:
        task_refs2.append(op2)
        task_list2.append(_fmt_task(op2, seq, target_id,
            "Re-propagate orbit using validated sensor data."))
        seq += 1
    if ca2 and not ca2.get("blocked"):
        task_refs2.append(ca2)
        task_list2.append(_fmt_task(ca2, seq, target_id,
            "Execute avoidance maneuver if validation confirms risk."))
        seq += 1
    if sch2:
        task_refs2.append(sch2)
        task_list2.append(_fmt_task(sch2, seq, target_id,
            "Update mission schedule post-maneuver."))

    if len(task_list2) >= 2:
        feas2, conf2 = _assess(task_refs2, s)
        agendas.append({
            "agenda_rank": 2,
            "agenda_name": "Validate Then Avoid",
            "agenda_type": "validate_then_avoid",
            "target_satellite_id": target_id,
            "hazard_id": hazard_id,
            "risk_class": risk_class,
            "requires_human_review": _needs_review(s, task_refs2),
            "estimated_feasibility": feas2,
            "confidence_score": conf2,
            "reasoning_summary": (
                "Conservative path: validate sensor data before committing to burn. "
                "Reduces risk of unnecessary maneuver on uncertain conjunction data."
            ),
            "tasks": task_list2,
            "warnings": _unique_warnings(task_refs2),
        })

    # ── Agenda 3: Mission Replanning ──────────────────────────────────────
    op3   = _find_orbit_prop(scored)
    sch3  = _find_scheduling(scored)
    rte3  = _find_routing(scored)

    task_refs3 = []
    task_list3 = []
    seq = 1
    if op3:
        task_refs3.append(op3)
        task_list3.append(_fmt_task(op3, seq, target_id,
            "Continue orbit propagation for SA without committing to maneuver."))
        seq += 1
    if sch3:
        task_refs3.append(sch3)
        task_list3.append(_fmt_task(sch3, seq, target_id,
            "Replan constellation scheduling around the conjunction risk."))
        seq += 1
    if rte3:
        task_refs3.append(rte3)
        task_list3.append(_fmt_task(rte3, seq, target_id,
            "Re-route mission assets to protect primary objectives."))
        seq += 1

    # Pad with highest-score non-blocked tasks not already used
    used_ids = {t["task_id"] for t in task_list3}
    for t in scored:
        if t["task_id"] not in used_ids and not t.get("blocked"):
            if t.get("agenda_score", 0) > 0.20 and seq <= 5:
                task_refs3.append(t)
                task_list3.append(_fmt_task(t, seq, target_id,
                    "Supporting monitoring and situational awareness."))
                used_ids.add(t["task_id"])
                seq += 1

    if len(task_list3) >= 2:
        feas3, conf3 = _assess(task_refs3, s)
        agendas.append({
            "agenda_rank": 3,
            "agenda_name": "Mission Replanning",
            "agenda_type": "mission_replanning",
            "target_satellite_id": target_id,
            "hazard_id": hazard_id,
            "risk_class": risk_class,
            "requires_human_review": True,
            "estimated_feasibility": feas3,
            "confidence_score": conf3,
            "reasoning_summary": (
                "Non-maneuver contingency: protect mission continuity through "
                "constellation replanning rather than a direct avoidance burn."
            ),
            "tasks": task_list3,
            "warnings": _unique_warnings(task_refs3),
        })

    step(6, "Generated agendas", "complete",
         f"Built {len(agendas)} candidate agenda(s) for operator review.")

    return {
        "selected_collision_scenario": {
            "target_satellite_id": target_id,
            "hazard_id":           hazard_id,
            "risk_class":          risk_class,
            "collision_probability_estimate": pc,
            "time_to_closest_approach_s":     tca,
            "can_maneuver": _safe_bool(s.get("can_maneuver"), True),
        },
        "rag": {
            "generated_query":      rag_query,
            "retrieved_task_count": len(retrieved),
            "top_tasks": [
                {
                    "task_id":          t["task_id"],
                    "task_name":        t["task_name"],
                    "task_category":    t["task_category"],
                    "similarity_score": t["similarity_score"],
                }
                for t in retrieved
            ],
        },
        "reasoning_steps": steps,
        "agendas": agendas,
    }
