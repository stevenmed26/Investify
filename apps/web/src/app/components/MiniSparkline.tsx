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

export default function MiniSparkline({ data, prediction, height = 68 }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="w-full flex items-center justify-center" style={{ height }}>
        <span className="text-xs text-slate-600">No data</span>
      </div>
    );
  }

  const VW = 500;
  const VH = height;
  const horizon = 5;

  const sorted = [...data].sort((a, b) =>
    a.trading_date.localeCompare(b.trading_date)
  );
  const last = sorted[sorted.length - 1];
  const lastClose = last.close;

  const projPoints: { date: string; close: number }[] = [];
  let bandHalfFull = 0;

  if (prediction) {
    const targetClose = lastClose * (1 + prediction.predicted_return_pct / 100);
    const conf = Math.max(0.05, Math.min(0.99, prediction.confidence_score));
    bandHalfFull =
      lastClose *
      (1 - conf) *
      Math.max(Math.abs(prediction.predicted_return_pct / 100), 0.005);

    for (let i = 1; i <= horizon; i++) {
      const frac = i / horizon;
      projPoints.push({
        date: addTradingDays(last.trading_date, i),
        close: lastClose + (targetClose - lastClose) * frac,
      });
    }
  }

  const allPrices = [
    ...sorted.map((p) => p.close),
    ...projPoints.map((p) => p.close),
  ];
  if (projPoints.length && bandHalfFull > 0) {
    allPrices.push(
      projPoints[projPoints.length - 1].close + bandHalfFull,
      projPoints[projPoints.length - 1].close - bandHalfFull
    );
  }

  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const padX = 4;
  const padY = 6;
  const W = VW - padX * 2;
  const H = VH - padY * 2;
  const totalPoints = sorted.length + projPoints.length;

  function toX(i: number) {
    return padX + (i / (totalPoints - 1)) * W;
  }
  function toY(price: number) {
    return padY + H - ((price - minP) / range) * H;
  }

  const histPath = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`)
    .join(" ");

  const todayX = toX(sorted.length - 1);

  const projPath = projPoints.length
    ? [
        `M${todayX.toFixed(1)},${toY(lastClose).toFixed(1)}`,
        ...projPoints.map((p, i) =>
          `L${toX(sorted.length + i).toFixed(1)},${toY(p.close).toFixed(1)}`
        ),
      ].join(" ")
    : null;

  let bandPoints: string | null = null;
  if (projPoints.length && bandHalfFull > 0) {
    const upper = projPoints.map((p, i) => {
      const frac = (i + 1) / horizon;
      return `${toX(sorted.length + i).toFixed(1)},${toY(p.close + bandHalfFull * frac).toFixed(1)}`;
    });
    const lower = [...projPoints]
      .reverse()
      .map((p, i) => {
        const origI = projPoints.length - 1 - i;
        const frac = (origI + 1) / horizon;
        return `${toX(sorted.length + origI).toFixed(1)},${toY(p.close - bandHalfFull * frac).toFixed(1)}`;
      });
    bandPoints = [
      `${todayX.toFixed(1)},${toY(lastClose).toFixed(1)}`,
      ...upper,
      ...lower,
    ].join(" ");
  }

  const color = dirColor(prediction?.predicted_direction);
  const endPt = projPoints.length ? projPoints[projPoints.length - 1] : null;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className="block overflow-visible"
    >
      {bandPoints && (
        <polygon points={bandPoints} fill={color} fillOpacity={0.13} stroke="none" />
      )}
      <path
        d={histPath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1={todayX} y1={padY} x2={todayX} y2={VH - padY}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />
      {projPath && (
        <path
          d={projPath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
      )}
      {endPt && (
        <circle
          cx={toX(totalPoints - 1)}
          cy={toY(endPt.close)}
          r={3.5}
          fill={color}
          fillOpacity={0.95}
        />
      )}
    </svg>
  );
}