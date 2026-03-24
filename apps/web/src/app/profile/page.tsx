"use client";

import "./profile.css";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
  TooltipProps,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type User   = { id: string; email: string };
type Holding = {
  id: string; symbol: string; company_name: string;
  shares_owned: number; average_cost_basis: number | null;
};
type PriceBar = {
  trading_date: string; open: number; high: number;
  low: number; close: number; volume: number;
};
type Prediction = {
  predicted_direction: "bullish" | "neutral" | "bearish";
  predicted_return_pct: number; confidence_score: number;
  recommendation: "buy" | "sell" | "wait"; model_version: string;
};
type HoldingDetail = {
  holding: Holding;
  prices: PriceBar[];
  prediction: Prediction | null;
  latestClose: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
async function get(path: string) {
  const r = await fetch(`${API}${path}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error("Request failed");
  return r.json();
}
async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Failed");
  return d;
}
async function del(path: string) {
  const r = await fetch(`${API}${path}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error("Delete failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtMoney(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);
}
function fmtPct(v: number, withSign = true) {
  return (withSign && v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function addTradingDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
function pnlColor(v: number) { return v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#94a3b8"; }
function dirColor(d?: string) {
  if (d === "bullish") return "#4ade80"; if (d === "bearish") return "#f87171"; return "#94a3b8";
}

// ─────────────────────────────────────────────────────────────────────────────
// Position chart — cost basis reference + price history + ML projection
// ─────────────────────────────────────────────────────────────────────────────
type ChartPoint = {
  date: string; close?: number | null; projected?: number | null;
  bandHigh?: number | null; bandLow?: number | null; isFuture?: boolean;
};

function buildChartData(prices: PriceBar[], prediction: Prediction | null, costBasis: number | null) {
  if (!prices.length) return { points: [] as ChartPoint[], todayDate: "" };

  const sorted = [...prices].sort((a, b) => a.trading_date.localeCompare(b.trading_date));
  const last = sorted[sorted.length - 1];
  const lastClose = last.close;
  const todayDate = last.trading_date;

  const points: ChartPoint[] = sorted.map((p, i) => ({
    date: p.trading_date,
    close: p.close,
    projected: i === sorted.length - 1 ? lastClose : null,
    bandHigh: null, bandLow: null,
    isFuture: false,
  }));

  if (prediction) {
    const horizon = 5;
    const target = lastClose * (1 + prediction.predicted_return_pct / 100);
    const conf = Math.max(0.05, Math.min(0.99, prediction.confidence_score));
    const bandHalf = lastClose * (1 - conf) * Math.max(Math.abs(prediction.predicted_return_pct / 100), 0.005);

    for (let i = 1; i <= horizon; i++) {
      const frac = i / horizon;
      const proj = lastClose + (target - lastClose) * frac;
      points.push({
        date: addTradingDays(todayDate, i),
        close: null,
        projected: proj,
        bandHigh: proj + bandHalf * frac,
        bandLow: proj - bandHalf * frac,
        isFuture: true,
      });
    }
  }

  return { points, todayDate };
}

function PositionChart({ detail }: { detail: HoldingDetail }) {
  const { holding, prices, prediction } = detail;
  const costBasis = holding.average_cost_basis;
  const { points, todayDate } = buildChartData(prices, prediction, costBasis);

  if (!points.length) return (
    <div className="pf-chart-empty">No price history — seed data first</div>
  );

  const allY = points.flatMap(p =>
    [p.close, p.projected, p.bandHigh, p.bandLow, costBasis].filter((v): v is number => v != null)
  );
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const pad  = (maxY - minY) * 0.1;
  const dom: [number, number] = [Math.floor(minY - pad), Math.ceil(maxY + pad)];

  const dir   = prediction?.predicted_direction;
  const color = dirColor(dir);

  const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as ChartPoint;
    return (
      <div className="pf-tooltip">
        <div className="pf-tooltip-date">{fmtDate(p.date)}</div>
        {p.close    != null && <div>Close <span>{fmtMoney(p.close)}</span></div>}
        {p.projected != null && p.isFuture && (
          <>
            <div>Projected <span style={{ color }}>{fmtMoney(p.projected)}</span></div>
            {p.bandHigh != null && <div className="pf-tooltip-range">{fmtMoney(p.bandLow!)} – {fmtMoney(p.bandHigh)}</div>}
          </>
        )}
        {costBasis != null && (
          <div>Cost basis <span style={{ color: "#94a3b8" }}>{fmtMoney(costBasis)}</span></div>
        )}
      </div>
    );
  };

  return (
    <div className="pf-chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#4b5563" }} tickLine={false}
            axisLine={false} minTickGap={40} tickFormatter={fmtDate} />
          <YAxis tick={{ fontSize: 10, fill: "#4b5563" }} tickLine={false} axisLine={false}
            width={72} domain={dom} tickFormatter={(v) => `$${v.toFixed(0)}`} />
          <Tooltip content={<CustomTooltip />} />

          {/* Cost basis reference line */}
          {costBasis != null && (
            <ReferenceLine y={costBasis} stroke="rgba(148,163,184,0.4)"
              strokeDasharray="4 3"
              label={{ value: `Avg cost $${costBasis.toFixed(2)}`, position: "insideTopLeft",
                fontSize: 9, fill: "rgba(148,163,184,0.6)", dy: -4 }} />
          )}

          {/* Today divider */}
          {todayDate && (
            <ReferenceLine x={todayDate} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3"
              label={{ value: "Today", position: "insideTopRight",
                fontSize: 9, fill: "rgba(255,255,255,0.3)", dy: -4 }} />
          )}

          {/* Confidence band */}
          <Area type="monotone" dataKey="bandHigh" stroke="none"
            fill={color} fillOpacity={0.1} isAnimationActive={false} legendType="none" />
          <Area type="monotone" dataKey="bandLow" stroke="none"
            fill="#080d1a" fillOpacity={1} isAnimationActive={false} legendType="none" />

          {/* Historical price */}
          <Line type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={2}
            dot={false} isAnimationActive={false} connectNulls={false} />

          {/* ML projection */}
          <Line type="monotone" dataKey="projected" stroke={color} strokeWidth={2}
            strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Holding row — expanded with chart + stats
// ─────────────────────────────────────────────────────────────────────────────
function HoldingRow({
  detail, onDelete,
}: {
  detail: HoldingDetail; onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { holding, prediction, latestClose } = detail;
  const shares = holding.shares_owned;
  const costBasis = holding.average_cost_basis;
  const currentValue = latestClose != null ? latestClose * shares : null;
  const totalCost    = costBasis != null ? costBasis * shares : null;
  const pnl          = currentValue != null && totalCost != null ? currentValue - totalCost : null;
  const pnlPct       = pnl != null && totalCost && totalCost > 0 ? (pnl / totalCost) * 100 : null;
  const dayChangePct = detail.prices.length >= 2
    ? ((detail.prices[detail.prices.length - 1].close - detail.prices[detail.prices.length - 2].close)
       / detail.prices[detail.prices.length - 2].close) * 100
    : null;

  const dir    = prediction?.predicted_direction;
  const dirCol = dirColor(dir);
  const noData = prediction?.model_version === "no-data-v0";

  return (
    <div className={`pf-holding ${expanded ? "pf-holding-open" : ""}`}>
      {/* Summary row — always visible */}
      <div className="pf-holding-summary" onClick={() => setExpanded(v => !v)}>
        <div className="pf-holding-id">
          <span className="pf-holding-symbol">{holding.symbol}</span>
          <span className="pf-holding-name">{holding.company_name}</span>
        </div>

        <div className="pf-holding-stat">
          <span className="pf-stat-label">Shares</span>
          <span className="pf-stat-value">{shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        </div>

        <div className="pf-holding-stat">
          <span className="pf-stat-label">Price</span>
          <span className="pf-stat-value">{latestClose != null ? fmtMoney(latestClose) : "—"}</span>
          {dayChangePct != null && (
            <span className="pf-stat-sub" style={{ color: pnlColor(dayChangePct) }}>
              {fmtPct(dayChangePct)} today
            </span>
          )}
        </div>

        <div className="pf-holding-stat">
          <span className="pf-stat-label">Mkt Value</span>
          <span className="pf-stat-value">{currentValue != null ? fmtMoney(currentValue) : "—"}</span>
          {totalCost != null && (
            <span className="pf-stat-sub" style={{ color: "#64748b" }}>
              Cost {fmtMoney(totalCost)}
            </span>
          )}
        </div>

        <div className="pf-holding-stat">
          <span className="pf-stat-label">Total P&L</span>
          {pnl != null ? (
            <>
              <span className="pf-stat-value" style={{ color: pnlColor(pnl) }}>
                {pnl >= 0 ? "+" : ""}{fmtMoney(pnl)}
              </span>
              {pnlPct != null && (
                <span className="pf-stat-sub" style={{ color: pnlColor(pnl) }}>
                  {fmtPct(pnlPct)}
                </span>
              )}
            </>
          ) : <span className="pf-stat-value">—</span>}
        </div>

        <div className="pf-holding-stat">
          <span className="pf-stat-label">Outlook</span>
          {prediction && !noData ? (
            <span className="pf-stat-value" style={{ color: dirCol, textTransform: "capitalize" }}>
              {dir}
            </span>
          ) : <span className="pf-stat-value" style={{ color: "#374151" }}>—</span>}
          {prediction && !noData && (
            <span className="pf-stat-sub" style={{ color: dirCol, opacity: 0.8 }}>
              {(prediction.confidence_score * 100).toFixed(0)}% conf
            </span>
          )}
        </div>

        <div className="pf-holding-actions">
          <button className="pf-expand-btn" aria-label={expanded ? "Collapse" : "Expand"}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8}>
              {expanded ? <path d="M2 8L6 4L10 8"/> : <path d="M2 4L6 8L10 4"/>}
            </svg>
          </button>
          <button className="pf-delete-btn" onClick={e => { e.stopPropagation(); onDelete(holding.id); }}
            aria-label={`Remove ${holding.symbol}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M2 2L10 10M10 2L2 10"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="pf-holding-detail">
          <div className="pf-detail-grid">
            {/* Chart + side stats */}
            <div className="pf-chart-col">
              <PositionChart detail={detail} />
              {prediction && !noData && (
                <div className="pf-chart-legend">
                  <span><span className="pf-legend-dot" style={{ background: "#60a5fa" }} />Price history</span>
                  <span><span className="pf-legend-dot" style={{ background: dirCol, opacity: 0.6 }} />ML projection</span>
                  {holding.average_cost_basis && (
                    <span><span className="pf-legend-dash" />Cost basis</span>
                  )}
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="pf-stats-col">
              <div className="pf-stats-section">
                <div className="pf-stats-label">Position</div>
                <div className="pf-stats-row">
                  <span>Shares owned</span>
                  <span>{shares.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                </div>
                <div className="pf-stats-row">
                  <span>Avg cost / share</span>
                  <span>{costBasis != null ? fmtMoney(costBasis) : "—"}</span>
                </div>
                <div className="pf-stats-row">
                  <span>Current price</span>
                  <span>{latestClose != null ? fmtMoney(latestClose) : "—"}</span>
                </div>
                <div className="pf-stats-row pf-stats-row-divider">
                  <span>Amount invested</span>
                  <span className="pf-stats-highlight">{totalCost != null ? fmtMoney(totalCost) : "—"}</span>
                </div>
                <div className="pf-stats-row">
                  <span>Current value</span>
                  <span className="pf-stats-highlight">{currentValue != null ? fmtMoney(currentValue) : "—"}</span>
                </div>
                <div className="pf-stats-row">
                  <span>Gain / Loss $</span>
                  <span style={{ color: pnl != null ? pnlColor(pnl) : "#64748b" }}>
                    {pnl != null ? `${pnl >= 0 ? "+" : ""}${fmtMoney(pnl)}` : "—"}
                  </span>
                </div>
                <div className="pf-stats-row">
                  <span>Gain / Loss %</span>
                  <span style={{ color: pnlPct != null ? pnlColor(pnlPct) : "#64748b" }}>
                    {pnlPct != null ? fmtPct(pnlPct) : "—"}
                  </span>
                </div>
              </div>

              {prediction && !noData && (
                <div className="pf-stats-section pf-stats-section-mt">
                  <div className="pf-stats-label">ML Outlook (5d)</div>
                  <div className="pf-stats-row">
                    <span>Direction</span>
                    <span style={{ color: dirCol, textTransform: "capitalize", fontWeight: 600 }}>{dir}</span>
                  </div>
                  <div className="pf-stats-row">
                    <span>Projected return</span>
                    <span style={{ color: dirCol }}>
                      {fmtPct(prediction.predicted_return_pct)}
                    </span>
                  </div>
                  <div className="pf-stats-row">
                    <span>Confidence</span>
                    <span>{(prediction.confidence_score * 100).toFixed(1)}%</span>
                  </div>
                  <div className="pf-stats-row">
                    <span>Signal</span>
                    <span style={{
                      color: prediction.recommendation === "buy"  ? "#4ade80" :
                             prediction.recommendation === "sell" ? "#f87171" : "#94a3b8",
                      fontWeight: 600, letterSpacing: "0.06em",
                    }}>
                      {prediction.recommendation.toUpperCase()}
                    </span>
                  </div>
                  {latestClose != null && (
                    <div className="pf-stats-row pf-stats-row-divider">
                      <span>Projected value</span>
                      <span style={{ color: dirCol }}>
                        {fmtMoney(latestClose * shares * (1 + prediction.predicted_return_pct / 100))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add holding form
// ─────────────────────────────────────────────────────────────────────────────
function AddHoldingForm({ onAdded }: { onAdded: () => void }) {
  const [sym, setSym]    = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sym || !shares) return;
    setSaving(true); setError("");
    try {
      const payload: Record<string, unknown> = {
        symbol: sym.trim().toUpperCase(),
        shares_owned: Number(shares),
      };
      if (cost.trim()) payload.average_cost_basis = Number(cost);
      await post("/api/v1/holdings/by-symbol", payload);
      setSym(""); setShares(""); setCost("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
    setSaving(false);
  }

  return (
    <form className="pf-add-form" onSubmit={handleSubmit}>
      <div className="pf-add-title">Add / Update Position</div>
      <div className="pf-add-grid">
        <div className="pf-field">
          <label className="pf-field-label">Symbol</label>
          <input className="pf-input" placeholder="AAPL" value={sym}
            onChange={e => setSym(e.target.value.toUpperCase())} required />
        </div>
        <div className="pf-field">
          <label className="pf-field-label">Shares</label>
          <input className="pf-input" type="number" min="0" step="0.0001"
            placeholder="10" value={shares} onChange={e => setShares(e.target.value)} required />
        </div>
        <div className="pf-field pf-field-full">
          <label className="pf-field-label">Avg Purchase Price <span className="pf-optional">(optional)</span></label>
          <input className="pf-input" type="number" min="0" step="0.01"
            placeholder="185.50" value={cost} onChange={e => setCost(e.target.value)} />
        </div>
      </div>
      {error && <p className="pf-error">{error}</p>}
      <button className="pf-submit-btn" type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save Position"}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const [user, setUser]           = useState<User | null>(null);
  const [details, setDetails]     = useState<HoldingDetail[]>([]);
  const [loading, setLoading]     = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const holdingsData = await get("/api/v1/holdings");
      const holdings: Holding[] = holdingsData.holdings ?? [];

      const detailList = await Promise.all(
        holdings.map(async (h): Promise<HoldingDetail> => {
          const [histRes, predRes] = await Promise.allSettled([
            get(`/api/v1/tickers/${h.symbol}/history?limit=90`),
            get(`/api/v1/tickers/${h.symbol}/prediction?horizon_days=5`),
          ]);

          const prices: PriceBar[] =
            histRes.status === "fulfilled" ? (histRes.value.prices ?? []).sort(
              (a: PriceBar, b: PriceBar) => a.trading_date.localeCompare(b.trading_date)
            ) : [];

          const prediction: Prediction | null =
            predRes.status === "fulfilled" ? predRes.value : null;

          const latestClose = prices.length ? prices[prices.length - 1].close : null;

          return { holding: h, prices, prediction, latestClose };
        })
      );

      setDetails(detailList);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    get("/api/v1/auth/me")
      .then(d => { setUser({ id: d.id, email: d.email }); setAuthChecked(true); })
      .catch(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user) loadPortfolio();
    else if (authChecked) setLoading(false);
  }, [user, authChecked, loadPortfolio]);

  async function handleDelete(id: string) {
    await del(`/api/v1/holdings/${id}`);
    setDetails(prev => prev.filter(d => d.holding.id !== id));
  }

  // Portfolio summary stats
  const totalValue    = details.reduce((s, d) => s + (d.latestClose ?? 0) * d.holding.shares_owned, 0);
  const totalCost     = details.reduce((s, d) => {
    const cb = d.holding.average_cost_basis;
    return s + (cb != null ? cb * d.holding.shares_owned : 0);
  }, 0);
  const totalPnL      = totalValue - totalCost;
  const totalPnLPct   = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const dayChange     = details.reduce((s, d) => {
    if (d.prices.length < 2) return s;
    const prev = d.prices[d.prices.length - 2].close;
    const curr = d.prices[d.prices.length - 1].close;
    return s + (curr - prev) * d.holding.shares_owned;
  }, 0);

  const bullCount  = details.filter(d => d.prediction?.predicted_direction === "bullish").length;
  const bearCount  = details.filter(d => d.prediction?.predicted_direction === "bearish").length;

  if (!authChecked) return <div className="pf-loading">Loading…</div>;

  if (!user) return (
    <div className="pf-unauth">
      <p>Sign in to view your portfolio.</p>
      <a href="/" className="pf-back-link">← Back to Markets</a>
    </div>
  );

  return (
    <div className="pf-page">
      {/* Header */}
      <div className="pf-header">
        <div className="pf-header-left">
          <a href="/" className="pf-back">← Markets</a>
          <h1 className="pf-title">Portfolio</h1>
          <p className="pf-subtitle">{user.email}</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="pf-summary-strip">
        <div className="pf-summary-card pf-summary-card-main">
          <div className="pf-summary-label">Total Value</div>
          <div className="pf-summary-big">{fmtMoney(totalValue)}</div>
          <div className="pf-summary-sub" style={{ color: pnlColor(totalPnL) }}>
            {totalPnL >= 0 ? "+" : ""}{fmtMoney(totalPnL)} ({fmtPct(totalPnLPct)}) all-time
          </div>
        </div>
        <div className="pf-summary-card">
          <div className="pf-summary-label">Amount Invested</div>
          <div className="pf-summary-mid">{fmtMoney(totalCost)}</div>
          <div className="pf-summary-sub">{details.length} position{details.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="pf-summary-card">
          <div className="pf-summary-label">Today's Change</div>
          <div className="pf-summary-mid" style={{ color: pnlColor(dayChange) }}>
            {dayChange >= 0 ? "+" : ""}{fmtMoney(dayChange)}
          </div>
          <div className="pf-summary-sub">across all positions</div>
        </div>
        <div className="pf-summary-card">
          <div className="pf-summary-label">ML Signals</div>
          <div className="pf-summary-signals">
            <span className="pf-signal-pill pf-signal-bull">{bullCount} Bullish</span>
            <span className="pf-signal-pill pf-signal-bear">{bearCount} Bearish</span>
          </div>
          <div className="pf-summary-sub">{details.length - bullCount - bearCount} neutral / no data</div>
        </div>
      </div>

      <div className="pf-body">
        {/* Holdings table */}
        <div className="pf-holdings-section">
          <div className="pf-section-header">
            <h2 className="pf-section-title">Positions</h2>
            <span className="pf-section-count">{details.length} holdings</span>
          </div>

          {loading ? (
            <div className="pf-skeleton-list">
              {[1,2,3].map(i => <div key={i} className="pf-skeleton-row" />)}
            </div>
          ) : details.length === 0 ? (
            <div className="pf-empty">
              <p>No positions yet.</p>
              <p className="pf-empty-sub">Add your first holding below to start tracking.</p>
            </div>
          ) : (
            <div className="pf-holdings-list">
              {/* Table header */}
              <div className="pf-table-header">
                <div>Symbol</div>
                <div>Shares</div>
                <div>Price</div>
                <div>Market Value</div>
                <div>Total P&L</div>
                <div>Outlook</div>
                <div></div>
              </div>
              {details.map(d => (
                <HoldingRow key={d.holding.id} detail={d} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>

        {/* Add holding */}
        <AddHoldingForm onAdded={loadPortfolio} />
      </div>
    </div>
  );
}