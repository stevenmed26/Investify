"use client";

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type BatchJob = {
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  error?: string;
  result?: {
    results?: { error?: string }[];
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BatchIngestButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/admin/ingest/batch/history?days=365&delay_ms=9000`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 401) {
          setStatus("Sign in first to run historical ingest.");
        } else if (res.status === 403) {
          setStatus("Admin access is required to run batch ingest.");
        } else {
          setStatus(data?.error ?? "Batch ingest failed");
        }
        return;
      }

      const jobId = data?.job_id as string | undefined;
      if (!jobId) {
        setStatus("Batch ingest job could not be started.");
        return;
      }

      setStatus("Historical ingest job queued...");

      while (true) {
        await sleep(1500);

        const pollRes = await fetch(`${API_BASE_URL}/api/v1/admin/jobs/${jobId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const job = (await pollRes.json().catch(() => null)) as BatchJob | null;

        if (!pollRes.ok || !job) {
          setStatus("Could not load batch ingest status.");
          return;
        }

        if (job.status === "queued" || job.status === "running") {
          setStatus(job.message ?? "Historical ingest is running...");
          continue;
        }

        if (job.status === "failed") {
          setStatus(job.error ?? "Batch ingest failed.");
          return;
        }

        const results = job.result?.results ?? [];
        const successCount = results.filter((item) => !item.error).length;
        const failCount = results.filter((item) => item.error).length;
        setStatus(`Batch ingest finished. Success: ${successCount}, Failed: ${failCount}.`);
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
      <h2 className="text-2xl font-semibold">Batch Historical Ingest</h2>
      <p className="mt-2 text-sm text-slate-300">
        Queues a background job to fill missing history for all active tickers.
      </p>

      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="mt-5 rounded-xl bg-white px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
      >
        {loading ? "Starting job..." : "Run Batch Ingest"}
      </button>

      {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
    </section>
  );
}
