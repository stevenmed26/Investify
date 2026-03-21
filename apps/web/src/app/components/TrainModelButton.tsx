"use client";

import { useState } from "react";

type TrainResult = {
  rows: number;
  train_rows: number;
  test_rows: number;
  accuracy: number;
  labels: string[];
  tickers: string[];
  model_path: string;
};

export default function TrainModelButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      // Always train on ALL tickers — the symbol param has been removed.
      // A model trained on one ticker has ~100 rows and no generalizable signal.
      // The shared model learns technical patterns across all stocks and is then
      // applied per-symbol at prediction time.
      const res = await fetch(`/api/train?horizon_days=5`, {
        method: "POST",
        credentials: "include",
      });

      let data: TrainResult | { detail?: string; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const err = data as { detail?: string; error?: string } | null;
        if (res.status === 401) {
          setStatus("Sign in first to train the model.");
        } else {
          setStatus(err?.detail ?? err?.error ?? `Training failed (${res.status})`);
        }
        return;
      }

      const result = data as TrainResult;
      const tickerList = result.tickers?.join(", ") ?? "all tickers";
      setStatus(
        `Model trained on ${tickerList} — ` +
        `${result.rows} rows, ` +
        `${(result.accuracy * 100).toFixed(1)}% accuracy on ${result.test_rows} test rows. ` +
        `Refresh to see updated predictions.`
      );
    } catch (err) {
      console.error(err);
      setStatus("Training request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm disabled:opacity-50"
      >
        {loading ? "Training..." : "Train Model (All Tickers)"}
      </button>
      {status ? <p className="text-xs text-slate-400">{status}</p> : null}
    </div>
  );
}