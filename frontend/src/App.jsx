import { useEffect, useRef, useState } from "react";
import {
  Satellite,
  FileCheck,
  Zap,
  Activity,
  Send,
  Download,
  Eye,
  CheckCircle,
} from "lucide-react";

// ─── Static data ────────────────────────────────────────────────

const REASONING_ITEMS = [
  {
    id: 1,
    label: "Collision Risk",
    text: "Collision risk detected between SAT-01 and COSMOS debris",
    type: "warning",
  },
  {
    id: 2,
    label: "Maneuver Timing",
    text: "Evaluating maneuver timing window — burn T+00:04:22",
    type: "active",
  },
  {
    id: 3,
    label: "Routing Check",
    text: "Checking classical vs quantum routing gates",
    type: "info",
  },
];

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

// ─── Left Panel ─────────────────────────────────────────────────

const typeStyles = {
  warning: {
    card: "border-red-900/50 bg-red-950/25",
    dot: "bg-red-400",
    label: "text-red-400",
  },
  active: {
    card: "border-amber-900/50 bg-amber-950/20",
    dot: "bg-amber-400",
    label: "text-amber-400",
  },
  info: {
    card: "border-cyan-900/40 bg-cyan-950/20",
    dot: "bg-cyan-400",
    label: "text-cyan-400",
  },
};

