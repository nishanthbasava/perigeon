import { useEffect, useRef, useState, useCallback } from "react";
import Papa from "papaparse";

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
  <title>Q-Router Maneuver Agenda Report — ${escapeHtml(meta.label)}</title>
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

  <h1>Q-Router Maneuver Agenda Recommendation <span class="tag">Agenda ${index + 1}</span></h1>
  <p>Generated by Q-Router Orbital AI Copilot. This is a draft recommendation requiring human analyst review.</p>

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
    Q-Router Orbital AI Copilot — report generated ${escapeHtml(now)}. Not an operational flight safety product. For demonstration and research purposes only.
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
  return `${sat} was flagged for a possible conjunction with ${deb}. ${pc} ${tca} Q-Router retrieved relevant orbital safety tasks, applied feasibility gates, and generated ${agendas.length} ranked maneuver agendas for analyst review. Recommended next step: validate sensor geometry, propagate the orbit, then review the lowest-risk maneuver plan.`.replace(/\s{2,}/g, " ").trim();
}

// ─── Static reasoning step (idle) ────────────────────────────────

function StaticReasoningStep({ step }) {
  return (
    <div className="flex gap-3">
      <div className={`w-0.5 rounded-full shrink-0 mt-1 mb-0.5 ${STEP_ACCENT[step.type]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STEP_DOT[step.type]}`} />
          <span className="text-[10px] font-medium tracking-widest uppercase text-neutral-500">
            {step.label}
          </span>
        </div>
        <p className="text-sm text-neutral-200 leading-snug mb-1">{step.text}</p>
        <p className="text-xs text-neutral-500 leading-snug">{step.detail}</p>
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
        <span className="text-[10px] font-mono text-neutral-600 w-4 shrink-0">{index + 1}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
        <span className="text-sm text-neutral-200 flex-1 leading-snug">{step.title}</span>
        <span className="text-[10px] text-neutral-600">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-white/5">
          <p className="text-xs text-neutral-400 leading-relaxed mt-2.5">{step.detail}</p>

          {/* Task list in step showing retrieved tasks (step index 2 = RAG step) */}
          {step.top_tasks && step.top_tasks.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-2">
                Top retrieved tasks
              </p>
              {step.top_tasks.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-xs text-neutral-300 font-mono">{t.task_id}</span>
                  <span className="text-xs text-neutral-500 truncate mx-2 flex-1">{t.task_name}</span>
                  <span className="text-[10px] text-cyan-400 font-mono shrink-0">
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
        <span className="text-[10px] font-mono text-neutral-600 w-5 mt-px shrink-0">{stepNum}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-neutral-100 leading-snug">{task.task_name}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5 truncate">
            {assets.join(" + ")}
          </p>
          {task.reason && (
            <p className="text-[10px] text-neutral-500 mt-1 leading-snug line-clamp-1">{task.reason}</p>
          )}
        </div>
        <span className={`text-[9px] border rounded px-1.5 py-0.5 leading-none shrink-0 mt-0.5 ${routeChip}`}>
          {routeLabel}
        </span>
        <span className="text-[10px] text-neutral-700 ml-1 mt-0.5 shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2.5">
          <DetailRow label="Why selected"    value={details.whySelected} />
          <DetailRow label="Input signals"   value={details.inputSignals.join(", ")} />
          <div>
            <p className="text-[9px] text-neutral-600 uppercase tracking-widest mb-1">Logic gates</p>
            <div className="space-y-0.5">
              {details.logicGates.map((g) => (
                <div key={g.name} className="flex items-center gap-2">
                  <span className={`w-1 h-1 rounded-full shrink-0 ${g.result.startsWith("Pass") ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-[10px] text-neutral-500">{g.name}:</span>
                  <span className={`text-[10px] ${g.result.startsWith("Pass") ? "text-green-400/80" : "text-red-400/80"}`}>{g.result}</span>
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
      <p className="text-[9px] text-neutral-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className={`text-[11px] leading-relaxed ${accent ? "text-amber-400/70" : "text-neutral-400"}`}>{value}</p>
    </div>
  );
}

// ─── Agenda card ──────────────────────────────────────────────────

function AgendaCard({ agenda, rank, expanded, onToggle }) {
  const [expandedTasks, setExpandedTasks] = useState({});

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

  return (
    <div className={`border ${cardBorder} rounded-xl overflow-hidden`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors ${headerHover}`}
      >
        <span className="text-[10px] font-mono text-neutral-600 w-4 mt-0.5 shrink-0">{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-sm font-medium ${isRecommended ? "text-green-300" : "text-neutral-100"}`}>
              {meta.label}
            </span>
            {isRecommended && (
              <span className="text-[9px] border border-green-500/40 text-green-400/80 px-1.5 py-0.5 rounded-full leading-none">
                Recommended
              </span>
            )}
            {agenda.needs_human_review && (
              <span className="text-[9px] border border-amber-500/30 text-amber-400/70 px-1.5 py-0.5 rounded-full leading-none">
                Review required
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            <span className={feasColor}>{confPct}% confidence</span>
            <span className="text-neutral-700 mx-1.5">·</span>
            <span>{meta.strategy}</span>
          </p>
        </div>
        <span className="text-[10px] text-neutral-600 mt-0.5 shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className={`px-4 pb-4 border-t ${isRecommended ? "border-green-500/10" : "border-white/5"}`}>
          {/* Scenario block */}
          <div className="mt-3 mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 bg-neutral-900/60 rounded-lg text-[11px]">
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
                <p key={i} className="text-[11px] text-amber-400/70 leading-snug">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Task sequence */}
          {agenda.tasks && agenda.tasks.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-2">
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

          {/* Actions — Approve + Export only */}
          <div className="flex gap-2 mt-3">
            <button className="flex-1 py-2 text-xs rounded-lg border border-green-500/20 text-green-400/70 hover:border-green-500/40 hover:text-green-300 transition-colors cursor-pointer">
              Approve
            </button>
            <button
              onClick={handleExport}
              className="flex-1 py-2 text-xs rounded-lg border border-white/8 text-neutral-500 hover:border-white/15 hover:text-neutral-300 transition-colors cursor-pointer"
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
      <p className="text-[9px] text-neutral-600 uppercase tracking-widest">{label}</p>
      <p className={`text-[11px] font-mono mt-0.5 ${warn ? "text-amber-400" : "text-neutral-300"}`}>{value}</p>
    </div>
  );
}

// ─── Collision summary ────────────────────────────────────────────

function CollisionSummary({ text }) {
  if (!text) return null;
  return (
    <div className="mt-4 mb-1 border border-white/5 rounded-xl px-4 py-3">
      <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-2">
        Collision summary
      </p>
      <p className="text-xs text-neutral-400 leading-relaxed">{text}</p>
    </div>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────

function LeftPanel({ style, status, reasoningSteps, revealedCount, expandedSteps, onToggleStep, onGenerate, errorMsg, csvState, onUploadCSV, csvFileRef, collisionSummary }) {
  const statusPill =
    status === "loading" ? "Processing" :
    status === "done"    ? "Complete"   :
    status === "error"   ? "Error"      : "Idle";

  const pillColor =
    status === "loading" ? "border-cyan-500/30 text-cyan-400/80" :
    status === "done"    ? "border-green-500/30 text-green-400/80" :
    status === "error"   ? "border-red-500/30 text-red-400/80"   :
    "border-white/10 text-neutral-500";

  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-sm font-medium text-neutral-100 font-mono-tech">Q-Router Copilot</h2>
          <span className={`text-[10px] border rounded-full px-2 py-0.5 leading-4 ${pillColor}`}>
            {statusPill}
          </span>
        </div>
        <p className="text-xs text-neutral-500">Flight dynamics reasoning</p>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">

        {/* Idle: static steps */}
        {status === "idle" && (
          <>
            <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-4">
              Active reasoning
            </p>
            <div className="space-y-5">
              {STATIC_STEPS.map((step) => (
                <StaticReasoningStep key={step.id} step={step} />
              ))}
            </div>
          </>
        )}

        {/* Loading: spinner */}
        {status === "loading" && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
            <div className="w-6 h-6 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
            <p className="text-xs text-neutral-500 text-center">Running agenda pipeline…</p>
          </div>
        )}

        {/* Done: process steps from API + collision summary */}
        {status === "done" && reasoningSteps.length > 0 && (
          <>
            <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-3">
              Reasoning trace
            </p>
            <div className="space-y-2">
              {reasoningSteps.slice(0, revealedCount).map((step, i) => (
                <ProcessStep
                  key={i}
                  step={step}
                  index={i}
                  expanded={expandedSteps.has(i)}
                  onToggle={() => onToggleStep(i)}
                />
              ))}
            </div>
            {revealedCount >= reasoningSteps.length && (
              <CollisionSummary text={collisionSummary} />
            )}
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="py-6">
            <p className="text-sm text-red-400 mb-1">Request failed</p>
            <p className="text-xs text-neutral-500 leading-relaxed">{errorMsg}</p>
            <p className="text-xs text-neutral-600 mt-3">
              Make sure the backend is running and the vector DB is built.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pt-2 pb-3 shrink-0">
        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-2.5">
          Suggested actions
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => onGenerate()}
            disabled={status === "loading"}
            className="text-xs px-3 py-1 rounded-full border border-cyan-500/30 text-cyan-400/80 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Generate agendas
          </button>
          {/* Hidden file input — triggered by the Upload CSV button below */}
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={onUploadCSV}
          />
          <button
            onClick={() => csvFileRef.current?.click()}
            disabled={status === "loading"}
            className="text-xs px-3 py-1 rounded-full border border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Upload CSV
          </button>
          {["Analyze risk", "Explain routing"].map((label) => (
            <button
              key={label}
              className="text-xs px-3 py-1 rounded-full border border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200 transition-colors duration-150 cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>

        {/* CSV status feedback */}
        {csvState.filename && (
          <p className="text-[10px] text-neutral-500 mb-1.5 truncate">
            <span className="text-neutral-600">CSV: </span>
            <span className="font-mono text-neutral-400">{csvState.filename}</span>
            {csvState.error && (
              <span className="text-red-400 ml-2">{csvState.error}</span>
            )}
          </p>
        )}
        {!csvState.filename && csvState.error && (
          <p className="text-[10px] text-red-400 mb-1.5">{csvState.error}</p>
        )}
      </div>

      {/* Input */}
      <div className="px-5 pb-5 shrink-0">
        <div className="bg-neutral-900/70 border border-white/10 rounded-xl px-3.5 py-3 focus-within:border-white/20 transition-colors">
          <input
            className="w-full bg-transparent text-sm text-neutral-200 placeholder-neutral-600 outline-none"
            placeholder="Ask for a maneuver plan…"
          />
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[10px] text-neutral-600">
              Draft outputs require analyst review.
            </span>
            <button className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Orbital Simulation ───────────────────────────────────────────

function OrbitalSim() {
  return (
    <div className="flex-1 min-w-0 bg-black rounded-2xl border border-neutral-800 relative overflow-hidden">
      {/* Telemetry overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 pt-4 text-center pointer-events-none select-none">
        <p className="text-xs text-neutral-200 font-mono tracking-wide">
          Visual Time: 4.2s&nbsp;&nbsp;|&nbsp;&nbsp;Physical Time: 2495 s&nbsp;&nbsp;|&nbsp;&nbsp;Speed: 1x
        </p>
        <p className="text-[11px] text-cyan-400/80 font-mono mt-0.5">
          Physics: Earth J2 + drag + sensor fusion telemetry
        </p>
        <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
          Telemetry: 10.0 Hz&nbsp;&nbsp;|&nbsp;&nbsp;5 sats, 4 asteroids, 48 debris&nbsp;&nbsp;|&nbsp;&nbsp;frame 492
        </p>
      </div>

      {/* SIM Dashboard card */}
      <div className="absolute top-4 right-4 z-10 bg-neutral-950/85 border border-neutral-700/50 rounded-lg px-3.5 py-3 backdrop-blur-sm">
        <p className="text-[9px] text-neutral-500 uppercase tracking-widest mb-2 font-semibold">
          SIM DASHBOARD
        </p>
        <div className="space-y-0.5 text-[10px] font-mono text-neutral-400">
          <p>Visual time: <span className="text-neutral-200">4.2 s</span></p>
          <p>Physical time: <span className="text-neutral-200">2475 s</span></p>
          <p>Speed: <span className="text-neutral-200">1x</span></p>
          <p>Satellites active: <span className="text-cyan-400">5</span></p>
          <p>Debris active: <span className="text-amber-400">48</span></p>
          <p>RF detections: <span className="text-neutral-200">0</span></p>
          <p>Solar storm: <span className="text-green-400">quiet</span></p>
          <p>TCAD: <span className="text-neutral-500">fallback/off</span></p>
        </div>
      </div>

      {/* SVG space scene */}
      <svg viewBox="0 0 900 580" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="earthCore" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#5DBBDC" />
            <stop offset="25%" stopColor="#2F8FC0" />
            <stop offset="55%" stopColor="#1A65A0" />
            <stop offset="85%" stopColor="#0E3A6E" />
            <stop offset="100%" stopColor="#061D3A" />
          </radialGradient>
          <radialGradient id="atmoRim" cx="50%" cy="50%" r="50%">
            <stop offset="72%" stopColor="transparent" />
            <stop offset="88%" stopColor="#1A7FCC" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4AB0E8" stopOpacity="0.08" />
          </radialGradient>
          <radialGradient id="cloudLayer" cx="45%" cy="40%" r="55%">
            <stop offset="0%" stopColor="white" stopOpacity="0.08" />
            <stop offset="60%" stopColor="white" stopOpacity="0.03" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="warnGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="shadowMask" cx="65%" cy="65%" r="55%">
            <stop offset="40%" stopColor="transparent" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        <rect width="900" height="580" fill="#00000A" />
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={0.25 + r * 0.3} />
        ))}

        <ellipse cx="430" cy="305" rx="430" ry="235" fill="none" stroke="#8B6914"
          strokeWidth="1.5" strokeOpacity="0.65" transform="rotate(-14 430 305)" />
        <ellipse cx="430" cy="305" rx="275" ry="175" fill="none" stroke="#4B5563"
          strokeWidth="1" strokeOpacity="0.5" strokeDasharray="7 5" transform="rotate(-20 430 305)" />
        <ellipse cx="430" cy="305" rx="160" ry="122" fill="none" stroke="#374151"
          strokeWidth="1" strokeOpacity="0.75" strokeDasharray="5 4" transform="rotate(-10 430 305)" />
        <ellipse cx="430" cy="305" rx="150" ry="128" fill="none" stroke="#374151"
          strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="4 5" transform="rotate(28 430 305)" />

        <g opacity="0.75">
          <line x1="430" y1="183" x2="495" y2="295" stroke="#EF4444" strokeWidth="1.2" />
          <line x1="536" y1="220" x2="495" y2="295" stroke="#EF4444" strokeWidth="1.2" />
          <line x1="558" y1="308" x2="495" y2="295" stroke="#EF4444" strokeWidth="1" />
          <line x1="522" y1="348" x2="495" y2="295" stroke="#EF4444" strokeWidth="1" />
          <line x1="430" y1="183" x2="536" y2="220" stroke="#EF4444" strokeWidth="0.7" strokeDasharray="3 3" />
        </g>
        <circle cx="495" cy="295" r="12" fill="#EF4444" fillOpacity="0.08"
          stroke="#EF4444" strokeWidth="0.8" strokeOpacity="0.4" />

        <circle cx="430" cy="305" r="108" fill="url(#atmoRim)" />
        <circle cx="430" cy="305" r="90" fill="url(#earthCore)" />
        <circle cx="430" cy="305" r="90" fill="url(#cloudLayer)" />
        <ellipse cx="418" cy="272" rx="22" ry="14" fill="#2E7D52" fillOpacity="0.38" transform="rotate(-15 418 272)" />
        <ellipse cx="448" cy="285" rx="14" ry="10" fill="#2E7D52" fillOpacity="0.32" transform="rotate(10 448 285)" />
        <ellipse cx="398" cy="300" rx="10" ry="7" fill="#2E7D52" fillOpacity="0.28" />
        <ellipse cx="455" cy="310" rx="16" ry="8" fill="#2E7D52" fillOpacity="0.30" transform="rotate(-5 455 310)" />
        <ellipse cx="425" cy="325" rx="12" ry="7" fill="#2E7D52" fillOpacity="0.25" />
        <circle cx="430" cy="305" r="90" fill="url(#shadowMask)" />
        <circle cx="430" cy="305" r="90" fill="none" stroke="#5DBBDC" strokeWidth="0.8" strokeOpacity="0.18" />
        <text x="430" y="408" textAnchor="middle" fill="white" fontSize="12" fontWeight="600"
          fontFamily="system-ui, sans-serif" opacity="0.85">Earth</text>

        <g filter="url(#glow)">
          <rect x="426" y="173" width="8" height="5" rx="1" fill="#22D3EE" fillOpacity="0.9" />
          <rect x="418" y="175" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.6" />
          <rect x="436" y="175" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.6" />
          <circle cx="430" cy="175.5" r="2.5" fill="#22D3EE" />
        </g>
        <text x="442" y="171" fill="#22D3EE" fontSize="9.5" fontFamily="monospace" fontWeight="500">SAT-01 | LEO</text>

        <circle cx="495" cy="295" r="3.5" fill="#F97316" filter="url(#warnGlow)" />
        <text x="505" y="292" fill="#F97316" fontSize="9" fontFamily="monospace">COSMOS 2251 DEB</text>

        <circle cx="538" cy="222" r="2.5" fill="#F97316" opacity="0.9" />
        <text x="548" y="220" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.85">COSMOS 2251 DEB</text>

        <circle cx="524" cy="350" r="2.5" fill="#F97316" opacity="0.9" />
        <text x="534" y="348" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.85">COSMOS 2251 DEB</text>

        <circle cx="355" cy="190" r="2" fill="#F97316" opacity="0.7" />
        <text x="300" y="188" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.75">COSMOS 2251 DEB</text>

        <text x="338" y="262" fill="white" fontSize="9" fontFamily="monospace" fillOpacity="0.65">SPHERE 1 | LEO</text>

        <g filter="url(#glow)">
          <rect x="476" y="413" width="8" height="5" rx="1" fill="#22D3EE" fillOpacity="0.85" />
          <rect x="468" y="415" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.55" />
          <rect x="486" y="415" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.55" />
          <circle cx="480" cy="415.5" r="2.5" fill="#22D3EE" />
        </g>
        <text x="493" y="413" fill="#22D3EE" fontSize="9.5" fontFamily="monospace" fontWeight="500">LCS-1 | MEO</text>

        <line x1="385" y1="430" x2="408" y2="490" stroke="#A855F7" strokeWidth="1.2" strokeOpacity="0.45" />
        <line x1="408" y1="490" x2="415" y2="510" stroke="#A855F7" strokeWidth="0.8" strokeOpacity="0.25" />
        <g filter="url(#glow)">
          <rect x="404" y="485" width="7" height="4.5" rx="1" fill="#C084FC" fillOpacity="0.9" />
          <circle cx="407.5" cy="487" r="2.5" fill="#C084FC" />
        </g>
        <text x="420" y="490" fill="#C084FC" fontSize="9.5" fontFamily="monospace">OMNI-M1 | MEO</text>

        <polygon points="408,378 412,370 416,378" fill="#FDE68A" fillOpacity="0.8" />
        <line x1="412" y1="378" x2="412" y2="383" stroke="#FDE68A" strokeWidth="0.8" strokeOpacity="0.6" />
        <text x="420" y="378" fill="#FDE68A" fontSize="8.5" fontFamily="monospace" opacity="0.75">Nashville</text>
      </svg>
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────

function ReviewRow({ title }) {
  return (
    <div>
      <div className="py-3">
        <p className="text-sm text-neutral-400">{title}</p>
        <p className="text-xs text-neutral-600 mt-0.5">No data available</p>
      </div>
      <div className="h-px bg-white/5" />
    </div>
  );
}

function RightPanel({ style, status, agendas, expandedAgendas, onToggleAgenda }) {
  const pillLabel =
    status === "done"    ? `${agendas.length} plans` :
    status === "loading" ? "Generating…"             :
    status === "error"   ? "Error"                   : "Awaiting plan";

  const pillColor =
    status === "done"    ? "border-green-500/30 text-green-400/80" :
    status === "loading" ? "border-cyan-500/30 text-cyan-400/80"   :
    status === "error"   ? "border-red-500/30 text-red-400/80"     :
    "border-white/10 text-neutral-500";

  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-sm font-medium text-neutral-100 font-mono-tech">Maneuver Plans</h2>
          <span className={`text-[10px] border rounded-full px-2 py-0.5 leading-4 ${pillColor}`}>
            {pillLabel}
          </span>
        </div>
        <p className="text-xs text-neutral-500">Human-in-the-loop review</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">

        {/* Idle / loading empty state */}
        {(status === "idle" || status === "loading") && (
          <>
            <p className="text-sm text-neutral-400 leading-relaxed">
              {status === "loading"
                ? "Generating maneuver plans…"
                : "No maneuver plan generated yet."}
            </p>
            <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
              {status === "idle"
                ? "Click \"Generate agendas\" to run the full pipeline."
                : "Results will appear here when complete."}
            </p>
            <div className="h-px bg-white/5 mt-5 mb-1" />
            <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium py-3">
              Review sections
            </p>
            {["Candidate maneuvers", "Audit trail", "Export package"].map((title) => (
              <ReviewRow key={title} title={title} />
            ))}
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="py-4">
            <p className="text-sm text-red-400">Pipeline failed</p>
            <p className="text-xs text-neutral-600 mt-1.5">
              Check the left panel for details.
            </p>
          </div>
        )}

        {/* Agendas */}
        {status === "done" && agendas.length > 0 && (
          <div className="space-y-3">
            <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-1">
              Ranked agenda options
            </p>
            {agendas.map((agenda, i) => (
              <AgendaCard
                key={agenda.agenda_id ?? i}
                agenda={agenda}
                rank={i + 1}
                expanded={expandedAgendas.has(i)}
                onToggle={() => onToggleAgenda(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {status !== "done" && (
        <div className="px-5 pb-5 pt-3 space-y-2 shrink-0">
          <button className="w-full py-2 rounded-xl border border-amber-500/20 text-amber-400/60 text-sm hover:border-amber-500/35 hover:text-amber-300 transition-colors duration-150 cursor-pointer">
            Approve plan
          </button>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-xl border border-white/8 text-neutral-500 text-sm hover:border-white/15 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
              Export
            </button>
            <button className="flex-1 py-2 rounded-xl border border-white/8 text-neutral-500 text-sm hover:border-white/15 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
              View audit
            </button>
          </div>
        </div>
      )}
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
  const [leftWidth, setLeftWidth]   = useState(340);
  const [rightWidth, setRightWidth] = useState(360);

  // Agenda pipeline state
  const [agendaStatus, setAgendaStatus]         = useState("idle"); // idle | loading | done | error
  const [reasoningSteps, setReasoningSteps]     = useState([]);
  const [agendas, setAgendas]                   = useState([]);
  const [collisionSummary, setCollisionSummary] = useState("");
  const [errorMsg, setErrorMsg]                 = useState("");
  const [revealedCount, setRevealedCount]       = useState(0);
  const [expandedSteps, setExpandedSteps]       = useState(new Set());
  const [expandedAgendas, setExpandedAgendas]   = useState(new Set([0])); // first expanded by default

  // CSV upload state
  const [csvState, setCsvState] = useState({ filename: "", error: "" });
  const csvFileRef = useRef(null);

  // Panel resize
  const dragging   = useRef(null);
  const startX     = useRef(0);
  const startWidth = useRef(0);

  const handleDividerMouseDown = (side, e) => {
    dragging.current  = side;
    startX.current    = e.clientX;
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
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Reveal reasoning steps one-by-one after data loads
  useEffect(() => {
    if (agendaStatus !== "done" || reasoningSteps.length === 0) return;
    if (revealedCount >= reasoningSteps.length) return;
    const t = setTimeout(() => setRevealedCount((c) => c + 1), 200);
    return () => clearTimeout(t);
  }, [agendaStatus, reasoningSteps, revealedCount]);

  // Generate agendas — accepts optional uploadedFeatures; falls back to SAMPLE_COLLISION
  const handleGenerateAgendas = useCallback(async (featuresOverride) => {
    setAgendaStatus("loading");
    setReasoningSteps([]);
    setAgendas([]);
    setCollisionSummary("");
    setErrorMsg("");
    setRevealedCount(0);
    setExpandedSteps(new Set());
    setExpandedAgendas(new Set([0]));

    const payload = featuresOverride
      ? { features: featuresOverride }
      : SAMPLE_COLLISION;

    console.log("[q-router] sending features payload:", payload);

    try {
      const res = await fetch("http://localhost:5001/generate-agendas-from-collision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      console.log("[q-router] backend response:", data);
      const receivedAgendas = data.agendas ?? [];
      setReasoningSteps(data.reasoning_steps ?? []);
      setAgendas(receivedAgendas);
      setCollisionSummary(buildCollisionSummary(receivedAgendas));
      setAgendaStatus("done");
    } catch (e) {
      setErrorMsg(e.message ?? "Unknown error");
      setAgendaStatus("error");
    }
  }, []);

  // CSV upload handler
  const handleUploadCSV = useCallback((e) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-selected if needed
    e.target.value = "";

    if (!file) {
      setCsvState({ filename: "", error: "No file selected." });
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        console.log("[q-router] raw CSV rows:", results.data);

        if (!results.data || results.data.length === 0) {
          setCsvState({ filename: file.name, error: "CSV is empty." });
          return;
        }

        // TODO: support batch/event selection when multiple rows are present
        const row = results.data[0];

        const validationError = validateCSVRow(row);
        if (validationError) {
          setCsvState({ filename: file.name, error: validationError });
          return;
        }

        const features = convertCSVRowToFeatures(row);
        console.log("[q-router] converted features:", features);

        setCsvState({ filename: file.name, error: "" });
        handleGenerateAgendas(features);
      },
      error: (err) => {
        setCsvState({ filename: file.name, error: `Parse error: ${err.message}` });
      },
    });
  }, [handleGenerateAgendas]);

  const toggleStep = useCallback((i) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  const toggleAgenda = useCallback((i) => {
    setExpandedAgendas((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 border-b border-white/5 shrink-0"
        style={{ height: 44 }}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-100 font-mono-tech">Q-Router</span>
          <span className="text-xs text-neutral-600 border-l border-white/5 pl-3">
            Orbital AI Copilot
          </span>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-xs text-neutral-400">Conjunction alert</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            <span className="text-xs text-neutral-500">System nominal</span>
          </div>
        </div>
      </header>

      {/* Three-column layout */}
      <main className="flex-1 flex p-3 min-h-0">
        <LeftPanel
          style={{ width: leftWidth }}
          status={agendaStatus}
          reasoningSteps={reasoningSteps}
          revealedCount={revealedCount}
          expandedSteps={expandedSteps}
          onToggleStep={toggleStep}
          onGenerate={handleGenerateAgendas}
          errorMsg={errorMsg}
          csvState={csvState}
          onUploadCSV={handleUploadCSV}
          csvFileRef={csvFileRef}
          collisionSummary={collisionSummary}
        />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("left", e)} />
        <OrbitalSim />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("right", e)} />
        <RightPanel
          style={{ width: rightWidth }}
          status={agendaStatus}
          agendas={agendas}
          expandedAgendas={expandedAgendas}
          onToggleAgenda={toggleAgenda}
        />
      </main>
    </div>
  );
}
