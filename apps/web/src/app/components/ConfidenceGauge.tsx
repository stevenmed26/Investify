"use client";

type Props = {
  value: number; // 0–1
  size?: number;
};

export default function ConfidenceGauge({ value, size = 64 }: Props) {
  const pct = Math.max(0, Math.min(1, value));
  const displayPct = Math.round(pct * 100);

  // Semicircle arc geometry
  // Centre of the full circle sits at bottom-centre of the viewBox
  const cx = size / 2;
  const cy = size * 0.72; // push centre down so semicircle sits nicely
  const r = size * 0.38;
  const strokeW = size * 0.09;

  // Arc from 180° (left) to 0° (right) going counter-clockwise = top arc
  // We want the gauge to sweep from left → right as value increases
  const startAngle = Math.PI; // 180° = left
  const endAngle = 0;         // 0°   = right
  const totalSweep = Math.PI; // 180° total

  function polar(angle: number) {
    return {
      x: cx + r * Math.cos(angle),
      y: cy - r * Math.sin(angle), // SVG y is inverted
    };
  }

  const start = polar(startAngle);
  const end = polar(endAngle);
  const filled = polar(startAngle - totalSweep * pct);

  // Background track path (full semicircle)
  const trackPath = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;

  // Filled arc path
  const largeArc = totalSweep * pct > Math.PI ? 1 : 0;
  const fillPath =
    pct <= 0
      ? null
      : pct >= 1
      ? trackPath
      : `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${filled.x.toFixed(2)} ${filled.y.toFixed(2)}`;

  // Colour: red (0%) → yellow (50%) → green (100%)
  function gaugeColor(p: number): string {
    if (p < 0.5) {
      // red → yellow
      const t = p / 0.5;
      const red = 248;
      const g = Math.round(113 + (197 - 113) * t); // 113→197
      return `rgb(${red},${g},71)`;
    } else {
      // yellow → green
      const t = (p - 0.5) / 0.5;
      const red = Math.round(248 - (248 - 74) * t);  // 248→74
      const g = Math.round(197 + (222 - 197) * t);    // 197→222
      const b = Math.round(71 + (128 - 71) * t);      // 71→128
      return `rgb(${red},${g},${b})`;
    }
  }

  const color = gaugeColor(pct);

  return (
    <svg
      width={size}
      height={size * 0.72}
      viewBox={`0 0 ${size} ${size * 0.72}`}
      className="overflow-visible"
      aria-label={`Confidence: ${displayPct}%`}
    >
      {/* Track */}
      <path
        d={trackPath}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />

      {/* Filled arc */}
      {fillPath && (
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          style={{ transition: "stroke 0.4s ease, d 0.4s ease" }}
        />
      )}

      {/* Percentage text */}
      <text
        x={cx}
        y={cy + strokeW * 0.1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.22}
        fontWeight="600"
        fill={color}
        fontFamily="'DM Mono', 'Fira Code', monospace"
        style={{ transition: "fill 0.4s ease" }}
      >
        {displayPct}%
      </text>
    </svg>
  );
}