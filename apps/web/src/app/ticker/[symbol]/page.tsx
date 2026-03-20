import AddHoldingForm from "../../components/AddHoldingForm";
import BackfillFeaturesButton from "../../components/BackfillFeaturesButton";
import FeatureSnapshot from "../../components/FeatureSnapshot";
import PriceChart from "../../components/PriceChart";
import SeedHistoryButton from "../../components/SeedHistoryButton";
import TrainModelButton from "../../components/TrainModelButton";
import { notFound } from "next/navigation";

const API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";
const ML_BASE_URL = "http://ml-service:8000";

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
  is_active: boolean;
};

type Prediction = {
  symbol: string;
  predicted_direction: "bullish" | "neutral" | "bearish";
  predicted_return_pct: number;
  confidence_score: number;
  recommendation: "buy" | "sell" | "wait";
  explanation: {
    signals?: string[];
    risk_factors?: string[];
    class_probabilities?: {
      bullish?: number;
      neutral?: number;
      bearish?: number;
    };
  };
  model_version: string;
};

type HistoricalPrice = {
  trading_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: string;
};

type FeatureRow = {
  trading_date: string;
  sma_20?: number | null;
  sma_50?: number | null;
  ema_12?: number | null;
  ema_26?: number | null;
  rsi_14?: number | null;
  macd?: number | null;
  momentum_5d?: number | null;
  momentum_20d?: number | null;
  volatility_20d?: number | null;
};

type CurrentModel = {
  exists: boolean;
  metadata?: {
    version?: string;
    model_type?: string;
    symbol?: string;
  };
  metrics?: {
    accuracy?: number;
    rows?: number;
    train_rows?: number;
    test_rows?: number;
  };
  labels?: string[];
};

async function getTicker(symbol: string): Promise<Ticker | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/tickers/${symbol}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    return await res.json();
  } catch {
    return null;
  }
}

async function getPrediction(symbol: string): Promise<Prediction | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/tickers/${symbol}/prediction?horizon_days=5`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return null;
    }

    return await res.json();
  } catch {
    return null;
  }
}

async function getHistory(symbol: string): Promise<HistoricalPrice[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/tickers/${symbol}/history?limit=180`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.prices ?? [];
  } catch {
    return [];
  }
}

async function getFeatures(symbol: string): Promise<FeatureRow[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/tickers/${symbol}/features?limit=10`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.features ?? [];
  } catch {
    return [];
  }
}

async function getCurrentModel(): Promise<CurrentModel | null> {
  try {
    const res = await fetch(`${ML_BASE_URL}/models/current`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    return await res.json();
  } catch {
    return null;
  }
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatConfidence(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

export default async function TickerDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const normalizedSymbol = symbol.toUpperCase();

  const [ticker, prediction, history, features, currentModel] = await Promise.all([
    getTicker(normalizedSymbol),
    getPrediction(normalizedSymbol),
    getHistory(normalizedSymbol),
    getFeatures(normalizedSymbol),
    getCurrentModel(),
  ]);

  if (!ticker) {
    notFound();
  }

  const latestFeature = features.length > 0 ? features[0] : null;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <a href="/" className="text-sm text-slate-300 hover:text-white">
          ← Back
        </a>

        <div className="mt-6 flex flex-col gap-3">
          <h1 className="text-4xl font-bold">{ticker.symbol}</h1>
          <p className="text-lg text-slate-300">{ticker.company_name}</p>
          <p className="text-sm text-slate-400">{ticker.exchange}</p>
        </div>

        <div className="mt-10 grid gap-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-2xl font-semibold">Historical Price Trend</h2>
              <SeedHistoryButton symbol={ticker.symbol} />
            </div>

            <div className="mt-6">
              {history.length > 0 ? (
                <PriceChart
                  data={history.map((p) => ({
                    trading_date: p.trading_date,
                    close: p.close,
                  }))}
                />
              ) : (
                <p className="text-slate-300">
                  No historical prices found yet. Seed data for this ticker first.
                </p>
              )}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <h2 className="text-2xl font-semibold">Model Outlook</h2>
                <div className="flex flex-wrap items-start gap-3">
                  <BackfillFeaturesButton symbol={ticker.symbol} />
                  <TrainModelButton />
                </div>
              </div>

              {prediction ? (
                <div className="mt-6 grid gap-6">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm text-slate-400">Direction</div>
                      <div className="mt-2 text-2xl font-semibold capitalize">
                        {prediction.predicted_direction}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm text-slate-400">Predicted Return</div>
                      <div className="mt-2 text-2xl font-semibold">
                        {formatPercent(prediction.predicted_return_pct)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm text-slate-400">Confidence</div>
                      <div className="mt-2 text-2xl font-semibold">
                        {formatConfidence(prediction.confidence_score)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm text-slate-400">Recommendation</div>
                    <div className="mt-2 text-2xl font-semibold uppercase">
                      {prediction.recommendation}
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      Model version: {prediction.model_version}
                    </div>
                  </div>

                  {prediction.explanation?.class_probabilities ? (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="text-sm text-slate-400">Bullish Prob.</div>
                        <div className="mt-2 text-xl font-semibold">
                          {formatConfidence(prediction.explanation.class_probabilities.bullish ?? 0)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="text-sm text-slate-400">Neutral Prob.</div>
                        <div className="mt-2 text-xl font-semibold">
                          {formatConfidence(prediction.explanation.class_probabilities.neutral ?? 0)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="text-sm text-slate-400">Bearish Prob.</div>
                        <div className="mt-2 text-xl font-semibold">
                          {formatConfidence(prediction.explanation.class_probabilities.bearish ?? 0)}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <h3 className="text-lg font-semibold">Signals</h3>
                      <ul className="mt-3 space-y-2 text-sm text-slate-300">
                        {(prediction.explanation?.signals ?? []).map((signal) => (
                          <li key={signal}>• {signal}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <h3 className="text-lg font-semibold">Risk Factors</h3>
                      <ul className="mt-3 space-y-2 text-sm text-slate-300">
                        {(prediction.explanation?.risk_factors ?? []).map((risk) => (
                          <li key={risk}>• {risk}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-slate-300">Prediction unavailable.</p>
              )}
            </section>

            <aside className="grid gap-6">
              <AddHoldingForm symbol={ticker.symbol} />
              <FeatureSnapshot latest={latestFeature} />

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="text-lg font-semibold">Current Model</h3>
                {currentModel?.exists ? (
                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <p>Version: {currentModel.metadata?.version}</p>
                    <p>Type: {currentModel.metadata?.model_type}</p>
                    <p>Scope: {currentModel.metadata?.symbol}</p>
                    <p>
                      Accuracy:{" "}
                      {currentModel.metrics?.accuracy !== undefined
                        ? `${(currentModel.metrics.accuracy * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                    <p>Rows: {currentModel.metrics?.rows ?? "—"}</p>
                    <p>Train rows: {currentModel.metrics?.train_rows ?? "—"}</p>
                    <p>Test rows: {currentModel.metrics?.test_rows ?? "—"}</p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-300">
                    No trained model found yet. Seed history, generate features, then train.
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}