"use client";

import { useState } from "react";

const ML_BASE_URL =
  process.env.NEXT_PUBLIC_ML_BASE_URL ?? "http://localhost:8000";

type Props = {
  symbol?: string;
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

      const res = await fetch(`${ML_BASE_URL}/train?${query.toString()}`, {
        method: "POST",
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setStatus(
          data?.detail ??
            data?.error ??
            `Training failed with status ${res.status}`
        );
        return;
      }

      setStatus(
        `Trained model. Accuracy ${(data.accuracy * 100).toFixed(1)}% on ${data.test_rows} test rows. Refresh the page.`
      );
    } catch (err) {
      console.error(err);
      setStatus("Training request failed. Check browser console for CORS/network details.");
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