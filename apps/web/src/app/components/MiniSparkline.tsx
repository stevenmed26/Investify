"use client";

type PricePoint = { trading_date: string; close: number };
type Prediction = {
  predicted_direction: "bullish" | "neutral" | "bearish";
  predicted_return_pct: number;
  confidence_score: number;
};

type Props = {
  data: PricePoint[];
  prediction?: Prediction | null;
  width?: number;
  height?: number;
};

function addTradingDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function dirColor(dir: string | undefined) {
  if (dir === "bullish") return "#4ade80";
  if (dir === "bearish") return "#f87171";
  return "#94a3b8";
}

export default function MiniSparkline({
  data,
  prediction,
  width = 280,
  height = 72,
}: Props) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center"
      >
        <span className="text-xs text-slate-600">No data</span>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) =>
    a.trading_date.localeCompare(b.trading_date)
  );
  const last = sorted[sorted.length - 1];
  const lastClose = last.close;
  const horizon = 5;

  // Build projected points
  const projPoints: { date: string; close: number }[] = [];
  if (prediction) {
    const targetClose = lastClose * (1 + prediction.predicted_return_pct / 100);
    const conf = Math.max(0.05, Math.min(0.99, prediction.confidence_score));
    const bandHalf =
      lastClose *
      (1 - conf) *
      Math.max(Math.abs(prediction.predicted_return_pct / 100), 0.005);

    for (let i = 1; i <= horizon; i++) {
      const frac = i / horizon;
      const price = lastClose + (targetClose - lastClose) * frac;
      projPoints.push({
        date: addTradingDays(last.trading_date, i),
        close: price,
      });
    }

    // We'll use bandHalf for the cone — expose it on projPoints
    (projPoints as any)._bandHalf = bandHalf;
    (projPoints as any)._lastClose = lastClose;
    (projPoints as any)._targetClose =
      lastClose * (1 + prediction.predicted_return_pct / 100);
  }

  const allPrices = [
    ...sorted.map((p) => p.close),
    ...projPoints.map((p) => p.close),
  ];
  if (prediction && projPoints.length) {
    const conf = Math.max(0.05, Math.min(0.99, prediction.confidence_score));
    const bandHalf =
      lastClose *
      (1 - conf) *
      Math.max(Math.abs(prediction.predicted_return_pct / 100), 0.005);
    allPrices.push(
      projPoints[projPoints.length - 1].close + bandHalf,
      projPoints[projPoints.length - 1].close - bandHalf
    );
  }

  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const pad = { x: 2, y: 6 };
  const W = width - pad.x * 2;
  const H = height - pad.y * 2;

  const totalPoints = sorted.length + projPoints.length;

  function toX(i: number) {
    return pad.x + (i / (totalPoints - 1)) * W;
  }
  function toY(price: number) {
    return pad.y + H - ((price - minP) / range) * H;
  }

  // Build historical path
  const histPath = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.close).toFixed(1)}`)
    .join(" ");

  // Today x position
  const todayX = toX(sorted.length - 1);

  // Projected central line
  const projPath = projPoints.length
    ? [
        `M ${todayX.toFixed(1)} ${toY(lastClose).toFixed(1)}`,
        ...projPoints.map((p, i) =>
          `L ${toX(sorted.length + i).toFixed(1)} ${toY(p.close).toFixed(1)}`
        ),
      ].join(" ")
    : null;

  // Confidence band polygon
  let bandPath: string | null = null;
  if (prediction && projPoints.length) {
    const conf = Math.max(0.05, Math.min(0.99, prediction.confidence_score));
    const bandHalfFull =
      lastClose *
      (1 - conf) *
      Math.max(Math.abs(prediction.predicted_return_pct / 100), 0.005);

    const upper = projPoints.map((p, i) => {
      const frac = (i + 1) / horizon;
      return `${toX(sorted.length + i).toFixed(1)},${toY(p.close + bandHalfFull * frac).toFixed(1)}`;
    });
    const lower = [...projPoints]
      .reverse()
      .map((p, i) => {
        const frac = (projPoints.length - i) / horizon;
        return `${toX(sorted.length + (projPoints.length - 1 - i)).toFixed(1)},${toY(p.close - bandHalfFull * frac).toFixed(1)}`;
      });

    bandPath = [
      `${todayX.toFixed(1)},${toY(lastClose).toFixed(1)}`,
      ...upper,
      ...lower,
    ].join(" ");
  }

  const color = dirColor(prediction?.predicted_direction);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      {/* Confidence band */}
      {bandPath && (
        <polygon
          points={bandPath}
          fill={color}
          fillOpacity={0.12}
          stroke="none"
        />
      )}

      {/* Historical line */}
      <path
        d={histPath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Today marker */}
      <line
        x1={todayX}
        y1={pad.y}
        x2={todayX}
        y2={height - pad.y}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />

      {/* Projected line */}
      {projPath && (
        <path
          d={projPath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
      )}

      {/* Endpoint dot on projection */}
      {projPoints.length > 0 && (
        <circle
          cx={toX(totalPoints - 1)}
          cy={toY(projPoints[projPoints.length - 1].close)}
          r={2.5}
          fill={color}
          fillOpacity={0.9}
        />
      )}
    </svg>
  );
}