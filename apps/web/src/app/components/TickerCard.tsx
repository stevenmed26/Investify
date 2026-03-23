"use client";

import { useEffect, useRef, useState } from "react";
import MiniSparkline from "./MiniSparkline";
import ConfidenceGauge from "./ConfidenceGauge";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
};

type PricePoint = { trading_date: string; close: number };

type Prediction = {
  predicted_direction: "bullish" | "neutral" | "bearish";
  predicted_return_pct: number;
  confidence_score: number;
  recommendation: "buy" | "sell" | "wait";
  model_version: string;
};

type CardData = {
  prices: PricePoint[];
  prediction: Prediction | null;
  latestClose: number | null;
  change1d: number | null;   // % change over last 1 day
  change20d: number | null;  // % change over last 20 days
};

function dirLabel(dir: string | undefined) {
  if (dir === "bullish") return { label: "Bullish", cls: "text-emerald-400" };
  if (dir === "bearish") return { label: "Bearish", cls: "text-red-400" };
  return { label: "Neutral", cls: "text-slate-400" };
}

function recoBadge(rec: string | undefined) {
  if (rec === "buy")  return { label: "BUY",  bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
  if (rec === "sell") return { label: "SELL", bg: "bg-red-500/15 text-red-400 border-red-500/25" };
  return { label: "WAIT", bg: "bg-slate-500/15 text-slate-400 border-slate-500/25" };
}

function pctColor(v: number | null) {
  if (v == null) return "text-slate-500";
  return v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-400";
}

function fmt(v: number | null, decimals = 2): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(decimals) + "%";
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function CardSkeleton({ symbol, company_name, exchange }: Ticker) {
  return (
    <div className="ticker-card ticker-card-skeleton">
      {/* Left */}
      <div className="ticker-left">
        <span className="ticker-symbol">{symbol}</span>
        <span className="ticker-name">{company_name}</span>
        <span className="ticker-exchange">{exchange}</span>
      </div>

      {/* Mid */}
      <div className="ticker-mid">
        <div className="sparkline-skeleton" />
      </div>

      {/* Right */}
      <div className="ticker-right">
        <div className="gauge-skeleton" />
      </div>
    </div>
  );
}

// ─── Loaded card ─────────────────────────────────────────────────────────────
function CardLoaded({
  ticker,
  data,
}: {
  ticker: Ticker;
  data: CardData;
}) {
  const { prediction, latestClose, change1d, change20d } = data;
  const dir = dirLabel(prediction?.predicted_direction);
  const reco = recoBadge(prediction?.recommendation);
  const noModel = prediction?.model_version === "no-data-v0";

  return (
    <a
      href={`/ticker/${ticker.symbol}`}
      className="ticker-card ticker-card-loaded"
    >
      {/* ── Left: identity ── */}
      <div className="ticker-left">
        <span className="ticker-symbol">{ticker.symbol}</span>
        <span className="ticker-name">{ticker.company_name}</span>
        <span className="ticker-exchange">{ticker.exchange}</span>

        {latestClose != null && (
          <span className="ticker-price">${latestClose.toFixed(2)}</span>
        )}

        {/* Change pills */}
        <div className="ticker-changes">
          {change1d != null && (
            <span className={`ticker-change-pill ${pctColor(change1d)}`}>
              1d&nbsp;{fmt(change1d)}
            </span>
          )}
          {change20d != null && (
            <span className={`ticker-change-pill ${pctColor(change20d)}`}>
              20d&nbsp;{fmt(change20d)}
            </span>
          )}
        </div>
      </div>

      {/* ── Mid: sparkline + prediction label ── */}
      <div className="ticker-mid">
        <MiniSparkline
          data={data.prices}
          prediction={noModel ? null : prediction}
          width={260}
          height={68}
        />

        {prediction && !noModel && (
          <div className="ticker-pred-row">
            <span className={`ticker-direction ${dir.cls}`}>{dir.label}</span>
            <span className={`ticker-return ${pctColor(prediction.predicted_return_pct)}`}>
              {fmt(prediction.predicted_return_pct)}&nbsp;projected
            </span>
            <span className={`ticker-reco border ${reco.bg}`}>{reco.label}</span>
          </div>
        )}

        {noModel && (
          <p className="ticker-no-model">No model trained yet</p>
        )}
      </div>

      {/* ── Right: confidence gauge ── */}
      <div className="ticker-right">
        {prediction && !noModel ? (
          <>
            <ConfidenceGauge value={prediction.confidence_score} size={68} />
            <span className="ticker-conf-label">confidence</span>
          </>
        ) : (
          <div className="ticker-no-conf">—</div>
        )}
      </div>
    </a>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function TickerCard({ ticker }: { ticker: Ticker }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<CardData | null>(null);

  // Trigger fetch once card enters viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" } // start loading 200px before entering view
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Fetch data once visible
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    async function load() {
      const [histRes, predRes] = await Promise.allSettled([
        fetch(`${API}/api/v1/tickers/${ticker.symbol}/history?limit=90`, {
          credentials: "include",
        }),
        fetch(`${API}/api/v1/tickers/${ticker.symbol}/prediction?horizon_days=5`, {
          credentials: "include",
        }),
      ]);

      if (cancelled) return;

      const prices: PricePoint[] = [];
      if (histRes.status === "fulfilled" && histRes.value.ok) {
        const d = await histRes.value.json();
        prices.push(...(d.prices ?? []));
      }

      let prediction: Prediction | null = null;
      if (predRes.status === "fulfilled" && predRes.value.ok) {
        prediction = await predRes.value.json();
      }

      const sorted = [...prices].sort((a, b) =>
        a.trading_date.localeCompare(b.trading_date)
      );
      const latestClose = sorted.length ? sorted[sorted.length - 1].close : null;
      const prev1d = sorted.length > 1 ? sorted[sorted.length - 2].close : null;
      const prev20d = sorted.length > 20 ? sorted[sorted.length - 21].close : null;
      const change1d =
        latestClose != null && prev1d != null
          ? ((latestClose - prev1d) / prev1d) * 100
          : null;
      const change20d =
        latestClose != null && prev20d != null
          ? ((latestClose - prev20d) / prev20d) * 100
          : null;

      setData({ prices: sorted, prediction, latestClose, change1d, change20d });
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [visible, ticker.symbol]);

  return (
    <div ref={ref}>
      {data ? (
        <CardLoaded ticker={ticker} data={data} />
      ) : (
        <CardSkeleton {...ticker} />
      )}
    </div>
  );
}