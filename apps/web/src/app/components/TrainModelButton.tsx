"use client";

import { useState } from "react";

// FIX: The original used NEXT_PUBLIC_ML_BASE_URL pointing directly at the
// ml-service container (http://localhost:8000). That host is only reachable
// inside Docker — the browser cannot connect to it. The train endpoint must be
// called through the Go API, which IS reachable from the browser.
//
// The Go router already has the ML client wired; we just need a proxy route.
// Until that proxy route exists, we call the ML service via the Next.js API
// route below which runs server-side and CAN reach ml-service:8000.
//
// Drop-in approach: call /api/train (a Next.js API route we create) which
// proxies to the internal ML service. No CORS issues, no Docker networking issues.

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Props = {
  symbol?: string;
};

type TrainResult = {
  rows: number;
  train_rows: number;
  test_rows: number;
  accuracy: number;
  labels: string[];
  model_path: string;
};

export default function TrainModelButton({ symbol }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const query = new URLSearchParams();
      if (symbol?.trim()) {
        query.set("symbol", symbol.trim().toUpperCase());
      }
      query.set("horizon_days", "5");

      // Route through the Next.js proxy API route instead of hitting the
      // ML container directly from the browser.
      const res = await fetch(`/api/train?${query.toString()}`, {
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
        const errData = data as { detail?: string; error?: string } | null;
        if (res.status === 401) {
          setStatus("Sign in first to train the model.");
        } else {
          setStatus(
            errData?.detail ??
              errData?.error ??
              `Training failed (${res.status})`
          );
        }
        return;
      }

      const result = data as TrainResult;
      setStatus(
        `Trained. Accuracy ${(result.accuracy * 100).toFixed(1)}% on ${result.test_rows} test rows. Refresh to see updated predictions.`
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
        {loading ? "Training..." : `Train Model${symbol ? ` (${symbol})` : ""}`}
      </button>
      {status ? <p className="text-xs text-slate-400">{status}</p> : null}
    </div>
  );
}