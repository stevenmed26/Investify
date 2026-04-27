"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type HealthSummary = {
  total: number;
  history_ready: number;
  features_ready: number;
  prediction_ready: number;
  warnings: number;
  missing: number;
};

type TickerHealth = {
  symbol: string;
  company_name: string;
  exchange: string;
  price_rows: number;
  feature_rows: number;
  latest_price?: string;
  latest_feature?: string;
  history_ready: boolean;
  features_ready: boolean;
  prediction_ready: boolean;
  status: "ready" | "warning" | "missing";
  issues: string[];
};

type HealthResponse = {
  summary: HealthSummary;
  tickers: TickerHealth[];
};

function badgeClass(status: TickerHealth["status"]) {
  if (status === "ready") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (status === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return "border-red-500/25 bg-red-500/10 text-red-300";
}

export default function PipelineHealth() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/pipeline/health`, {
        cache: "no-store",
        credentials: "include",
      });

      if (res.status === 401 || res.status === 403) {
        setVisible(false);
        return;
      }
      if (!res.ok) return;

      setData(await res.json());
      setVisible(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const attention = useMemo(() => {
    return (data?.tickers ?? []).filter((ticker) => ticker.status !== "ready").slice(0, 12);
  }, [data]);

  if (!visible) return null;

  const summary = data?.summary;

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Pipeline Health</h2>
          <p className="mt-1 text-sm text-slate-400">
            Data readiness across active tickers.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {summary ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric label="Active" value={summary.total} />
            <Metric label="History Ready" value={summary.history_ready} total={summary.total} />
            <Metric label="Feature Ready" value={summary.features_ready} total={summary.total} />
            <Metric label="Prediction Ready" value={summary.prediction_ready} total={summary.total} />
          </div>

          {attention.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-white/10 text-slate-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Ticker</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Prices</th>
                    <th className="py-2 pr-4 font-medium">Features</th>
                    <th className="py-2 pr-4 font-medium">Latest</th>
                    <th className="py-2 font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {attention.map((ticker) => (
                    <tr key={ticker.symbol} className="text-slate-300">
                      <td className="py-2 pr-4">
                        <a href={`/ticker/${ticker.symbol}`} className="font-mono text-white hover:text-blue-300">
                          {ticker.symbol}
                        </a>
                        <div className="max-w-[180px] truncate text-[11px] text-slate-500">
                          {ticker.company_name}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full border px-2 py-0.5 ${badgeClass(ticker.status)}`}>
                          {ticker.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono">{ticker.price_rows}</td>
                      <td className="py-2 pr-4 font-mono">{ticker.feature_rows}</td>
                      <td className="py-2 pr-4 font-mono text-[11px] text-slate-400">
                        <div>P {ticker.latest_price ?? "-"}</div>
                        <div>F {ticker.latest_feature ?? "-"}</div>
                      </td>
                      <td className="py-2 text-slate-400">
                        {ticker.issues.length ? ticker.issues.join(", ") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              All active tickers are prediction-ready.
            </p>
          )}
        </>
      ) : (
        <p className="mt-5 text-sm text-slate-400">
          {loading ? "Loading pipeline health..." : "Pipeline health unavailable."}
        </p>
      )}
    </section>
  );
}

function Metric({ label, value, total }: { label: string; value: number; total?: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-white">
        {value}
        {total != null ? <span className="text-sm text-slate-500">/{total}</span> : null}
      </p>
    </div>
  );
}
