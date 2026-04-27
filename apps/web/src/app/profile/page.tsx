"use client";

import { useEffect, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawHolding = {
  id: string;
  symbol: string;
  company_name: string;
  shares_owned: number;
  average_cost_basis: number | null;
};

type Prediction = {
  predicted_direction: "bullish" | "neutral" | "bearish";
  confidence_score: number;
  recommendation: "buy" | "sell" | "wait";
};

type EnrichedHolding = RawHolding & {
  latest_close: number | null;
  market_value: number | null;
  cost_basis_total: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  day_change_pct: number | null;
  prediction: Prediction | null;
};

type PortfolioSummary = {
  total_value: number;
  total_invested: number;
  total_pnl: number;
  total_pnl_pct: number;
  bullish_count: number;
  bearish_count: number;
};

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function enrichHolding(h: RawHolding): Promise<EnrichedHolding> {
  const [histData, predData] = await Promise.allSettled([
    fetchJSON<{ prices: { trading_date: string; close: number }[] }>(
      `/api/v1/tickers/${h.symbol}/history?limit=2`
    ),
    fetchJSON<Prediction>(
      `/api/v1/tickers/${h.symbol}/prediction?horizon_days=5`
    ),
  ]);

  let latest_close: number | null = null;
  let day_change_pct: number | null = null;

  if (histData.status === "fulfilled") {
    const prices = [...(histData.value.prices ?? [])].sort((a, b) =>
      a.trading_date.localeCompare(b.trading_date)
    );
    if (prices.length >= 1) latest_close = prices[prices.length - 1].close;
    if (prices.length >= 2) {
      const prev = prices[prices.length - 2].close;
      if (prev > 0) day_change_pct = ((latest_close! - prev) / prev) * 100;
    }
  }

  const market_value =
    latest_close != null ? h.shares_owned * latest_close : null;
  const cost_basis_total =
    h.average_cost_basis != null
      ? h.shares_owned * h.average_cost_basis
      : null;
  const unrealized_pnl =
    market_value != null && cost_basis_total != null
      ? market_value - cost_basis_total
      : null;
  const unrealized_pnl_pct =
    unrealized_pnl != null && cost_basis_total != null && cost_basis_total > 0
      ? (unrealized_pnl / cost_basis_total) * 100
      : null;

  const prediction =
    predData.status === "fulfilled" ? predData.value : null;

  return {
    ...h,
    latest_close,
    market_value,
    cost_basis_total,
    unrealized_pnl,
    unrealized_pnl_pct,
    day_change_pct,
    prediction,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeSummary(holdings: EnrichedHolding[]): PortfolioSummary {
  let total_value = 0;
  let total_invested = 0;
  let bullish_count = 0;
  let bearish_count = 0;

  for (const h of holdings) {
    if (h.market_value != null) total_value += h.market_value;
    if (h.cost_basis_total != null) total_invested += h.cost_basis_total;
    if (h.prediction?.predicted_direction === "bullish") bullish_count++;
    if (h.prediction?.predicted_direction === "bearish") bearish_count++;
  }

  const total_pnl = total_value - total_invested;
  const total_pnl_pct =
    total_invested > 0 ? (total_pnl / total_invested) * 100 : 0;

  return { total_value, total_invested, total_pnl, total_pnl_pct, bullish_count, bearish_count };
}

function fmtUSD(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtPct(v: number | null, showPlus = true): string {
  if (v == null) return "—";
  const sign = showPlus && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function pnlColor(v: number | null): string {
  if (v == null) return "text-slate-500";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-slate-400";
}

function dirBadge(d: string | undefined) {
  if (d === "bullish") return { label: "Bullish", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
  if (d === "bearish") return { label: "Bearish", cls: "bg-red-500/15 text-red-400 border-red-500/25" };
  return { label: "Neutral", cls: "bg-slate-500/15 text-slate-400 border-slate-500/25" };
}

function recoBadge(r: string | undefined) {
  if (r === "buy")  return { label: "BUY",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
  if (r === "sell") return { label: "SELL", cls: "bg-red-500/15 text-red-400 border-red-500/25" };
  return { label: "WAIT", cls: "bg-slate-500/15 text-slate-400 border-slate-500/25" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, subColor }: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/5 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-bold font-mono text-white">{value || "\u200b"}</p>
      {sub && (
        <p className={`text-sm mt-0.5 font-mono ${subColor ?? "text-slate-400"}`}>{sub}</p>
      )}
    </div>
  );
}

function HoldingRow({ h, onDelete }: { h: EnrichedHolding; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dir = dirBadge(h.prediction?.predicted_direction);
  const reco = recoBadge(h.prediction?.recommendation);

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`${API}/api/v1/holdings/${h.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) onDelete(h.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-white/8 bg-white/5 px-5 py-4 hover:bg-white/8 transition-colors">
      {/* Left: identity + P&L */}
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_1fr_1fr]">
        {/* Identity */}
        <div className="flex flex-col gap-0.5">
          <a
            href={`/ticker/${h.symbol}`}
            className="font-mono text-base font-semibold text-white hover:text-blue-400 transition-colors"
          >
            {h.symbol}
          </a>
          <span className="text-xs text-slate-500 truncate">{h.company_name}</span>
          <span className="text-xs text-slate-600 font-mono">
            {h.shares_owned.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
          </span>
        </div>

        {/* Price + day change */}
        <div className="flex flex-col gap-0.5 justify-center">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Current price</span>
          <span className="font-mono text-sm text-white">{fmtUSD(h.latest_close)}</span>
          {h.day_change_pct != null && (
            <span className={`font-mono text-xs ${pnlColor(h.day_change_pct)}`}>
              {fmtPct(h.day_change_pct)} today
            </span>
          )}
        </div>

        {/* Market value */}
        <div className="flex flex-col gap-0.5 justify-center">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Market value</span>
          <span className="font-mono text-sm text-white">{fmtUSD(h.market_value)}</span>
          {h.average_cost_basis != null && (
            <span className="font-mono text-xs text-slate-500">
              Cost basis {fmtUSD(h.cost_basis_total)}
            </span>
          )}
        </div>

        {/* Unrealized P&L */}
        <div className="flex flex-col gap-0.5 justify-center">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Unrealized P&L</span>
          <span className={`font-mono text-sm font-semibold ${pnlColor(h.unrealized_pnl)}`}>
            {fmtUSD(h.unrealized_pnl)}
          </span>
          <span className={`font-mono text-xs ${pnlColor(h.unrealized_pnl_pct)}`}>
            {fmtPct(h.unrealized_pnl_pct)}
          </span>
          {/* ML signal badges */}
          {h.prediction && (
            <div className="flex gap-1 mt-1">
              <span className={`text-xs border rounded px-1.5 py-0.5 ${dir.cls}`}>{dir.label}</span>
              <span className={`text-xs border rounded px-1.5 py-0.5 ${reco.cls}`}>{reco.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right: delete */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
          confirming
            ? "border-red-500/50 text-red-400 bg-red-500/10 hover:bg-red-500/20"
            : "border-white/10 text-slate-500 hover:text-red-400 hover:border-red-500/30"
        } disabled:opacity-40`}
      >
        {deleting ? "…" : confirming ? "Confirm?" : "Remove"}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<EnrichedHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New position form
  const [formSymbol, setFormSymbol] = useState("");
  const [formShares, setFormShares] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formStatus, setFormStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await fetchJSON<{ id: string; email: string }>("/api/v1/auth/me");
      setUserEmail(me.email);

      const raw = await fetchJSON<{ holdings: RawHolding[] }>("/api/v1/holdings");
      const enriched = await Promise.all((raw.holdings ?? []).map(enrichHolding));
      setHoldings(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHoldings(); }, [loadHoldings]);

  function handleDelete(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }

  async function handleAddPosition(e: React.FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    setFormStatus(null);
    try {
      const payload: Record<string, unknown> = {
        symbol: formSymbol.trim().toUpperCase(),
        shares_owned: Number(formShares),
      };
      if (formCost.trim()) payload.average_cost_basis = Number(formCost);

      const res = await fetch(`${API}/api/v1/holdings/by-symbol`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormStatus({ ok: false, msg: res.status === 401 ? "Sign in first." : (data.error ?? "Failed") });
        return;
      }
      setFormStatus({ ok: true, msg: `${formSymbol.toUpperCase()} saved` });
      setFormSymbol(""); setFormShares(""); setFormCost("");
      await loadHoldings();
    } catch {
      setFormStatus({ ok: false, msg: "Request failed" });
    } finally {
      setFormSaving(false);
    }
  }

  const summary = computeSummary(holdings);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">

        {/* Header */}
        <a href="/" className="text-sm text-slate-400 hover:text-white transition-colors">
          ← Markets
        </a>

        <div className="mt-6 mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Portfolio</h1>
          {userEmail && (
            <p className="mt-1 text-sm text-slate-500">{userEmail}</p>
          )}
        </div>

        {/* Loading / error states */}
        {loading && (
          <div className="flex items-center gap-3 text-slate-400 text-sm py-12 justify-center">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-600 border-t-blue-400 rounded-full" />
            Loading portfolio…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-300 mb-6">
            {error === "401 Unauthorized"
              ? "Sign in via the menu (top right) to see your portfolio."
              : error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
              <SummaryCard
                label="Total value"
                value={fmtUSD(summary.total_value)}
                sub={`${fmtPct(summary.total_pnl_pct)} all-time`}
                subColor={pnlColor(summary.total_pnl_pct)}
              />
              <SummaryCard
                label="Amount invested"
                value={fmtUSD(summary.total_invested)}
                sub={`${holdings.length} position${holdings.length !== 1 ? "s" : ""}`}
              />
              <SummaryCard
                label="Today's change"
                value={(() => {
                  const withDay = holdings.filter((h) => h.day_change_pct != null && h.market_value != null);
                  if (!withDay.length) return "—";
                  const totalDay = withDay.reduce((acc, h) => acc + (h.market_value! * h.day_change_pct! / 100), 0);
                  return fmtUSD(totalDay);
                })()}
                sub="across all positions"
              />
              {/* ML signals card */}
              <div className="rounded-xl border border-white/8 bg-white/5 p-4">
                <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">ML signals</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs border rounded px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                    {summary.bullish_count} Bullish
                  </span>
                  <span className="text-xs border rounded px-2 py-0.5 bg-red-500/15 text-red-400 border-red-500/25">
                    {summary.bearish_count} Bearish
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  {holdings.length - summary.bullish_count - summary.bearish_count} neutral / no data
                </p>
              </div>
            </div>

            {/* Holdings */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Positions</h2>
                <span className="text-sm text-slate-500">{holdings.length} holding{holdings.length !== 1 ? "s" : ""}</span>
              </div>

              {holdings.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/5 p-10 text-center text-slate-500">
                  <p className="text-base">No positions yet.</p>
                  <p className="mt-1 text-sm">Add your first holding below to start tracking.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {holdings.map((h) => (
                    <HoldingRow key={h.id} h={h} onDelete={handleDelete} />
                  ))}
                </div>
              )}
            </section>

            {/* Add / Update Position form */}
            <section className="rounded-2xl border border-white/8 bg-white/5 p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Add / Update Position</h2>
              <p className="text-sm text-slate-500 mb-5">
                Adding a symbol that already exists in your portfolio will update shares and cost basis.
              </p>

              <form onSubmit={handleAddPosition}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400 uppercase tracking-wider">Symbol</span>
                    <input
                      type="text"
                      value={formSymbol}
                      onChange={(e) => setFormSymbol(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                      required
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white font-mono placeholder:text-slate-700 outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-all"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400 uppercase tracking-wider">Shares</span>
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={formShares}
                      onChange={(e) => setFormShares(e.target.value)}
                      placeholder="10"
                      required
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white font-mono placeholder:text-slate-700 outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-all"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400 uppercase tracking-wider">
                      Avg. purchase price <span className="text-slate-600 normal-case">(optional)</span>
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={formCost}
                      onChange={(e) => setFormCost(e.target.value)}
                      placeholder="185.50"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white font-mono placeholder:text-slate-700 outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-all"
                    />
                  </label>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={formSaving}
                    className="rounded-xl bg-white px-5 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                  >
                    {formSaving ? "Saving…" : "Save Position"}
                  </button>
                  {formStatus && (
                    <p className={`text-sm ${formStatus.ok ? "text-emerald-400" : "text-red-400"}`}>
                      {formStatus.msg}
                    </p>
                  )}
                </div>
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
