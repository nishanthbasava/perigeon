import { useEffect, useRef, useState, useCallback } from "react";
import Papa from "papaparse";
import * as THREE from "three";
import OrbitalSimulation from "./OrbitalSimulation";

// ─── Static data ──────────────────────────────────────────────────

const STARS = [
  [45, 28, 0.8], [130, 72, 0.6], [78, 145, 0.7], [195, 45, 0.5],
  [290, 18, 0.9], [440, 35, 0.6], [590, 28, 0.7], [710, 55, 0.5],
  [795, 95, 0.8], [858, 38, 0.6], [28, 195, 0.7], [118, 272, 0.5],
  [812, 192, 0.6], [872, 295, 0.8], [742, 372, 0.5], [58, 392, 0.7],
  [172, 492, 0.6], [342, 545, 0.5], [492, 515, 0.8], [642, 472, 0.6],
  [812, 512, 0.7], [38, 512, 0.5], [198, 412, 0.6], [392, 452, 0.7],
  [248, 315, 0.5], [692, 275, 0.8], [782, 442, 0.6], [98, 452, 0.5],
  [612, 155, 0.7], [755, 145, 0.6], [320, 88, 0.5], [520, 110, 0.8],
  [660, 80, 0.6], [840, 165, 0.7], [22, 338, 0.5], [158, 358, 0.6],
  [878, 422, 0.8], [478, 38, 0.5], [728, 498, 0.6], [562, 555, 0.7],
];

const SAMPLE_COLLISION = {
  features: [
    { feature_group: "llm", feature_name: "risk_class",               value: "HIGH" },
    { feature_group: "llm", feature_name: "collision_probability",    value: "0.18" },
    { feature_group: "llm", feature_name: "time_to_closest_approach", value: "15120" },
    { feature_group: "llm", feature_name: "miss_distance_m",          value: "42" },
    { feature_group: "llm", feature_name: "target_satellite",         value: "SAT-01" },
    { feature_group: "llm", feature_name: "hazard_object",            value: "COSMOS-2251-DEB" },
    { feature_group: "llm", feature_name: "can_maneuver",             value: "yes" },
    { feature_group: "llm", feature_name: "delta_v_budget",           value: "2.1 m/s" },
    { feature_group: "llm", feature_name: "fuel_remaining",           value: "38%" },
    { feature_group: "llm", feature_name: "thruster_status",          value: "nominal" },
    { feature_group: "llm", feature_name: "allowed_maneuver_types",   value: "prograde, radial" },
    { feature_group: "llm", feature_name: "power_risk",               value: "low" },
    { feature_group: "llm", feature_name: "thermal_risk",             value: "low" },
    { feature_group: "llm", feature_name: "communication_available",  value: "yes" },
    { feature_group: "llm", feature_name: "communication_risk",       value: "low" },
    { feature_group: "llm", feature_name: "sensor_confidence",        value: "0.92" },
    { feature_group: "llm", feature_name: "trust_level",              value: "high" },
    { feature_group: "llm", feature_name: "safe_autonomous_control",  value: "yes" },
    { feature_group: "ml",  feature_name: "raw_pc",                   value: "0.18" },
  ],
};

// ─── CSV helpers ─────────────────────────────────────────────────

const REQUIRED_CSV_FIELDS = [
  "object_id", "hazard_id", "risk_class", "collision_probability_estimate",
  "time_to_closest_approach_s", "closest_approach_distance_m", "closing_speed_mps",
  "can_maneuver", "mission_priority", "fuel_remaining_kg", "max_delta_v_mps",
  "power_state", "thermal_state", "comms_state", "tcad_trust_level",
  "safe_to_autonomously_execute",
];

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "1", "yes", "y"].includes(value.toLowerCase().trim());
  }
  return false;
}

function convertCSVRowToFeatures(row) {
  return [
    {
      feature_group: "collision",
      object_id: row.object_id,
      hazard_id: row.hazard_id,
      object_type: row.object_type || "satellite",
      active: parseBool(row.active ?? true),
      can_maneuver: parseBool(row.can_maneuver),
      collision_probability_estimate: Number(row.collision_probability_estimate),
      risk_class: row.risk_class,
      time_to_closest_approach_s: Number(row.time_to_closest_approach_s),
      closest_approach_distance_m: Number(row.closest_approach_distance_m),
      closing_speed_mps: Number(row.closing_speed_mps),
    },
    {
      feature_group: "llm",
      hazard_id: row.hazard_id,
      target_satellite_id: row.object_id,
      mission_priority: row.mission_priority,
      fuel_remaining_kg: Number(row.fuel_remaining_kg),
      max_delta_v_mps: Number(row.max_delta_v_mps),
      power_state: row.power_state,
      thermal_state: row.thermal_state,
      comms_state: row.comms_state,
      tcad_trust_level: Number(row.tcad_trust_level),
      safe_to_autonomously_execute: parseBool(row.safe_to_autonomously_execute),
      maneuver_constraints: {
        max_burn_duration_s: row.max_burn_duration_s ? Number(row.max_burn_duration_s) : 120,
        preferred_directions: row.preferred_directions
          ? row.preferred_directions.split("|").map((s) => s.trim())
          : ["prograde"],
        forbidden_directions: row.forbidden_directions
          ? row.forbidden_directions.split("|").map((s) => s.trim())
          : [],
      },
    },
  ];
}

