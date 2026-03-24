"use client";

import { useEffect, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Holding = {
  id: string;
  symbol: string;
  company_name: string;
  shares_owned: number;
  average_cost_basis: number | null;
};

type LatestPrice = { symbol: string; price: number | null };

type User = { id: string; email: string };

async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed");
  return data;
}

async function apiDelete(path: string) {
  const res = await fetch(`${API}${path}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Delete failed");
}

function pnlColor(v: number) {
  return v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#94a3b8";
}

export default function UserProfile({ user }: { user: User | null }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [addSymbol, setAddSymbol] = useState("");
  const [addShares, setAddShares] = useState("");
  const [addCost, setAddCost] = useState("");
  const [addStatus, setAddStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchHoldings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await apiGet("/api/v1/holdings");
      const h: Holding[] = data.holdings ?? [];
      setHoldings(h);

      // Fetch latest price for each holding from history endpoint
      const priceMap: Record<string, number> = {};
      await Promise.allSettled(
        h.map(async (holding) => {
          try {
            const hist = await apiGet(`/api/v1/tickers/${holding.symbol}/history?limit=1`);
            const prices = hist.prices ?? [];
            if (prices.length > 0) {
              priceMap[holding.symbol] = prices[prices.length - 1].close;
            }
          } catch {}
        })
      );
      setPrices(priceMap);
    } catch {}
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  async function handleAdd() {
    const sym = addSymbol.trim().toUpperCase();
    const shares = parseFloat(addShares);
    if (!sym || isNaN(shares) || shares <= 0) {
      setAddStatus({ msg: "Enter a valid symbol and share count.", ok: false });
      return;
    }
    setSaving(true);
    setAddStatus(null);
    try {
      const payload: Record<string, unknown> = { symbol: sym, shares_owned: shares };
      if (addCost.trim()) payload.average_cost_basis = parseFloat(addCost);
      await apiPost("/api/v1/holdings/by-symbol", payload);
      setAddSymbol(""); setAddShares(""); setAddCost("");
      setAddStatus({ msg: `${sym} saved.`, ok: true });
      await fetchHoldings();
    } catch (e: unknown) {
      setAddStatus({ msg: e instanceof Error ? e.message : "Failed to save", ok: false });
    }
    setSaving(false);
  }

  async function handleDelete(id: string, symbol: string) {
    try {
      await apiDelete(`/api/v1/holdings/${id}`);
      setHoldings((prev) => prev.filter((h) => h.id !== id));
    } catch {
      // silent
    }
  }

  if (!user) {
    return (
      <div className="up-card up-muted">
        <p className="up-label">Portfolio</p>
        <p className="up-hint">Sign in to manage your holdings.</p>
      </div>
    );
  }

  // Totals
  const totalValue = holdings.reduce((sum, h) => {
    const price = prices[h.symbol];
    return sum + (price != null ? price * h.shares_owned : 0);
  }, 0);

  const totalCost = holdings.reduce((sum, h) => {
    return sum + (h.average_cost_basis != null ? h.average_cost_basis * h.shares_owned : 0);
  }, 0);

  const totalPnL = totalValue - totalCost;

  return (
    <div className="up-card">
      <div className="up-header-row">
        <p className="up-label">Portfolio</p>
        {holdings.length > 0 && (
          <div className="up-summary">
            <span className="up-total">${totalValue.toFixed(2)}</span>
            {totalCost > 0 && (
              <span style={{ color: pnlColor(totalPnL), fontSize: 11 }}>
                {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Holdings list */}
      {loading ? (
        <p className="up-hint">Loading…</p>
      ) : holdings.length === 0 ? (
        <p className="up-hint">No holdings yet. Add your first position below.</p>
      ) : (
        <div className="up-holdings">
          {holdings.map((h) => {
            const price = prices[h.symbol];
            const value = price != null ? price * h.shares_owned : null;
            const cost = h.average_cost_basis != null ? h.average_cost_basis * h.shares_owned : null;
            const pnl = value != null && cost != null ? value - cost : null;
            const pnlPct = pnl != null && cost && cost > 0 ? (pnl / cost) * 100 : null;

            return (
              <div key={h.id} className="up-holding-row">
                <div className="up-holding-left">
                  <span className="up-holding-symbol">{h.symbol}</span>
                  <span className="up-holding-shares">{h.shares_owned.toFixed(4)} sh</span>
                </div>
                <div className="up-holding-right">
                  {value != null && (
                    <span className="up-holding-value">${value.toFixed(2)}</span>
                  )}
                  {pnlPct != null && (
                    <span style={{ color: pnlColor(pnl!), fontSize: 10 }}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                    </span>
                  )}
                  <button
                    className="up-delete"
                    onClick={() => handleDelete(h.id, h.symbol)}
                    aria-label={`Remove ${h.symbol}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add holding form */}
      <div className="up-add-section">
        <p className="up-add-label">Add / update position</p>
        <input
          className="up-input"
          placeholder="Symbol (e.g. AAPL)"
          value={addSymbol}
          onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
        />
        <div className="up-input-row">
          <input
            className="up-input"
            type="number"
            placeholder="Shares"
            min="0"
            step="0.0001"
            value={addShares}
            onChange={(e) => setAddShares(e.target.value)}
          />
          <input
            className="up-input"
            type="number"
            placeholder="Avg cost (opt)"
            min="0"
            step="0.01"
            value={addCost}
            onChange={(e) => setAddCost(e.target.value)}
          />
        </div>
        {addStatus && (
          <p style={{ fontSize: 11, color: addStatus.ok ? "#4ade80" : "#f87171", margin: 0 }}>
            {addStatus.msg}
          </p>
        )}
        <button className="up-btn" onClick={handleAdd} disabled={saving}>
          {saving ? "Saving…" : "Save position"}
        </button>
      </div>
    </div>
  );
}