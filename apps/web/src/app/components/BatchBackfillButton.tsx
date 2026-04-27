"use client";

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type BackfillResult = {
  symbol: string;
  rows_processed?: number;
  error?: string;
};

type BatchJob = {
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  error?: string;
  result?: {
    results?: BackfillResult[];
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BatchBackfillButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/features/batch/backfill`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 401) {
          setStatus("Sign in first to generate features.");
        } else if (res.status === 403) {
          setStatus("Admin access is required to generate features for all tickers.");
        } else {
          setStatus(data?.error ?? "Batch backfill failed");
        }
        return;
      }

      const jobId = data?.job_id as string | undefined;
      if (!jobId) {
        setStatus("Feature backfill job could not be started.");
        return;
      }

      setStatus("Feature backfill job queued...");

      while (true) {
        await sleep(1500);

        const pollRes = await fetch(`${API_BASE_URL}/api/v1/admin/jobs/${jobId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const job = (await pollRes.json().catch(() => null)) as BatchJob | null;

        if (!pollRes.ok || !job) {
          setStatus("Could not load feature job status.");
          return;
        }

        if (job.status === "queued" || job.status === "running") {
          setStatus(job.message ?? "Feature generation is running...");
          continue;
        }

        if (job.status === "failed") {
          setStatus(job.error ?? "Batch backfill failed.");
          return;
        }

        const results = job.result?.results ?? [];
        const successCount = results.filter((r) => !r.error).length;
        const failCount = results.filter((r) => r.error).length;
        const totalRows = results.reduce((sum, r) => sum + (r.rows_processed ?? 0), 0);

        const parts = [`Generated features for ${successCount} ticker(s) - ${totalRows} total rows.`];
        if (failCount > 0) {
          parts.push(`${failCount} failed.`);
        }

        setStatus(parts.join(" "));
        return;
      }
    } catch {
      setStatus("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-2xl font-semibold">Generate Features (All Tickers)</h2>
      <p className="mt-2 text-sm text-slate-300">
        Queues a background job to compute technical indicators for all active tickers.
      </p>

      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="mt-5 rounded-xl bg-white px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
      >
        {loading ? "Starting job..." : "Generate All Features"}
      </button>

      {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
    </section>
  );
}