function ReasoningCard({ item }) {
  const s = typeStyles[item.type];
  return (
    <div className={`rounded-xl border p-3.5 ${s.card}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className={`text-[10px] font-semibold tracking-widest uppercase ${s.label}`}>
          {item.label}
        </span>
      </div>
      <p className="text-sm text-neutral-300 leading-relaxed">{item.text}</p>
    </div>
  );
}

function LeftPanel({ style }) {
  return (
    <div className="flex flex-col bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden shrink-0" style={style}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <h2 className="text-sm font-semibold text-neutral-100">Q-Router Copilot</h2>
        </div>
        <p className="text-xs text-neutral-500 ml-[38px]">Flight dynamics reasoning</p>
      </div>

      {/* Reasoning stream */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium">
          Active reasoning
        </p>
        {REASONING_ITEMS.map((item) => (
          <ReasoningCard key={item.id} item={item} />
        ))}

        {/* Thinking dots */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse [animation-delay:200ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse [animation-delay:400ms]" />
          </div>
          <span className="text-xs text-neutral-600">Analyzing orbital parameters…</span>
        </div>
      </div>

      {/* Quick action pills */}
      <div className="px-4 pt-1 pb-3 flex flex-wrap gap-1.5 shrink-0">
        {["Analyze risk", "Suggest maneuver", "Explain routing"].map((label) => (
          <button
            key={label}
            className="text-xs px-3 py-1 rounded-full border border-neutral-700 text-neutral-400 hover:border-violet-500/50 hover:text-violet-300 hover:bg-violet-500/10 transition-colors duration-150 cursor-pointer"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Prompt input */}
      <div className="px-4 pb-4 shrink-0">
        <div className="flex items-center gap-2 bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2.5 focus-within:border-neutral-600 transition-colors">
          <input
            className="flex-1 bg-transparent text-sm text-neutral-200 placeholder-neutral-600 outline-none"
            placeholder="Ask for a maneuver plan…"
          />
          <button className="text-neutral-600 hover:text-violet-400 transition-colors duration-150 cursor-pointer">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Orbital Simulation ─────────────────────────────────────────

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
          {/* Earth gradient */}
          <radialGradient id="earthCore" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#5DBBDC" />
            <stop offset="25%" stopColor="#2F8FC0" />
            <stop offset="55%" stopColor="#1A65A0" />
            <stop offset="85%" stopColor="#0E3A6E" />
            <stop offset="100%" stopColor="#061D3A" />
          </radialGradient>
          {/* Atmosphere rim */}
          <radialGradient id="atmoRim" cx="50%" cy="50%" r="50%">
            <stop offset="72%" stopColor="transparent" />
            <stop offset="88%" stopColor="#1A7FCC" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4AB0E8" stopOpacity="0.08" />
          </radialGradient>
          {/* Subtle cloud layer */}
          <radialGradient id="cloudLayer" cx="45%" cy="40%" r="55%">
            <stop offset="0%" stopColor="white" stopOpacity="0.08" />
            <stop offset="60%" stopColor="white" stopOpacity="0.03" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          {/* Object glow filter */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Warning glow */}
          <filter id="warnGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Earth shadow mask */}
          <radialGradient id="shadowMask" cx="65%" cy="65%" r="55%">
            <stop offset="40%" stopColor="transparent" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* Deep space background */}
        <rect width="900" height="580" fill="#00000A" />

        {/* Stars */}
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={0.25 + r * 0.3} />
        ))}

        {/* ── Orbits ── */}

        {/* Outer HEO/GTO orbit — large tilted ellipse */}
        <ellipse
          cx="430" cy="305"
          rx="430" ry="235"
          fill="none"
          stroke="#8B6914"
          strokeWidth="1.5"
          strokeOpacity="0.65"
          transform="rotate(-14 430 305)"
        />

        {/* MEO orbit */}
        <ellipse
          cx="430" cy="305"
          rx="275" ry="175"
          fill="none"
          stroke="#4B5563"
          strokeWidth="1"
          strokeOpacity="0.5"
          strokeDasharray="7 5"
          transform="rotate(-20 430 305)"
        />

        {/* LEO primary orbit */}
        <ellipse
          cx="430" cy="305"
          rx="160" ry="122"
          fill="none"
          stroke="#374151"
          strokeWidth="1"
          strokeOpacity="0.75"
          strokeDasharray="5 4"
          transform="rotate(-10 430 305)"
        />

        {/* LEO inclined orbit */}
        <ellipse
          cx="430" cy="305"
          rx="150" ry="128"
          fill="none"
          stroke="#374151"
          strokeWidth="0.8"
          strokeOpacity="0.4"
          strokeDasharray="4 5"
          transform="rotate(28 430 305)"
        />

        {/* ── Collision warning paths (red converging lines) ── */}
        <g opacity="0.75">
          <line x1="430" y1="183" x2="495" y2="295" stroke="#EF4444" strokeWidth="1.2" />
          <line x1="536" y1="220" x2="495" y2="295" stroke="#EF4444" strokeWidth="1.2" />
          <line x1="558" y1="308" x2="495" y2="295" stroke="#EF4444" strokeWidth="1" />
          <line x1="522" y1="348" x2="495" y2="295" stroke="#EF4444" strokeWidth="1" />
          <line x1="430" y1="183" x2="536" y2="220" stroke="#EF4444" strokeWidth="0.7" strokeDasharray="3 3" />
        </g>
        {/* Warning zone highlight */}
        <circle cx="495" cy="295" r="12" fill="#EF4444" fillOpacity="0.08" stroke="#EF4444" strokeWidth="0.8" strokeOpacity="0.4" />

        {/* ── Earth ── */}
        {/* Outer atmosphere glow */}
        <circle cx="430" cy="305" r="108" fill="url(#atmoRim)" />
        {/* Earth body */}
        <circle cx="430" cy="305" r="90" fill="url(#earthCore)" />
        {/* Cloud / specular layer */}
        <circle cx="430" cy="305" r="90" fill="url(#cloudLayer)" />
        {/* Subtle continent shapes */}
        <ellipse cx="418" cy="272" rx="22" ry="14" fill="#2E7D52" fillOpacity="0.38" transform="rotate(-15 418 272)" />
        <ellipse cx="448" cy="285" rx="14" ry="10" fill="#2E7D52" fillOpacity="0.32" transform="rotate(10 448 285)" />
        <ellipse cx="398" cy="300" rx="10" ry="7" fill="#2E7D52" fillOpacity="0.28" />
        <ellipse cx="455" cy="310" rx="16" ry="8" fill="#2E7D52" fillOpacity="0.30" transform="rotate(-5 455 310)" />
        <ellipse cx="425" cy="325" rx="12" ry="7" fill="#2E7D52" fillOpacity="0.25" />
        {/* Shadow terminator */}
        <circle cx="430" cy="305" r="90" fill="url(#shadowMask)" />
        {/* Earth rim highlight */}
        <circle cx="430" cy="305" r="90" fill="none" stroke="#5DBBDC" strokeWidth="0.8" strokeOpacity="0.18" />

        {/* Earth label */}
        <text x="430" y="408" textAnchor="middle" fill="white" fontSize="12" fontWeight="600" fontFamily="system-ui, sans-serif" opacity="0.85">
          Earth
        </text>

        {/* ── Satellites & Debris ── */}

        {/* SAT-01 | LEO — top of orbit */}
        <g filter="url(#glow)">
          {/* Satellite body */}
          <rect x="426" y="173" width="8" height="5" rx="1" fill="#22D3EE" fillOpacity="0.9" />
          {/* Solar panels */}
          <rect x="418" y="175" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.6" />
          <rect x="436" y="175" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.6" />
          <circle cx="430" cy="175.5" r="2.5" fill="#22D3EE" />
        </g>
        <text x="442" y="171" fill="#22D3EE" fontSize="9.5" fontFamily="monospace" fontWeight="500">SAT-01 | LEO</text>

        {/* COSMOS 2251 DEB — main threat, near collision zone */}
        <circle cx="495" cy="295" r="3.5" fill="#F97316" filter="url(#warnGlow)" />
        <text x="505" y="292" fill="#F97316" fontSize="9" fontFamily="monospace">COSMOS 2251 DEB</text>

        {/* COSMOS debris — scattered */}
        <circle cx="538" cy="222" r="2.5" fill="#F97316" opacity="0.9" />
        <text x="548" y="220" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.85">COSMOS 2251 DEB</text>

        <circle cx="524" cy="350" r="2.5" fill="#F97316" opacity="0.9" />
        <text x="534" y="348" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.85">COSMOS 2251 DEB</text>

        <circle cx="355" cy="190" r="2" fill="#F97316" opacity="0.7" />
        <text x="300" y="188" fill="#F97316" fontSize="8.5" fontFamily="monospace" opacity="0.75">COSMOS 2251 DEB</text>

        {/* SPHERE 1 | LEO label near Earth top */}
        <text x="338" y="262" fill="white" fontSize="9" fontFamily="monospace" fillOpacity="0.65">SPHERE 1 | LEO</text>

        {/* LCS-1 | MEO */}
        <g filter="url(#glow)">
          <rect x="476" y="413" width="8" height="5" rx="1" fill="#22D3EE" fillOpacity="0.85" />
          <rect x="468" y="415" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.55" />
          <rect x="486" y="415" width="6" height="1.5" fill="#22D3EE" fillOpacity="0.55" />
          <circle cx="480" cy="415.5" r="2.5" fill="#22D3EE" />
        </g>
        <text x="493" y="413" fill="#22D3EE" fontSize="9.5" fontFamily="monospace" fontWeight="500">LCS-1 | MEO</text>

        {/* OMNI-M1 | MEO — lower, magenta/violet */}
        {/* Trail */}
        <line x1="385" y1="430" x2="408" y2="490" stroke="#A855F7" strokeWidth="1.2" strokeOpacity="0.45" />
        <line x1="408" y1="490" x2="415" y2="510" stroke="#A855F7" strokeWidth="0.8" strokeOpacity="0.25" />
        <g filter="url(#glow)">
          <rect x="404" y="485" width="7" height="4.5" rx="1" fill="#C084FC" fillOpacity="0.9" />
          <circle cx="407.5" cy="487" r="2.5" fill="#C084FC" />
        </g>
        <text x="420" y="490" fill="#C084FC" fontSize="9.5" fontFamily="monospace">OMNI-M1 | MEO</text>

        {/* Nashville ground station */}
        <polygon points="408,378 412,370 416,378" fill="#FDE68A" fillOpacity="0.8" />
        <line x1="412" y1="378" x2="412" y2="383" stroke="#FDE68A" strokeWidth="0.8" strokeOpacity="0.6" />
        <text x="420" y="378" fill="#FDE68A" fontSize="8.5" fontFamily="monospace" opacity="0.75">Nashville</text>
      </svg>
    </div>
  );
}

// ─── Right Panel ─────────────────────────────────────────────────

function DisabledSection({ title }) {
  return (
    <div className="rounded-xl border border-neutral-800 p-3.5 opacity-40">
      <p className="text-xs font-medium text-neutral-400">{title}</p>
      <p className="text-xs text-neutral-700 mt-1.5">No data available</p>
    </div>
  );
}

function RightPanel({ style }) {
  return (
    <div className="flex flex-col bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden shrink-0" style={style}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="w-7 h-7 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center shrink-0">
            <FileCheck className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <h2 className="text-sm font-semibold text-neutral-100">Maneuver Plans</h2>
        </div>
        <p className="text-xs text-neutral-500 ml-[38px]">Human-in-the-loop review</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {/* Empty state */}
        <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center">
          <Satellite className="w-6 h-6 text-neutral-700 mx-auto mb-2.5" />
          <p className="text-sm text-neutral-500">Optimized plans will appear here.</p>
          <p className="text-xs text-neutral-700 mt-1">Submit a maneuver request to begin.</p>
        </div>

        <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-medium pt-1">
          Review sections
        </p>
        <DisabledSection title="Candidate maneuvers" />
        <DisabledSection title="Audit trail" />
        <DisabledSection title="Export package" />
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-amber-600/15 border border-amber-500/25 text-amber-300/70 text-sm font-medium hover:bg-amber-600/25 hover:border-amber-500/40 hover:text-amber-300 transition-colors duration-150 cursor-pointer">
          <CheckCircle className="w-3.5 h-3.5" />
          Approve plan
        </button>
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-500 text-sm font-medium hover:border-neutral-600 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-500 text-sm font-medium hover:border-neutral-600 hover:text-neutral-300 transition-colors duration-150 cursor-pointer">
            <Eye className="w-3.5 h-3.5" />
            View audit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Drag Divider ────────────────────────────────────────────────

function DragDivider({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-3 shrink-0 flex items-stretch justify-center group"
      style={{ cursor: "col-resize" }}
    >
      <div className="w-px bg-neutral-800 group-hover:bg-cyan-500/40 transition-colors duration-150 my-6 rounded-full" />
    </div>
  );
}

// ─── App Shell ───────────────────────────────────────────────────

const LEFT_MIN = 240;
const LEFT_MAX = 500;
const RIGHT_MIN = 260;
const RIGHT_MAX = 520;

export default function App() {
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);

  const dragging = useRef(null); // 'left' | 'right' | null
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
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 font-mono flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center">
            <Satellite className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <span className="text-sm font-semibold text-neutral-100 tracking-tight">Q-Router</span>
          <span className="text-xs text-neutral-600 border-l border-neutral-800 pl-3">
            Orbital AI Copilot
          </span>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-400 font-medium">Conjunction Alert</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-neutral-500">System nominal</span>
          </div>
        </div>
      </header>

      {/* Three-column layout with drag dividers */}
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