function validateCSVRow(row) {
  const missing = REQUIRED_CSV_FIELDS.filter((f) => row[f] == null || row[f] === "");
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(", ")}`;
  }
  return null;
}

const STATIC_STEPS = [
  {
    id: 1, label: "Conjunction Risk", type: "risk",
    text: <>Possible collision between <span className="font-mono text-neutral-300">SAT-01</span> and <span className="font-mono text-neutral-300">COSMOS 2251</span> debris.</>,
    detail: "Miss distance falls below projected safety threshold.",
  },
  {
    id: 2, label: "Maneuver Window", type: "maneuver",
    text: <>Evaluating burn timing around <span className="font-mono text-neutral-300">T+00:04:22</span>.</>,
    detail: <>Prioritizing low-<span className="font-mono">Δv</span> options before escalation.</>,
  },
  {
    id: 3, label: "Routing Check", type: "routing",
    text: "Scoring whether the task should remain classical or route to quantum optimization.",
    detail: "Latency, task size, priority, and uncertainty gates are being evaluated.",
  },
  {
    id: 4, label: "Next Action", type: "thinking",
    text: "Awaiting analyst instruction before generating maneuver candidates.",
    detail: "Suggested actions are available below.",
  },
];

const STEP_DOT = {
  risk: "bg-red-400", maneuver: "bg-amber-400", routing: "bg-cyan-400", thinking: "bg-violet-400",
};
const STEP_ACCENT = {
  risk: "bg-red-500/50", maneuver: "bg-amber-500/50", routing: "bg-cyan-500/50", thinking: "bg-violet-500/50",
};

const FEASIBILITY_COLOR = {
  high:   "text-green-400",
  medium: "text-amber-400",
  low:    "text-red-400",
};

// Display metadata keyed by 1-based rank position
const AGENDA_META = [
  { label: "Conservative Avoidance", strategy: "Low-risk maneuver path",          defaultConfidence: 82 },
  { label: "Monitor + Validate",     strategy: "Sensor-first verification",        defaultConfidence: 74 },
  { label: "Rapid Response",         strategy: "Fastest intervention sequence",    defaultConfidence: 68 },
];

// Shared demo scenario — single source of truth for UI display and HTML export.
// Values are used as fallbacks when the backend scenario fields are absent/null.
const DEMO_SCENARIO = {
  primaryAsset:      "SAT-01",
  secondaryObject:   "COSMOS 2251 DEB",
  collisionPc:       "0.82",
  tca:               "2026-05-05 06:44:15 UTC",
  timeToTca:         "00:04:22",
  orbitRegime:       "LEO",
  closestApproachM:  "84 m",
  relativeSpeedKms:  "14.2 km/s",
  riskLevel:         "High",
};

// Zero-padded step number from 0-based array index
function getStepNumber(index) {
  return String(index + 1).padStart(2, "0");
}

// ─── Export helpers ───────────────────────────────────────────────

function getAssignedAssets(task) {
  const name = (task.task_name ?? "").toLowerCase();
  const cat  = (task.category  ?? "").toLowerCase();
  if (name.includes("geolocation") || name.includes("tdoa") || name.includes("sensor fusion") || cat.includes("rf sensor"))
    return ["SAT-01", "Ground Sensor Network"];
  if (name.includes("orbit") || name.includes("propagat") || name.includes("sgp4"))
    return ["Flight Dynamics Workstation", "SAT-01 Telemetry"];
  if (name.includes("maneuver") || name.includes("burn") || name.includes("avoidance"))
    return ["SAT-01"];
  if (name.includes("vrp") || name.includes("multi-vehicle") || name.includes("routing"))
    return ["Mission Planning System", "SAT-01"];
  if (name.includes("weapon") || name.includes("target assignment") || name.includes("wta"))
    return ["Ground Operations", "Tracking Network"];
  if (name.includes("schedul") || name.includes("tasking") || name.includes("mission plan") || cat.includes("jadc2"))
    return ["Mission Planning System"];
  if (name.includes("monitor") || name.includes("situational") || name.includes("awareness"))
    return ["Ground Operations", "SAT-01"];
  return ["Analyst Review"];
}

function getTaskDecisionDetails(task) {
  const name = (task.task_name ?? "").toLowerCase();
  const cat  = (task.category  ?? "").toLowerCase();

  let whySelected  = task.reason || "Retrieved from task database as a relevant step for this conjunction scenario.";
  let inputSignals = ["Collision features", "Sensor telemetry", "Orbital state vectors"];
  let expectedOutput = "Processed result for downstream maneuver planning.";
  let analystNote    = "Review output before approving downstream tasks.";

  if (name.includes("geolocation") || name.includes("tdoa") || name.includes("sensor")) {
    inputSignals   = ["Relative position", "Relative velocity", "Sensor confidence", "Tracking source", "Covariance matrix"];
    expectedOutput = "Validated conjunction geometry and updated confidence estimate.";
    analystNote    = "Confirm sensor quality before approving downstream maneuver tasks.";
  } else if (name.includes("orbit") || name.includes("propagat")) {
    inputSignals   = ["TLE / state vector", "J2 perturbation model", "Atmospheric drag coefficients", "Epoch time"];
    expectedOutput = "Updated orbital ephemeris with propagated miss distance and uncertainty cone.";
    analystNote    = "Verify propagation epoch and confirm debris track covariance before accepting.";
  } else if (name.includes("maneuver") || name.includes("burn") || name.includes("avoidance")) {
    inputSignals   = ["Delta-v budget", "Thruster status", "Fuel remaining", "Allowed maneuver directions", "TCA window"];
    expectedOutput = "Candidate burn parameters with estimated post-maneuver miss distance.";
    analystNote    = "Confirm Δv feasibility against fuel margins. Human approval required before uplink.";
  } else if (name.includes("schedul") || cat.includes("jadc2")) {
    inputSignals   = ["Mission timeline", "Priority queue", "Resource availability", "Constellation state"];
    expectedOutput = "Updated mission schedule with deconflicted task windows.";
    analystNote    = "Validate schedule against operator constraints before propagating to constellation.";
  } else if (name.includes("crypt") || cat.includes("comms")) {
    inputSignals   = ["Communication window", "Link budget", "Encryption state", "Ground station availability"];
    expectedOutput = "Encrypted command package ready for uplink.";
    analystNote    = "Confirm comms window and encryption key validity before transmission.";
  }

  const quantum = task.quantum_candidate === "yes";
  const logicGates = [
    { name: "Urgency",      result: "Pass" },
    { name: "Feasibility",  result: "Pass" },
    { name: "Comms",        result: "Pass" },
    { name: "QuantumNeed",  result: quantum ? "Pass - quantum route selected" : "Fail - classical route sufficient" },
  ];

  return { whySelected, inputSignals, logicGates, expectedOutput, analystNote };
}

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;");
}

function agendaToHtmlReport(agenda, index) {
  const meta    = AGENDA_META[index] ?? AGENDA_META[0];
  const rawConf = agenda.confidence * 100;
  const conf    = Number.isFinite(rawConf) ? Math.round(rawConf) : meta.defaultConfidence;
  const sc        = agenda.scenario ?? {};
  const primary   = sc.target_satellite || DEMO_SCENARIO.primaryAsset;
  const secondary = sc.hazard_object    || DEMO_SCENARIO.secondaryObject;
  const pc        = sc.collision_probability != null ? String(sc.collision_probability) : DEMO_SCENARIO.collisionPc;
  const tca       = sc.tca_seconds != null
    ? `${(sc.tca_seconds / 3600).toFixed(2)} hr`
    : DEMO_SCENARIO.tca;
  const now       = new Date().toLocaleString("en-US", { timeZoneName: "short" });

  const taskRows = (agenda.tasks ?? []).map((t, i) => {
    const assets  = getAssignedAssets(t);
    const details = getTaskDecisionDetails(t);
    const route   = t.quantum_candidate === "yes" ? "Quantum" : "Classical";
    const stepNum = getStepNumber(i);
    return `
      <tr>
        <td>${escapeHtml(stepNum)}</td>
        <td><strong>${escapeHtml(t.task_name)}</strong></td>
        <td>${escapeHtml(assets.join(", "))}</td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(t.reason || details.whySelected)}</td>
        <td>${escapeHtml(details.expectedOutput)}</td>
      </tr>`;
  }).join("\n");

  const rationaleRows = (agenda.tasks ?? []).map((t) => {
    const details = getTaskDecisionDetails(t);
    const gatesStr = details.logicGates.map((g) => `${g.name}: ${g.result}`).join(" | ");
    return `
      <tr>
        <td><strong>${escapeHtml(t.task_name)}</strong></td>
        <td>${escapeHtml(details.whySelected)}</td>
        <td>${escapeHtml(details.inputSignals.join(", "))}</td>
        <td>${escapeHtml(gatesStr)}</td>
        <td>${escapeHtml(details.analystNote)}</td>
      </tr>`;
  }).join("\n");

  const warningsHtml = agenda.warnings && agenda.warnings.length > 0
    ? `<p><strong>Warnings:</strong> ${agenda.warnings.map(escapeHtml).join("; ")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Perigeon Maneuver Agenda Report — ${escapeHtml(meta.label)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; margin: 40px; line-height: 1.45; }
    .classification { text-align: center; font-weight: bold; letter-spacing: 0.08em; border-top: 2px solid #111; border-bottom: 2px solid #111; padding: 8px 0; margin-bottom: 24px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 28px; border-bottom: 1px solid #999; padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #aaa; padding: 8px; vertical-align: top; text-align: left; }
    th { background: #f2f2f2; font-weight: bold; }
    .meta-grid { display: grid; grid-template-columns: 180px 1fr; gap: 6px 12px; font-size: 14px; margin-top: 12px; }
    .label { font-weight: bold; }
    .footer { margin-top: 36px; font-size: 12px; color: #555; border-top: 1px solid #aaa; padding-top: 12px; }
    .tag { display: inline-block; background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: bold; margin-left: 8px; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="classification">DRAFT — FOR ANALYST REVIEW</div>

  <h1>Perigeon Maneuver Agenda Recommendation <span class="tag">Agenda ${index + 1}</span></h1>
  <p>Generated by Perigeon Orbital AI Copilot. This is a draft recommendation requiring human analyst review.</p>

  <h2>1. Report Metadata</h2>
  <div class="meta-grid">
    <div class="label">Report Type</div><div>Maneuver Agenda Recommendation</div>
    <div class="label">Generated At</div><div>${escapeHtml(now)}</div>
    <div class="label">Status</div><div>Draft for Analyst Review</div>
    <div class="label">Agenda Name</div><div>${escapeHtml(meta.label)}</div>
    <div class="label">Strategy</div><div>${escapeHtml(meta.strategy)}</div>
    <div class="label">Confidence</div><div>${conf}%</div>
  </div>

  <h2>2. Scenario Summary</h2>
  <div class="meta-grid">
    <div class="label">Primary Asset</div><div>${escapeHtml(primary)}</div>
    <div class="label">Secondary Object</div><div>${escapeHtml(secondary)}</div>
    <div class="label">Collision Probability</div><div>${escapeHtml(pc)}</div>
    <div class="label">TCA (UTC)</div><div>${escapeHtml(tca)}</div>
    <div class="label">Time to TCA</div><div>${escapeHtml(DEMO_SCENARIO.timeToTca)}</div>
    <div class="label">Orbit Regime</div><div>${escapeHtml(DEMO_SCENARIO.orbitRegime)}</div>
    <div class="label">Closest Approach Distance</div><div>${escapeHtml(DEMO_SCENARIO.closestApproachM)}</div>
    <div class="label">Relative Speed</div><div>${escapeHtml(DEMO_SCENARIO.relativeSpeedKms)}</div>
    <div class="label">Risk Level</div><div>${escapeHtml(DEMO_SCENARIO.riskLevel)}</div>
    <div class="label">Recommended Action</div><div>Review and approve task sequence before command uplink.</div>
  </div>
  ${warningsHtml}

  <h2>3. Recommended Task Sequence</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Task</th>
        <th>Assigned Asset(s)</th>
        <th>Compute Route</th>
        <th>Purpose</th>
        <th>Expected Output</th>
      </tr>
    </thead>
    <tbody>${taskRows}
    </tbody>
  </table>

  <h2>4. Decision Rationale</h2>
  <table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Why Selected</th>
        <th>Input Signals</th>
        <th>Logic Gate Results</th>
        <th>Analyst Review Note</th>
      </tr>
    </thead>
    <tbody>${rationaleRows}
    </tbody>
  </table>

  <h2>5. Analyst Disposition</h2>
  <p>This agenda is a draft recommendation. Final maneuver approval requires human flight dynamics analyst review before command uplink. No autonomous execution should occur without explicit analyst approval.</p>

  <div class="footer">
    Perigeon Orbital AI Copilot — report generated ${escapeHtml(now)}. Not an operational flight safety product. For demonstration and research purposes only.
  </div>
</body>
</html>`;
}

function downloadHtmlReport(html, filename) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Per-event feature builder ────────────────────────────────────

function buildFeaturesForCollision(evDef) {
  return [
    { feature_group: "llm", feature_name: "risk_class",               value: evDef.riskLevel.toUpperCase().replace(/-/g, "_") },
    { feature_group: "llm", feature_name: "collision_probability",    value: String(evDef.pc) },
    { feature_group: "llm", feature_name: "time_to_closest_approach", value: "262" },
    { feature_group: "llm", feature_name: "miss_distance_m",          value: String(evDef.closestApproachDistanceM) },
    { feature_group: "llm", feature_name: "target_satellite",         value: evDef.primaryAsset },
    { feature_group: "llm", feature_name: "hazard_object",            value: evDef.secondaryObject.replace(/ /g, "-") },
    { feature_group: "llm", feature_name: "can_maneuver",             value: "yes" },
    { feature_group: "llm", feature_name: "delta_v_budget",           value: "2.1 m/s" },
    { feature_group: "llm", feature_name: "fuel_remaining",           value: "38%" },
    { feature_group: "llm", feature_name: "thruster_status",          value: "nominal" },
    { feature_group: "llm", feature_name: "allowed_maneuver_types",   value: "prograde, radial" },
    { feature_group: "llm", feature_name: "power_risk",               value: "low" },
    { feature_group: "llm", feature_name: "thermal_risk",             value: "low" },
    { feature_group: "llm", feature_name: "communication_available",  value: "yes" },
    { feature_group: "llm", feature_name: "communication_risk",       value: "low" },
    { feature_group: "llm", feature_name: "sensor_confidence",        value: "0.92" },
    { feature_group: "llm", feature_name: "trust_level",              value: "high" },
    { feature_group: "llm", feature_name: "safe_autonomous_control",  value: "yes" },
    { feature_group: "ml",  feature_name: "raw_pc",                   value: String(evDef.pc) },
  ];
}

// ─── Collision summary builder ────────────────────────────────────

function buildCollisionSummary(agendas) {
  if (!agendas || agendas.length === 0) return null;
  const sc  = agendas[0]?.scenario ?? {};
  const sat = sc.target_satellite ?? "the primary satellite";
  const deb = sc.hazard_object    ?? "an untracked object";
  const pc  = sc.collision_probability != null ? `Collision probability is estimated at ${sc.collision_probability}.` : "";
  const tca = sc.tca_seconds != null
    ? `Time to closest approach is approximately ${(sc.tca_seconds / 3600).toFixed(1)} hours.`
    : "";
  return `${sat} was flagged for a possible conjunction with ${deb}. ${pc} ${tca} Perigeon retrieved relevant orbital safety tasks, applied feasibility gates, and generated ${agendas.length} ranked maneuver agendas for analyst review. Recommended next step: validate sensor geometry, propagate the orbit, then review the lowest-risk maneuver plan.`.replace(/\s{2,}/g, " ").trim();
}

// ─── Fade-in mount animation ──────────────────────────────────────

function FadeIn({ children, delay = 0 }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{
      opacity:    show ? 1 : 0,
      transform:  show ? "translateY(0)" : "translateY(5px)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
    }}>
      {children}
    </div>
  );
}

// ─── Static reasoning step (idle) ────────────────────────────────

function StaticReasoningStep({ step }) {
  return (
    <div className="flex gap-3">
      <div className={`w-0.5 rounded-full shrink-0 mt-1 mb-0.5 ${STEP_ACCENT[step.type]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STEP_DOT[step.type]}`} />
          <span className="text-base font-medium tracking-widest uppercase text-neutral-500">
            {step.label}
          </span>
        </div>
        <p className="text-base text-neutral-200 leading-snug mb-1">{step.text}</p>
        <p className="text-base text-neutral-500 leading-snug">{step.detail}</p>
      </div>
    </div>
  );
}

// ─── Process step (from API reasoning_steps) ──────────────────────

function ProcessStep({ step, index, expanded, onToggle }) {
  const statusDot =
    step.status === "ok"      ? "bg-green-400" :
    step.status === "warn"    ? "bg-amber-400" :
    step.status === "blocked" ? "bg-red-400"   : "bg-neutral-500";

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors"
      >
        <span className="text-base font-mono text-neutral-600 w-4 shrink-0">{index + 1}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
        <span className="text-base text-neutral-200 flex-1 leading-snug">{step.title}</span>
        <span className="text-base text-neutral-600">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-white/5">
          <p className="text-base text-neutral-400 leading-relaxed mt-2.5">{step.detail}</p>

          {/* Task list in step showing retrieved tasks (step index 2 = RAG step) */}
          {step.top_tasks && step.top_tasks.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-base text-neutral-600 uppercase tracking-widest mb-2">
                Top retrieved tasks
              </p>
              {step.top_tasks.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-base text-neutral-300 font-mono">{t.task_id}</span>
                  <span className="text-base text-neutral-500 truncate mx-2 flex-1">{t.task_name}</span>
                  <span className="text-base text-cyan-400 font-mono shrink-0">
                    {(t.similarity_score * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task step (expandable row inside an agenda) ──────────────────

function TaskStep({ task, taskKey, taskIndex, expanded, onToggle }) {
  const assets  = getAssignedAssets(task);
  const details = getTaskDecisionDetails(task);
  const isQuantum = task.quantum_candidate === "yes";
  const routeChip = isQuantum
    ? "border-violet-500/30 text-violet-400"
    : "border-cyan-500/20 text-cyan-400/80";
  const routeLabel = isQuantum ? "Quantum" : "Classical";
  // Use index-based step number — never shows "0?" even when task.seq is null
  const stepNum = getStepNumber(taskIndex);

  return (
    <div className="border border-white/5 rounded-lg bg-white/2.5 overflow-hidden">
      {/* Collapsed row */}
      <button
        onClick={() => onToggle(taskKey)}
        className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-white/3 transition-colors"
      >
        <span className="text-base font-mono text-neutral-600 w-5 mt-px shrink-0">{stepNum}</span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-neutral-100 leading-snug">{task.task_name}</p>
          <p className="text-base text-neutral-500 mt-0.5 truncate">
            {assets.join(" + ")}
          </p>
          {task.reason && (
            <p className="text-base text-neutral-500 mt-1 leading-snug line-clamp-1">{task.reason}</p>
          )}
        </div>
        <span className={`text-base border rounded px-1.5 py-0.5 leading-none shrink-0 mt-0.5 ${routeChip}`}>
          {routeLabel}
        </span>
        <span className="text-base text-neutral-700 ml-1 mt-0.5 shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2.5">
          <DetailRow label="Why selected"    value={details.whySelected} />
          <DetailRow label="Input signals"   value={details.inputSignals.join(", ")} />
          <div>
            <p className="text-base text-neutral-600 uppercase tracking-widest mb-1">Logic gates</p>
            <div className="space-y-0.5">
              {details.logicGates.map((g) => (
                <div key={g.name} className="flex items-center gap-2">
                  <span className={`w-1 h-1 rounded-full shrink-0 ${g.result.startsWith("Pass") ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-base text-neutral-500">{g.name}:</span>
                  <span className={`text-base ${g.result.startsWith("Pass") ? "text-green-400/80" : "text-red-400/80"}`}>{g.result}</span>
                </div>
              ))}
            </div>
          </div>
          <DetailRow label="Assigned assets" value={assets.join("; ")} />
          <DetailRow label="Expected output" value={details.expectedOutput} />
          <DetailRow label="Analyst note"    value={details.analystNote} accent />
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, accent }) {
  return (
    <div>
      <p className="text-base text-neutral-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className={`text-base leading-relaxed ${accent ? "text-amber-400/70" : "text-neutral-400"}`}>{value}</p>
    </div>
  );
}

// ─── Agenda card ──────────────────────────────────────────────────

function AgendaCard({ agenda, rank, expanded, onToggle, onExecute }) {
  const [expandedTasks, setExpandedTasks] = useState({});
  const [executed, setExecuted] = useState(false);

  const index         = rank - 1;
  const meta          = AGENDA_META[index] ?? AGENDA_META[0];
  const isRecommended = rank === 1;

  const rawConf = agenda.confidence * 100;
  const confPct = Number.isFinite(rawConf) ? Math.round(rawConf) : meta.defaultConfidence;
  const feasColor = FEASIBILITY_COLOR[agenda.feasibility] ?? "text-neutral-400";

  const sc        = agenda.scenario ?? {};
  const primary   = sc.target_satellite || DEMO_SCENARIO.primaryAsset;
  const secondary = sc.hazard_object    || DEMO_SCENARIO.secondaryObject;
  const pcVal     = sc.collision_probability != null ? String(sc.collision_probability) : DEMO_SCENARIO.collisionPc;
  const tcaVal    = sc.tca_seconds != null
    ? `${(sc.tca_seconds / 3600).toFixed(1)} hr`
    : DEMO_SCENARIO.tca;

  // Green border for recommended (rank 1), default for others
  const cardBorder = isRecommended ? "border-green-500/30" : "border-white/5";
  const headerHover = isRecommended ? "hover:bg-green-500/[0.04]" : "hover:bg-white/2";

  function toggleTask(key) {
    setExpandedTasks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleExport(e) {
    e.stopPropagation();
    const html = agendaToHtmlReport(agenda, index);
    downloadHtmlReport(html, `q-router-agenda-${rank}-report.html`);
  }

  function handleExecute(e) {
    e.stopPropagation();
    if (executed) return;
    setExecuted(true);
    onExecute?.(agenda);
  }

  return (
    <div className={`border ${cardBorder} rounded-xl overflow-hidden`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors ${headerHover}`}
      >
        <span className="text-base font-mono text-neutral-600 w-4 mt-0.5 shrink-0">{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-base font-medium ${isRecommended ? "text-green-300" : "text-neutral-100"}`}>
              {meta.label}
            </span>
            {isRecommended && (
              <span className="text-base border border-green-500/40 text-green-400/80 px-1.5 py-0.5 rounded-full leading-none">
                Recommended
              </span>
            )}
            {agenda.needs_human_review && (
              <span className="text-base border border-amber-500/30 text-amber-400/70 px-1.5 py-0.5 rounded-full leading-none">
                Review required
              </span>
            )}
          </div>
          <p className="text-base text-neutral-500 mt-0.5">
            <span className={feasColor}>{confPct}% confidence</span>
            <span className="text-neutral-700 mx-1.5">·</span>
            <span>{meta.strategy}</span>
          </p>
        </div>
        <span className="text-base text-neutral-600 mt-0.5 shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className={`px-4 pb-4 border-t ${isRecommended ? "border-green-500/10" : "border-white/5"}`}>
          {/* Scenario block */}
          <div className="mt-3 mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 bg-neutral-900/60 rounded-lg text-base">
            <ScenarioField label="Primary asset"    value={primary} />
            <ScenarioField label="Secondary object" value={secondary} />
            <ScenarioField label="Collision Pc"     value={pcVal} warn={pcVal !== "Unknown"} />
            <ScenarioField label="TCA"              value={tcaVal} />
            <div className="col-span-2">
              <ScenarioField label="Plan status" value={agenda.needs_human_review ? "Draft for analyst review" : "Ready for approval"} />
            </div>
          </div>

          {/* Warnings */}
          {agenda.warnings && agenda.warnings.length > 0 && (
            <div className="mb-3 space-y-1">
              {agenda.warnings.map((w, i) => (
                <p key={i} className="text-base text-amber-400/70 leading-snug">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Task sequence */}
          {agenda.tasks && agenda.tasks.length > 0 && (
            <div className="mb-3">
              <p className="text-base text-neutral-600 uppercase tracking-widest mb-2">
                Task sequence — click row to expand
              </p>
              <div className="space-y-1.5">
                {agenda.tasks.map((t, i) => {
                  const key = `${rank}-${i}`;
                  return (
                    <TaskStep
                      key={key}
                      task={t}
                      taskKey={key}
                      taskIndex={i}
                      expanded={!!expandedTasks[key]}
                      onToggle={toggleTask}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button className="flex-1 py-2 text-base rounded-lg border border-green-500/20 text-green-400/70 hover:border-green-500/40 hover:text-green-300 transition-colors cursor-pointer">
              Approve
            </button>
            <button
              onClick={handleExecute}
              disabled={executed}
              className={`flex-1 py-2 text-base rounded-lg border transition-colors cursor-pointer ${
                executed
                  ? "border-green-500/30 text-green-400/60 opacity-70 cursor-default"
                  : "border-violet-500/20 text-violet-400/70 hover:border-violet-500/40 hover:text-violet-300"
              }`}
            >
              {executed ? "Executed ✓" : "Execute"}
            </button>
            <button
              onClick={handleExport}
              className="flex-1 py-2 text-base rounded-lg border border-white/8 text-neutral-500 hover:border-white/15 hover:text-neutral-300 transition-colors cursor-pointer"
            >
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioField({ label, value, warn }) {
  return (
    <div>
      <p className="text-base text-neutral-600 uppercase tracking-widest">{label}</p>
      <p className={`text-base font-mono mt-0.5 ${warn ? "text-amber-400" : "text-neutral-300"}`}>{value}</p>
    </div>
  );
}

// ─── Collision summary ────────────────────────────────────────────

function CollisionSummary({ text }) {
  if (!text) return null;
  return (
    <div className="mt-4 mb-1 border border-white/5 rounded-xl px-4 py-3">
      <p className="text-base text-neutral-600 uppercase tracking-widest font-medium mb-2">
        Collision summary
      </p>
      <p className="text-base text-neutral-400 leading-relaxed">{text}</p>
    </div>
  );
}

// ─── Collision Group (left panel card per event) ───────────────────

const LOADING_MESSAGES = [
  "Retrieving orbital safety tasks…",
  "Evaluating feasibility gates…",
  "Computing maneuver candidates…",
  "Ranking agenda options…",
  "Finalizing recommendations…",
];

function CollisionGroup({ collision, index, expanded, isSelected, onToggle, onSelect }) {
  const [expandedSteps, setExpandedSteps] = useState(new Set());
  const [visibleCount, setVisibleCount]   = useState(0);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  // Cycle through loading messages while the pipeline runs
  useEffect(() => {
    if (collision.agendaStatus !== "loading") return;
    setLoadingMsgIdx(0);
    const iv = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 1400);
    return () => clearInterval(iv);
  }, [collision.agendaStatus]);

  // Reveal reasoning steps one at a time after pipeline finishes
  useEffect(() => {
    if (collision.agendaStatus !== "done") { setVisibleCount(0); return; }
    const total = collision.reasoningSteps.length;
    if (total === 0) return;
    setVisibleCount(0);
    let i = 0;
    const reveal = () => { i++; setVisibleCount(i); if (i < total) setTimeout(reveal, 380); };
    setTimeout(reveal, 180);
  }, [collision.agendaStatus, collision.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel =
    collision.status === "resolved" ? "Resolved" :
    collision.status === "active"   ? "Active"   : "Pending";

  const statusColor =
    collision.status === "resolved" ? "text-green-400" :
    collision.status === "active"   ? "text-amber-400" : "text-neutral-500";

  const borderColor = isSelected
    ? "border-cyan-500/60"
    : collision.status === "active" ? "border-amber-500/15" : "border-white/5";

  function toggleStep(i) {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <div className={`border ${borderColor} ${isSelected ? "bg-cyan-950/20" : ""} rounded-xl overflow-hidden mb-2`}>
      {/* Group header */}
      <button
        onClick={() => { onToggle(); onSelect(); }}
        className="w-full px-4 py-3 text-left hover:bg-white/2 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-neutral-100 leading-snug">
              Collision {index} — {collision.primaryAsset} vs {collision.secondaryObject}
            </p>
            <p className={`text-base mt-0.5 ${statusColor}`}>
              Status: {statusLabel}
            </p>
            <p className="text-base text-neutral-500 mt-0.5">
              Pc: {collision.pc} · TCA: {collision.tca}
            </p>
          </div>
          <span className="text-base text-neutral-600 shrink-0 mt-0.5">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3">

          {/* Scenario snapshot */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-2.5 bg-neutral-900/60 rounded-lg text-base">
            <div>
              <p className="text-neutral-600 uppercase tracking-widest text-base">Risk</p>
              <p className="text-amber-400 font-mono mt-0.5">{collision.riskLevel}</p>
            </div>
            <div>
              <p className="text-neutral-600 uppercase tracking-widest text-base">Miss distance</p>
              <p className="text-neutral-300 font-mono mt-0.5">{collision.closestApproachDistanceM} m</p>
            </div>
            <div>
              <p className="text-neutral-600 uppercase tracking-widest text-base">Rel. speed</p>
              <p className="text-neutral-300 font-mono mt-0.5">{collision.relativeSpeedKms} km/s</p>
            </div>
            <div>
              <p className="text-neutral-600 uppercase tracking-widest text-base">Pc</p>
              <p className="text-red-400 font-mono mt-0.5">{collision.pc}</p>
            </div>
          </div>

          {/* Loading spinner with cycling message */}
          {collision.agendaStatus === "loading" && (
            <div className="flex items-center gap-2.5 py-1">
              <div className="w-3.5 h-3.5 rounded-full border border-cyan-500/30 border-t-cyan-400 animate-spin shrink-0" />
              <FadeIn key={loadingMsgIdx} delay={0}>
                <p className="text-base text-neutral-500">{LOADING_MESSAGES[loadingMsgIdx]}</p>
              </FadeIn>
            </div>
          )}

          {/* Reasoning steps — revealed one by one */}
          {collision.agendaStatus === "done" && collision.reasoningSteps.length > 0 && (
            <div className="space-y-1.5">
              <FadeIn delay={0}>
                <p className="text-base text-neutral-600 uppercase tracking-widest">Reasoning trace</p>
              </FadeIn>
              {collision.reasoningSteps.slice(0, visibleCount).map((step, i) => (
                <FadeIn key={i} delay={0}>
                  <ProcessStep
                    step={step}
                    index={i}
                    expanded={expandedSteps.has(i)}
                    onToggle={() => toggleStep(i)}
                  />
                </FadeIn>
              ))}
              {visibleCount < collision.reasoningSteps.length && (
                <div className="flex items-center gap-1 px-1 py-1.5">
                  {[0, 150, 300].map(d => (
                    <div key={d} className="w-1.5 h-1.5 rounded-full bg-neutral-700 animate-pulse" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {collision.agendaStatus === "error" && (
            <p className="text-base text-red-400">Pipeline error: {collision.errorMsg}</p>
          )}

          {/* Collision summary */}
          {collision.collisionSummary && (
            <CollisionSummary text={collision.collisionSummary} />
          )}

          {/* Maneuver executed note */}
          {collision.maneuverExecuted && (
            <p className="text-base text-green-400/80 leading-relaxed">
              Avoidance maneuver executed. Trajectory adjusted to increase projected miss distance.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────

function LeftPanel({
  style, collisions, selectedCollisionId, expandedCollisionIds,
  onSelectCollision, onToggleCollision, onGenerate, csvState, csvFileRef, onUploadCSV,
}) {
  const activeCount   = collisions.filter(c => c.status === "active").length;
  const resolvedCount = collisions.filter(c => c.status === "resolved").length;

  const pillLabel =
    activeCount > 0  ? `${activeCount} active` :
    collisions.length > 0 ? "Monitoring"       : "Idle";

  const pillColor =
    activeCount > 0  ? "border-amber-500/30 text-amber-400/80" :
    collisions.length > 0 ? "border-green-500/30 text-green-400/80" :
    "border-white/10 text-neutral-500";

  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-base font-medium text-neutral-100 font-mono-tech">Perigeon Copilot</h2>
          <span className={`text-base border rounded-full px-2 py-0.5 leading-4 ${pillColor}`}>
            {pillLabel}
          </span>
        </div>
        <p className="text-base text-neutral-500">
          {collisions.length > 0
            ? `${collisions.length} collision event${collisions.length > 1 ? "s" : ""}${resolvedCount > 0 ? ` · ${resolvedCount} resolved` : ""}`
            : "Flight dynamics reasoning"}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">

        {/* Idle — sim not started */}
        {collisions.length === 0 && (
          <>
            <p className="text-base text-neutral-600 uppercase tracking-widest font-medium mb-4">
              Active reasoning
            </p>
            <div className="space-y-5">
              {STATIC_STEPS.map((step, i) => (
                <FadeIn key={step.id} delay={i * 420}>
                  <StaticReasoningStep step={step} />
                </FadeIn>
              ))}
            </div>
          </>
        )}

        {/* Collision groups */}
        {collisions.length > 0 && (
          <div>
            <p className="text-base text-neutral-600 uppercase tracking-widest font-medium mb-3">
              Conjunction events
            </p>
            {collisions.map((collision, i) => (
              <CollisionGroup
                key={collision.id}
                collision={collision}
                index={i + 1}
                expanded={expandedCollisionIds.has(collision.id)}
                isSelected={selectedCollisionId === collision.id}
                onToggle={() => onToggleCollision(collision.id)}
                onSelect={() => onSelectCollision(collision.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="px-5 pt-2 pb-3 shrink-0">
        <p className="text-base text-neutral-600 uppercase tracking-widest font-medium mb-2.5">
          Suggested actions
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => onGenerate()}
            className="text-base px-3 py-1 rounded-full border border-cyan-500/30 text-cyan-400/80 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors duration-150 cursor-pointer"
          >
            Generate agendas
          </button>
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={onUploadCSV}
          />
          <button
            onClick={() => csvFileRef.current?.click()}
            className="text-base px-3 py-1 rounded-full border border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200 transition-colors duration-150 cursor-pointer"
          >
            Upload CSV
          </button>
          {["Analyze risk", "Explain routing"].map((label) => (
            <button
              key={label}
              className="text-base px-3 py-1 rounded-full border border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200 transition-colors duration-150 cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>

        {csvState.filename && (
          <p className="text-base text-neutral-500 mb-1.5 truncate">
            <span className="text-neutral-600">CSV: </span>
            <span className="font-mono text-neutral-400">{csvState.filename}</span>
            {csvState.error && <span className="text-red-400 ml-2">{csvState.error}</span>}
          </p>
        )}
        {!csvState.filename && csvState.error && (
          <p className="text-base text-red-400 mb-1.5">{csvState.error}</p>
        )}
      </div>

      {/* Chat input */}
      <div className="px-5 pb-5 shrink-0">
        <div className="bg-neutral-900/70 border border-white/10 rounded-xl px-3.5 py-3 focus-within:border-white/20 transition-colors">
          <input
            className="w-full bg-transparent text-base text-neutral-200 placeholder-neutral-600 outline-none"
            placeholder="Ask for a maneuver plan…"
          />
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-base text-neutral-600">Draft outputs require analyst review.</span>
            <button className="text-base text-neutral-500 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Orbital Simulation wrapper (alias kept so call site is unchanged) ────────
const OrbitalSim = OrbitalSimulation;

// ─── Right Panel ──────────────────────────────────────────────────

function ReviewRow({ title }) {
  return (
    <div>
      <div className="py-3">
        <p className="text-base text-neutral-400">{title}</p>
        <p className="text-base text-neutral-600 mt-0.5">No data available</p>
      </div>
      <div className="h-px bg-white/5" />
    </div>
  );
}

function RightPanel({ style, selectedCollision, expandedAgendas, onToggleAgenda, onExecuteAgenda, pastAgendasCount, onDownloadPastAgendas }) {
  const status   = selectedCollision?.agendaStatus ?? "idle";
  const agendas  = selectedCollision?.agendas ?? [];
  const executed = selectedCollision?.maneuverExecuted ?? false;

  const pillLabel =
    !selectedCollision            ? "No selection" :
    status === "done"             ? `${agendas.length} plans` :
    status === "loading"          ? "Generating…"  :
    status === "error"            ? "Error"        : "Awaiting plan";

  const pillColor =
    status === "done"    ? "border-green-500/30 text-green-400/80" :
    status === "loading" ? "border-cyan-500/30 text-cyan-400/80"   :
    status === "error"   ? "border-red-500/30 text-red-400/80"     :
    "border-white/10 text-neutral-500";

  const subtitle = selectedCollision
    ? `${selectedCollision.primaryAsset} vs ${selectedCollision.secondaryObject}`
    : "Human-in-the-loop review";

  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-base font-medium text-neutral-100 font-mono-tech">Maneuver Plans</h2>
          <span className={`text-base border rounded-full px-2 py-0.5 leading-4 ${pillColor}`}>
            {pillLabel}
          </span>
        </div>
        <p className="text-base text-neutral-500 truncate">{subtitle}</p>
        {selectedCollision?.status === "resolved" && (
          <p className="text-base text-green-400/70 mt-0.5">Maneuver executed — collision resolved</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">

        {/* No collision selected */}
        {!selectedCollision && (
          <>
            <p className="text-base text-neutral-400 leading-relaxed">No collision selected.</p>
            <p className="text-base text-neutral-600 mt-1.5 leading-relaxed">
              Start the simulation to detect conjunction events, or click a collision group on the left.
            </p>
            <div className="h-px bg-white/5 mt-5 mb-1" />
            <p className="text-base text-neutral-600 uppercase tracking-widest font-medium py-3">
              Review sections
            </p>
            {["Candidate maneuvers", "Audit trail", "Export package"].map((title) => (
              <ReviewRow key={title} title={title} />
            ))}
          </>
        )}

        {/* Loading */}
        {selectedCollision && status === "loading" && (
          <>
            <p className="text-base text-neutral-400 leading-relaxed">Generating maneuver plans…</p>
            <p className="text-base text-neutral-600 mt-1.5">Results will appear here when complete.</p>
          </>
        )}

        {/* Error */}
        {selectedCollision && status === "error" && (
          <div className="py-4">
            <p className="text-base text-red-400">Pipeline failed</p>
            <p className="text-base text-neutral-600 mt-1.5">Check the left panel for details.</p>
          </div>
        )}

        {/* Agendas — hidden once a plan has been executed */}
        {selectedCollision && status === "done" && agendas.length > 0 && !executed && (
          <div className="space-y-3">
            <p className="text-base text-neutral-600 uppercase tracking-widest font-medium mb-1">
              Ranked agenda options
            </p>
            {agendas.map((agenda, i) => (
              <AgendaCard
                key={agenda.agenda_id ?? i}
                agenda={agenda}
                rank={i + 1}
                expanded={expandedAgendas.has(i)}
                onToggle={() => onToggleAgenda(i)}
                onExecute={(ag) => onExecuteAgenda(selectedCollision.id, ag)}
              />
            ))}
          </div>
        )}

        {/* Post-execution confirmation */}
        {selectedCollision && executed && (
          <div className="py-2 space-y-2">
            <p className="text-base text-green-400/80 leading-relaxed">
              Avoidance maneuver executed. All plans have been archived and can be downloaded below.
            </p>
          </div>
        )}

        {/* Idle for selected collision */}
        {selectedCollision && status === "idle" && (
          <>
            <p className="text-base text-neutral-400 leading-relaxed">No agendas generated yet.</p>
            <p className="text-base text-neutral-600 mt-1.5">Click "Generate agendas" to run the pipeline.</p>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 pt-3 space-y-2 shrink-0">
        {(!selectedCollision || (status !== "done") || executed) && !executed && (
          <>
            <button className="w-full py-2 rounded-xl border border-amber-500/20 text-amber-400/60 text-base hover:border-amber-500/35 hover:text-amber-300 transition-colors duration-150 cursor-pointer">
              Approve plan
            </button>
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded-xl border border-white/8 text-neutral-500 text-base hover:border-white/15 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
                Export
              </button>
              <button className="flex-1 py-2 rounded-xl border border-white/8 text-neutral-500 text-base hover:border-white/15 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
                View audit
              </button>
            </div>
          </>
        )}
        {pastAgendasCount > 0 && (
          <button
            onClick={onDownloadPastAgendas}
            className="w-full py-2 rounded-xl border border-cyan-500/20 text-cyan-400/70 text-base hover:border-cyan-500/40 hover:text-cyan-300 transition-colors duration-150 cursor-pointer"
          >
            Past agendas ({pastAgendasCount})
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Drag Divider ─────────────────────────────────────────────────

function DragDivider({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-3 shrink-0 flex items-stretch justify-center group"
      style={{ cursor: "col-resize" }}
    >
      <div className="w-px bg-white/5 group-hover:bg-cyan-500/30 transition-colors duration-150 my-6 rounded-full" />
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────

const LEFT_MIN = 240;
const LEFT_MAX = 500;
const RIGHT_MIN = 260;
const RIGHT_MAX = 540;

export default function App() {
  const [leftWidth, setLeftWidth]   = useState(360);
  const [rightWidth, setRightWidth] = useState(380);
  const [simRunning, setSimRunning] = useState(false);
  const [simResetKey, setSimResetKey] = useState(0);

  // Per-collision state
  const [collisions, setCollisions]               = useState([]);
  const [selectedCollisionId, setSelectedCollisionId] = useState(null);
  const [expandedCollisionIds, setExpandedCollisionIds] = useState(new Set());
  // expandedAgendasMap: { [collisionId]: Set<number> }
  const [expandedAgendasMap, setExpandedAgendasMap] = useState({});
  // executedAssets passed to OrbitalSimulation for visual update
  const [executedAssets, setExecutedAssets]       = useState(new Set());
  // Past agendas saved after execution, available for download
  const [executedAgendas, setExecutedAgendas]     = useState([]); // [{collision, agendas}]

  const [simSpeed, setSimSpeed] = useState(1); // 1 | 2 | 4

  // CSV upload state
  const [csvState, setCsvState] = useState({ filename: "", error: "" });
  const csvFileRef = useRef(null);

  // Panel resize
  const dragging   = useRef(null);
  const startX     = useRef(0);
  const startWidth = useRef(0);

  const handleDividerMouseDown = (side, e) => {
    dragging.current   = side;
    startX.current     = e.clientX;
    startWidth.current = side === "left" ? leftWidth : rightWidth;
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      if (dragging.current === "left") {
        setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, startWidth.current + delta)));
      } else {
        setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, startWidth.current - delta)));
      }
    };
    const onMouseUp = () => {
      dragging.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",  onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",  onMouseUp);
    };
  }, []);

  // ── Generate agendas for a given collision event ──────────────
  const generateAgendasForCollision = useCallback(async (collisionId, evDef) => {
    const features = buildFeaturesForCollision(evDef);
    try {
      const res = await fetch("http://127.0.0.1:8000/generate-agendas-from-collision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const receivedAgendas = data.agendas ?? [];
      setCollisions(prev => prev.map(c => c.id !== collisionId ? c : {
        ...c,
        agendaStatus:     "done",
        reasoningSteps:   data.reasoning_steps ?? [],
        agendas:          receivedAgendas,
        collisionSummary: buildCollisionSummary(receivedAgendas),
      }));
      // Initialize first agenda expanded
      setExpandedAgendasMap(prev => ({ ...prev, [collisionId]: new Set([0]) }));
    } catch (e) {
      setCollisions(prev => prev.map(c => c.id !== collisionId ? c : {
        ...c,
        agendaStatus: "error",
        errorMsg:     e.message ?? "Unknown error",
      }));
    }
  }, []);

  // ── Create a new collision from a demo event definition ────────
  const triggerCollisionEvent = useCallback((evDef) => {
    const newCollision = {
      id:                       evDef.id,
      primaryAsset:             evDef.primaryAsset,
      secondaryObject:          evDef.secondaryObject,
      pc:                       evDef.pc,
      tca:                      evDef.tca,
      closestApproachDistanceM: evDef.closestApproachDistanceM,
      relativeSpeedKms:         evDef.relativeSpeedKms,
      riskLevel:                evDef.riskLevel,
      status:                   "active",
      reasoningSteps:           [],
      agendas:                  [],
      agendaStatus:             "loading",
      collisionSummary:         "",
      errorMsg:                 "",
      maneuverExecuted:         false,
    };

    setCollisions(prev => [...prev, newCollision]);
    setSelectedCollisionId(evDef.id);
    setExpandedCollisionIds(prev => new Set([...prev, evDef.id]));

    generateAgendasForCollision(evDef.id, evDef);
  }, [generateAgendasForCollision]);

  // ── Collision detected by orbital lookahead scan ──────────────
  const handleCollisionDetected = useCallback(({
    satId, debrisId, closestDistSceneUnits, timeToClosestApproachSecs, relativeSpeedKms,
  }) => {
    const eventId = `collision-${satId}-${debrisId}-${Date.now()}`.toLowerCase().replace(/\s+/g, "-");

    // Convert scene units → metres (1 scene unit = 6,371 km = 6,371,000 m)
    const distM   = Math.max(1, Math.round(closestDistSceneUnits * 6_371_000));
    const tcaSecs = Math.round(timeToClosestApproachSecs);
    const hh      = String(Math.floor(tcaSecs / 3600)).padStart(2, "0");
    const mm      = String(Math.floor((tcaSecs % 3600) / 60)).padStart(2, "0");
    const ss      = String(tcaSecs % 60).padStart(2, "0");
    const tcaStr  = `${hh}:${mm}:${ss}`;

    const pc   = closestDistSceneUnits < 0.01 ? 0.87
               : closestDistSceneUnits < 0.025 ? 0.74 : 0.52;
    const risk = closestDistSceneUnits < 0.01 ? "High"
               : closestDistSceneUnits < 0.025 ? "Medium-High" : "Medium";

    const evDef = {
      id:                       eventId,
      primaryAsset:             satId,
      secondaryObject:          debrisId,
      pc,
      tca:                      tcaStr,
      closestApproachDistanceM: distM,
      relativeSpeedKms:         relativeSpeedKms ?? 12.5,
      riskLevel:                risk,
    };

    // Slow sim to 1× so the user can watch the approach unfold
    setSimSpeed(1);
    triggerCollisionEvent(evDef);
  }, [triggerCollisionEvent]);

  // ── Start / Stop / Reset simulation ───────────────────────────
  const handleStartStop = useCallback(() => {
    if (simRunning) {
      setSimRunning(false);
    } else {
      // Full reset on every fresh Start
      setCollisions([]);
      setSelectedCollisionId(null);
      setExpandedCollisionIds(new Set());
      setExpandedAgendasMap({});
      setExecutedAssets(new Set());
      setExecutedAgendas([]);
      setSimResetKey(k => k + 1);
      setSimRunning(true);
    }
  }, [simRunning]);

  // ── Manual "Generate agendas" button (uses selected or sample) ─
  const handleGenerateAgendas = useCallback(async (featuresOverride) => {
    // If a collision is selected, re-run for that collision
    const selected = collisions.find(c => c.id === selectedCollisionId);
    if (selected) {
      setCollisions(prev => prev.map(c => c.id !== selected.id ? c : {
        ...c, agendaStatus: "loading", reasoningSteps: [], agendas: [], collisionSummary: "", errorMsg: "",
      }));
      await generateAgendasForCollision(selected.id, selected);
      return;
    }

    // Otherwise create a transient entry from sample / uploaded CSV
    const fakeId  = `manual-${Date.now()}`;
    const evDef   = {
      id: fakeId, primaryAsset: "SAT-01", secondaryObject: "COSMOS 2251 DEB",
      pc: 0.82, tca: "00:04:22", closestApproachDistanceM: 84, relativeSpeedKms: 14.2, riskLevel: "High",
    };
    const features = featuresOverride ?? buildFeaturesForCollision(evDef);
    const newCol = {
      ...evDef,
      status: "active", reasoningSteps: [], agendas: [], agendaStatus: "loading",
      collisionSummary: "", errorMsg: "", maneuverExecuted: false,
    };
    setCollisions(prev => [...prev, newCol]);
    setSelectedCollisionId(fakeId);
    setExpandedCollisionIds(prev => new Set([...prev, fakeId]));

    try {
      const res = await fetch("http://127.0.0.1:8000/generate-agendas-from-collision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const receivedAgendas = data.agendas ?? [];
      setCollisions(prev => prev.map(c => c.id !== fakeId ? c : {
        ...c, agendaStatus: "done", reasoningSteps: data.reasoning_steps ?? [],
        agendas: receivedAgendas, collisionSummary: buildCollisionSummary(receivedAgendas),
      }));
      setExpandedAgendasMap(prev => ({ ...prev, [fakeId]: new Set([0]) }));
    } catch (e) {
      setCollisions(prev => prev.map(c => c.id !== fakeId ? c : {
        ...c, agendaStatus: "error", errorMsg: e.message ?? "Unknown error",
      }));
    }
  }, [collisions, selectedCollisionId, generateAgendasForCollision]);

  // ── Execute maneuver for a collision ──────────────────────────
  const handleExecuteManeuver = useCallback(async (collisionId, agenda) => {
    const collision = collisions.find(c => c.id === collisionId);
    if (!collision) return;

    try {
      await fetch("http://127.0.0.1:8000/simulation/execute-maneuver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendaId:       agenda.agenda_id ?? "unknown",
          primaryAsset:   collision.primaryAsset,
          secondaryObject: collision.secondaryObject,
          maneuverType:   "prograde",
        }),
      });
    } catch (_) { /* non-fatal — visual update proceeds regardless */ }

    // Save agendas to past archive before they're hidden in the panel
    setExecutedAgendas(prev => [...prev, {
      collision,
      agendas:      collision.agendas,
      executedAt:   new Date().toISOString(),
      chosenAgenda: agenda,
    }]);

    setCollisions(prev => prev.map(c => c.id !== collisionId ? c : {
      ...c,
      status:           "resolved",
      maneuverExecuted: true,
      reasoningSteps:   [
        ...c.reasoningSteps,
        {
          title:  "Avoidance maneuver executed",
          detail: `${collision.primaryAsset} trajectory adjusted via prograde burn. Predicted miss distance increased to safe separation. Collision risk resolved.`,
          status: "ok",
        },
      ],
    }));

    // Mark asset as executed for OrbitalSimulation visual
    setExecutedAssets(prev => new Set([...prev, collision.primaryAsset]));

    // Collapse resolved collision, keep it selected
    setExpandedCollisionIds(prev => {
      const next = new Set(prev);
      next.delete(collisionId);
      return next;
    });
  }, [collisions]);

  // ── Toggle collision group ────────────────────────────────────
  const toggleCollision = useCallback((id) => {
    setExpandedCollisionIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Download all past agendas as a combined HTML report ───────
  const handleDownloadPastAgendas = useCallback(() => {
    const now = new Date().toISOString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PerigeонPastAgendas generated="${escapeHtml(now)}">
${executedAgendas.map(({ collision, agendas, executedAt, chosenAgenda }, gi) => `  <ConjunctionEvent index="${gi + 1}" primaryAsset="${escapeHtml(collision.primaryAsset)}" secondaryObject="${escapeHtml(collision.secondaryObject)}" executedAt="${escapeHtml(executedAt)}" chosenAgendaId="${escapeHtml(chosenAgenda?.agenda_id ?? "")}">
    <CollisionMetadata>
      <pc>${escapeHtml(String(collision.pc))}</pc>
      <tca>${escapeHtml(collision.tca)}</tca>
      <closestApproachDistanceM>${collision.closestApproachDistanceM}</closestApproachDistanceM>
      <relativeSpeedKms>${escapeHtml(String(collision.relativeSpeedKms))}</relativeSpeedKms>
      <riskLevel>${escapeHtml(collision.riskLevel)}</riskLevel>
    </CollisionMetadata>
    <Agendas>
${agendas.map((ag, ai) => `      <Agenda rank="${ai + 1}" agendaId="${escapeHtml(ag.agenda_id ?? "")}" feasibility="${escapeHtml(ag.feasibility ?? "")}" confidence="${ag.confidence ?? ""}">
        <Summary>${escapeHtml(ag.summary ?? "")}</Summary>
        <Tasks>
${(ag.tasks ?? []).map(t => `          <Task id="${escapeHtml(t.task_id ?? "")}" name="${escapeHtml(t.task_name ?? "")}" category="${escapeHtml(t.category ?? "")}" quantumCandidate="${escapeHtml(t.quantum_candidate ?? "")}" />`).join("\n")}
        </Tasks>
      </Agenda>`).join("\n")}
    </Agendas>
  </ConjunctionEvent>`).join("\n")}
</PerigeонPastAgendas>`;
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "perigeon-past-agendas.xml"; a.click();
    URL.revokeObjectURL(url);
  }, [executedAgendas]);

  // ── Toggle agenda card within a collision ─────────────────────
  const toggleAgenda = useCallback((collisionId, i) => {
    setExpandedAgendasMap(prev => {
      const cur  = prev[collisionId] ?? new Set([0]);
      const next = new Set(cur);
      next.has(i) ? next.delete(i) : next.add(i);
      return { ...prev, [collisionId]: next };
    });
  }, []);

  // ── CSV upload ────────────────────────────────────────────────
  const handleUploadCSV = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) { setCsvState({ filename: "", error: "No file selected." }); return; }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setCsvState({ filename: file.name, error: "CSV is empty." }); return;
        }
        const row = results.data[0];
        const validationError = validateCSVRow(row);
        if (validationError) { setCsvState({ filename: file.name, error: validationError }); return; }
        const features = convertCSVRowToFeatures(row);
        setCsvState({ filename: file.name, error: "" });
        handleGenerateAgendas(features);
      },
      error: (err) => setCsvState({ filename: file.name, error: `Parse error: ${err.message}` }),
    });
  }, [handleGenerateAgendas]);

  // ── Derived state ─────────────────────────────────────────────
  const selectedCollision  = collisions.find(c => c.id === selectedCollisionId) ?? null;
  const expandedAgendas    = expandedAgendasMap[selectedCollisionId] ?? new Set([0]);
  const activeConjunctions = collisions
    .filter(c => c.status === "active")
    .map(c => ({ primaryAsset: c.primaryAsset, secondaryObject: c.secondaryObject }));

  const highlightedObjects = selectedCollision
    ? new Set([selectedCollision.primaryAsset, selectedCollision.secondaryObject])
    : new Set();

  const anyActive  = collisions.some(c => c.status === "active");

  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 border-b border-white/5 shrink-0"
        style={{ height: 44 }}
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-medium text-neutral-100 font-mono-tech">Perigeon</span>
          <span className="text-base text-neutral-600 border-l border-white/5 pl-3">
            Orbital AI Copilot
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* Speed controls */}
          <div className="flex items-center gap-1">
            <span className="text-base text-neutral-600 mr-1">Speed</span>
            {[1, 2, 4, 8].map((s) => (
              <button
                key={s}
                onClick={() => setSimSpeed(s)}
                className={`text-base px-2 py-0.5 rounded border font-mono transition-colors duration-150 cursor-pointer ${
                  simSpeed === s
                    ? "border-neutral-400/50 text-neutral-200 bg-neutral-700/40"
                    : "border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-300"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            onClick={handleStartStop}
            className={`text-base px-4 py-1 rounded-full border font-medium transition-colors duration-150 cursor-pointer ${
              simRunning
                ? "border-red-500/40 text-red-400 hover:border-red-500/60 hover:text-red-300"
                : "border-green-500/40 text-green-400 hover:border-green-500/60 hover:text-green-300"
            }`}
          >
            {simRunning ? "Stop Simulation" : "Start Simulation"}
          </button>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${anyActive ? "bg-red-500 animate-pulse" : "bg-neutral-600"}`} />
            <span className="text-base text-neutral-400">
              {anyActive ? "Conjunction active" : "Conjunction alert"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${simRunning ? "bg-green-500" : "bg-neutral-600"}`} />
            <span className="text-base text-neutral-500">
              {simRunning ? "Simulation live" : "System nominal"}
            </span>
          </div>
        </div>
      </header>

      {/* Three-column layout */}
      <main className="flex-1 flex p-3 min-h-0">
        <LeftPanel
          style={{ width: leftWidth }}
          collisions={collisions}
          selectedCollisionId={selectedCollisionId}
          expandedCollisionIds={expandedCollisionIds}
          onSelectCollision={setSelectedCollisionId}
          onToggleCollision={toggleCollision}
          onGenerate={handleGenerateAgendas}
          csvState={csvState}
          csvFileRef={csvFileRef}
          onUploadCSV={handleUploadCSV}
        />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("left", e)} />
        <OrbitalSim
          running={simRunning}
          resetKey={simResetKey}
          speedMultiplier={simSpeed}
          onCollisionDetected={handleCollisionDetected}
          activeConjunctions={activeConjunctions}
          executedAssets={executedAssets}
          highlightedObjects={highlightedObjects}
        />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("right", e)} />
        <RightPanel
          style={{ width: rightWidth }}
          selectedCollision={selectedCollision}
          expandedAgendas={expandedAgendas}
          onToggleAgenda={(i) => toggleAgenda(selectedCollisionId, i)}
          onExecuteAgenda={handleExecuteManeuver}
          pastAgendasCount={executedAgendas.length}
          onDownloadPastAgendas={handleDownloadPastAgendas}
        />
      </main>
    </div>
  );
}
