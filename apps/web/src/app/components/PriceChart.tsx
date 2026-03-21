"use client";

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  TooltipProps,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PricePoint = {
  trading_date: string;
  close: number;
};

type Prediction = {
  predicted_direction: "bullish" | "neutral" | "bearish";
  predicted_return_pct: number;
  confidence_score: number;
  horizon_days?: number;
};

type Props = {
  data: PricePoint[];
  prediction?: Prediction | null;
};

// ---------------------------------------------------------------------------
// Chart data shape
// ---------------------------------------------------------------------------
type ChartPoint = {
  date: string;
  // Historical close — null for projected points
  close: number | null;
  // Projected central line — null for historical points
  projected: number | null;
  // Confidence band bounds — null for historical points
  bandLow: number | null;
  bandHigh: number | null;
  // Flag so the tooltip can distinguish past vs future
  isFuture?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance a YYYY-MM-DD date by N calendar days, skipping weekends. */
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

/** Format YYYY-MM-DD as "Mar 20" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Round to 2 dp */
function r2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Build chart data
// ---------------------------------------------------------------------------
function buildChartData(data: PricePoint[], prediction: Prediction | null | undefined): {
  points: ChartPoint[];
  todayDate: string;
} {
  if (data.length === 0) return { points: [], todayDate: "" };

  const sorted = [...data].sort((a, b) => a.trading_date.localeCompare(b.trading_date));
  const lastPoint = sorted[sorted.length - 1];
  const lastClose = lastPoint.close;
  const todayDate = lastPoint.trading_date;

  // Historical points
  const points: ChartPoint[] = sorted.map((p) => ({
    date: p.trading_date,
    close: p.close,
    projected: null,
    bandLow: null,
    bandHigh: null,
    isFuture: false,
  }));

  // Anchor the projection at today's close so the lines connect
  points[points.length - 1] = {
    ...points[points.length - 1],
    projected: lastClose,
    bandLow: lastClose,
    bandHigh: lastClose,
  };

  if (!prediction) return { points, todayDate };

  const horizonDays = prediction.horizon_days ?? 5;
  const targetReturn = prediction.predicted_return_pct / 100;
  const targetPrice = lastClose * (1 + targetReturn);
  const confidence = Math.max(0.05, Math.min(0.99, prediction.confidence_score));

  // Band half-width at the horizon: lower confidence → wider band.
  // We use a simple model: uncertainty = (1 - confidence) * |predicted move|,
  // with a floor of 0.5% so there's always a visible band even at high confidence.
  const moveMagnitude = Math.abs(targetReturn);
  const uncertaintyFraction = (1 - confidence) * Math.max(moveMagnitude, 0.005);
  const bandHalfAtHorizon = lastClose * uncertaintyFraction;

  // Generate one point per trading day in the horizon
  for (let i = 1; i <= horizonDays; i++) {
    const frac = i / horizonDays;
    const projectedPrice = r2(lastClose + (targetPrice - lastClose) * frac);

    // Band widens linearly from 0 at today to full width at horizon
    const bandHalf = r2(bandHalfAtHorizon * frac);

    const date = addTradingDays(todayDate, i);
    points.push({
      date,
      close: null,
      projected: projectedPrice,
      bandLow: r2(projectedPrice - bandHalf),
      bandHigh: r2(projectedPrice + bandHalf),
      isFuture: true,
    });
  }

  return { points, todayDate };
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
function projectionColor(direction: string | undefined): string {
  if (direction === "bullish") return "#4ade80"; // green
  if (direction === "bearish") return "#f87171"; // red
  return "#94a3b8"; // slate/neutral
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0].payload as ChartPoint;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-white">{fmtDate(point.date)}</p>
      {point.close != null && (
        <p className="text-slate-300">Close: <span className="text-white font-medium">${point.close.toFixed(2)}</span></p>
      )}
      {point.projected != null && point.isFuture && (
        <>
          <p className="text-slate-400 mt-0.5">Projected: <span className="text-white font-medium">${point.projected.toFixed(2)}</span></p>
          {point.bandLow != null && point.bandHigh != null && (
            <p className="text-slate-500 mt-0.5">Range: ${point.bandLow.toFixed(2)} – ${point.bandHigh.toFixed(2)}</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------
export default function PriceChart({ data, prediction }: Props) {
  const { points, todayDate } = buildChartData(data, prediction);

  if (points.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center text-sm text-slate-400">
        No price data
      </div>
    );
  }

  const direction = prediction?.predicted_direction;
  const lineColor = projectionColor(direction);
  const bandColor = lineColor;

  // Y-axis domain: cover both historical and projected+band range
  const allValues = points.flatMap((p) =>
    [p.close, p.bandLow, p.bandHigh, p.projected].filter((v): v is number => v != null)
  );
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.08;
  const yDomain: [number, number] = [r2(minVal - padding), r2(maxVal + padding)];

  // Only show a tick every ~20 points so the x-axis doesn't crowd
  const tickInterval = Math.max(1, Math.floor(points.length / 8));

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.12} />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            interval={tickInterval}
            tickFormatter={fmtDate}
          />

          <YAxis
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            width={64}
            domain={yDomain}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Today marker */}
          {todayDate && (
            <ReferenceLine
              x={todayDate}
              stroke="rgba(255,255,255,0.35)"
              strokeDasharray="4 3"
              label={{
                value: "Today",
                position: "insideTopRight",
                fontSize: 10,
                fill: "rgba(255,255,255,0.45)",
                dy: -4,
              }}
            />
          )}

          {/* Confidence band (rendered first so lines sit on top) */}
          <Area
            type="monotone"
            dataKey="bandHigh"
            stroke="none"
            fill={bandColor}
            fillOpacity={0.08}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="bandLow"
            stroke="none"
            fill="#0b1020" // matches page background — clips the band from below
            fillOpacity={1}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
          />

          {/* Historical price line */}
          <Line
            type="monotone"
            dataKey="close"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* Projected central line */}
          <Line
            type="monotone"
            dataKey="projected"
            stroke={lineColor}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      {prediction && (
        <div className="mt-2 flex items-center gap-4 px-1 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded bg-blue-400" />
            Historical
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-5 rounded"
              style={{ background: lineColor, opacity: 0.9 }}
            />
            Projected ({direction})
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-5 rounded"
              style={{ background: lineColor, opacity: 0.15 }}
            />
            Confidence band
          </span>
        </div>
      )}
    </div>
  );
}