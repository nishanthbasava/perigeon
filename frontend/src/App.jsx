import { useEffect, useRef, useState } from "react";

// ─── Static data ─────────────────────────────────────────────────

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

const REASONING_STEPS = [
  {
    id: 1,
    label: "Conjunction Risk",
    text: (
      <>
        Possible collision path detected between{" "}
        <span className="font-mono text-neutral-300">SAT-01</span> and{" "}
        <span className="font-mono text-neutral-300">COSMOS 2251</span> debris.
      </>
    ),
    detail: "Miss distance falls below projected safety threshold.",
    type: "risk",
  },
  {
    id: 2,
    label: "Maneuver Window",
    text: (
      <>
        Evaluating burn timing around{" "}
        <span className="font-mono text-neutral-300">T+00:04:22</span>.
      </>
    ),
    detail: (
      <>
        Prioritizing low-<span className="font-mono">Δv</span> options before
        escalation.
      </>
    ),
    type: "maneuver",
  },
  {
    id: 3,
    label: "Routing Check",
    text: "Scoring whether the task should remain classical or route to quantum optimization.",
    detail: "Latency, task size, priority, and uncertainty gates are being evaluated.",
    type: "routing",
  },
  {
    id: 4,
    label: "Next Action",
    text: "Awaiting analyst instruction before generating maneuver candidates.",
    detail: "Suggested actions are available below.",
    type: "thinking",
  },
];

const STEP_DOT = {
  risk: "bg-red-400",
  maneuver: "bg-amber-400",
  routing: "bg-cyan-400",
  thinking: "bg-violet-400",
};

const STEP_ACCENT = {
  risk: "bg-red-500/50",
  maneuver: "bg-amber-500/50",
  routing: "bg-cyan-500/50",
  thinking: "bg-violet-500/50",
};

// ─── Left Panel ──────────────────────────────────────────────────

function ReasoningStep({ step }) {
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

function LeftPanel({ style }) {
  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-sm font-medium text-neutral-100">Q-Router Copilot</h2>
          <span className="text-[10px] text-neutral-500 border border-white/10 rounded-full px-2 py-0.5 leading-4">
            Thinking
          </span>
        </div>
        <p className="text-xs text-neutral-500">Flight dynamics reasoning</p>
      </div>

      {/* Reasoning stream */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium">
          Active reasoning
        </p>
        {REASONING_STEPS.map((step) => (
          <ReasoningStep key={step.id} step={step} />
        ))}
      </div>

      {/* Suggested actions */}
      <div className="px-5 pt-2 pb-3 shrink-0">
        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium mb-2.5">
          Suggested actions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["Analyze risk", "Suggest maneuver", "Explain routing"].map((label) => (
            <button
              key={label}
              className="text-xs px-3 py-1 rounded-full border border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200 transition-colors duration-150 cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>
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

// ─── Orbital Simulation ──────────────────────────────────────────

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
      <svg
        viewBox="0 0 900 580"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
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
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="warnGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
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

// ─── Right Panel ─────────────────────────────────────────────────

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

function RightPanel({ style }) {
  return (
    <div
      className="flex flex-col bg-[#171717] rounded-2xl border border-white/5 overflow-hidden shrink-0"
      style={style}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-sm font-medium text-neutral-100">Maneuver Plans</h2>
          <span className="text-[10px] text-neutral-500 border border-white/10 rounded-full px-2 py-0.5 leading-4">
            Awaiting plan
          </span>
        </div>
        <p className="text-xs text-neutral-500">Human-in-the-loop review</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
        {/* Empty state */}
        <p className="text-sm text-neutral-400 leading-relaxed">
          No maneuver plan generated yet.
        </p>
        <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
          Ask the copilot to suggest a candidate burn or routing decision.
        </p>

        <div className="h-px bg-white/5 mt-5 mb-1" />

        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium py-3">
          Review sections
        </p>

        {["Candidate maneuvers", "Audit trail", "Export package"].map((title) => (
          <ReviewRow key={title} title={title} />
        ))}
      </div>

      {/* Action buttons */}
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
const RIGHT_MAX = 520;

export default function App() {
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);

  const dragging = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleDividerMouseDown = (side, e) => {
    dragging.current = side;
    startX.current = e.clientX;
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

  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 border-b border-white/5 shrink-0"
        style={{ height: 44 }}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-100">Q-Router</span>
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
        <LeftPanel style={{ width: leftWidth }} />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("left", e)} />
        <OrbitalSim />
        <DragDivider onMouseDown={(e) => handleDividerMouseDown("right", e)} />
        <RightPanel style={{ width: rightWidth }} />
      </main>
    </div>
  );
}
