"use client";

type PricePoint = { trading_date: string; close: number; volume?: number };
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

export default function MiniSparkline({ data, prediction, height = 72 }: Props) {
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

  // Layout zones: top area for price, bottom strip for volume bars
  const volHeight = 14;         // px in viewBox units for volume strip
  const priceH = VH - volHeight - 2; // price area height
  const padX = 4;
  const padYTop = 5;
  const padYBot = 2;
  const priceAreaH = priceH - padYTop - padYBot;
  const W = VW - padX * 2;

  const sorted = [...data].sort((a, b) =>
    a.trading_date.localeCompare(b.trading_date)
  );
  const last = sorted[sorted.length - 1];
  const lastClose = last.close;

  // Build projected points
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

  // Y domain
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

  const totalPoints = sorted.length + projPoints.length;

  function toX(i: number) {
    return padX + (i / (totalPoints - 1)) * W;
  }
  function toY(price: number) {
    return padYTop + priceAreaH - ((price - minP) / range) * priceAreaH;
  }

  const histPath = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`)
    .join(" ");

  const todayX = toX(sorted.length - 1);
  const baselineY = priceH; // bottom of price area

  // Closed area path for gradient fill under historical line
  const areaPath =
    histPath +
    ` L${toX(sorted.length - 1).toFixed(1)},${baselineY} L${toX(0).toFixed(1)},${baselineY} Z`;

  const projPath = projPoints.length
    ? [
        `M${todayX.toFixed(1)},${toY(lastClose).toFixed(1)}`,
        ...projPoints.map((p, i) =>
          `L${toX(sorted.length + i).toFixed(1)},${toY(p.close).toFixed(1)}`
        ),
      ].join(" ")
    : null;

  // Confidence band
  let bandPoints: string | null = null;
  if (projPoints.length && bandHalfFull > 0) {
    const upper = projPoints.map((p, i) => {
      const frac = (i + 1) / horizon;
      return `${toX(sorted.length + i).toFixed(1)},${toY(p.close + bandHalfFull * frac).toFixed(1)}`;
    });
    const lower = [...projPoints].reverse().map((p, i) => {
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

  // Volume bars
  const volumes = sorted.map((p) => p.volume ?? 0);
  const maxVol = Math.max(...volumes, 1);
  const volTop = priceH + 2;
  const volBarMaxH = volHeight - 2;
  const barW = Math.max(1, (W / sorted.length) * 0.55);

  // Grid lines: 3 horizontal price levels
  const gridLevels = [0.25, 0.5, 0.75];

  const color = dirColor(prediction?.predicted_direction);
  const endPt = projPoints.length ? projPoints[projPoints.length - 1] : null;
  const gradId = `area-grad-${Math.random().toString(36).slice(2, 7)}`;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className="block overflow-visible"
    >
      <defs>
        {/* Gradient fill under price line */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#60a5fa" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Horizontal grid lines */}
      {gridLevels.map((frac, i) => {
        const y = padYTop + priceAreaH * (1 - frac);
        return (
          <line
            key={i}
            x1={padX} y1={y.toFixed(1)}
            x2={VW - padX} y2={y.toFixed(1)}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        );
      })}

      {/* Area fill under historical line */}
      <path
        d={areaPath}
        fill={`url(#${gradId})`}
        stroke="none"
      />

      {/* Confidence band */}
      {bandPoints && (
        <polygon
          points={bandPoints}
          fill={color}
          fillOpacity={0.14}
          stroke="none"
        />
      )}

      {/* Historical price line */}
      <path
        d={histPath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Today divider */}
      <line
        x1={todayX} y1={padYTop}
        x2={todayX} y2={priceH}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />

      {/* Projected line */}
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

      {/* Projection endpoint dot */}
      {endPt && (
        <circle
          cx={toX(totalPoints - 1)}
          cy={toY(endPt.close)}
          r={3.5}
          fill={color}
          fillOpacity={0.95}
        />
      )}

      {/* Volume bars */}
      {sorted.map((p, i) => {
        const vol = p.volume ?? 0;
        if (vol === 0) return null;
        const barH = (vol / maxVol) * volBarMaxH;
        const x = toX(i) - barW / 2;
        const isUp = i === 0 ? true : p.close >= sorted[i - 1].close;
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(volTop + volBarMaxH - barH).toFixed(1)}
            width={barW.toFixed(1)}
            height={barH.toFixed(1)}
            fill={isUp ? "rgba(96,165,250,0.35)" : "rgba(248,113,71,0.3)"}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}