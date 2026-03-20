"use client";

import { useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Props = {
  symbol: string;
};

export default function BackfillFeaturesButton({ symbol }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/admin/features/${symbol}/backfill`,
        { method: "POST" }
      );
      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error ?? "Feature backfill failed");
        return;
      }

      setStatus(`Backfilled ${data.rows_processed} feature rows for ${symbol}. Refresh the page.`);
    } catch {
      setStatus("Request failed");
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
        {loading ? "Generating..." : "Generate Features"}
      </button>
      {status ? <p className="text-xs text-slate-400">{status}</p> : null}
    </div>
  );
}