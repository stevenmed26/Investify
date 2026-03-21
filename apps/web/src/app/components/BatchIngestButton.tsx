"use client";

import { useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function BatchIngestButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/admin/ingest/batch/history?days=180&delay_ms=8000`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error ?? "Batch ingest failed");
        return;
      }

      const successCount = Array.isArray(data.results)
        ? data.results.filter((r: { error?: string }) => !r.error).length
        : 0;

      const failCount = Array.isArray(data.results)
        ? data.results.filter((r: { error?: string }) => !!r.error).length
        : 0;

      setStatus(`Batch ingest finished. Success: ${successCount}, Failed: ${failCount}. Check API logs for details.`);
    } catch {
      setStatus("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-2xl font-semibold">Batch Historical Ingest</h2>
      <p className="mt-2 text-sm text-slate-300">
        Ingests historical data for all active tickers using your stored Twelve Data key.
      </p>

      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="mt-5 rounded-xl bg-white px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
      >
        {loading ? "Running batch..." : "Run Batch Ingest"}
      </button>

      {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
    </section>
  );
}