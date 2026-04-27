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
  horizon_days: number;
};

type TrainJob = {
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  error?: string;
  result?: TrainResult;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function TrainModelButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    setStatus(null);

    try {
      const startRes = await fetch(`/api/train?horizon_days=5`, {
        method: "POST",
        credentials: "include",
      });

      const startData = await startRes.json().catch(() => null);

      if (!startRes.ok) {
        if (startRes.status === 401) {
          setStatus("Sign in first to train the model.");
        } else if (startRes.status === 403) {
          setStatus("Admin access is required to train the shared model.");
        } else {
          setStatus(startData?.detail ?? startData?.error ?? `Training failed (${startRes.status})`);
        }
        return;
      }

      const jobId = startData?.job_id as string | undefined;
      if (!jobId) {
        setStatus("Training job could not be started.");
        return;
      }

      setStatus("Training job queued...");

      while (true) {
        await sleep(1500);

        const pollRes = await fetch(`/api/train?job_id=${jobId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const job = (await pollRes.json().catch(() => null)) as TrainJob | null;

        if (!pollRes.ok || !job) {
          setStatus("Could not load training status.");
          return;
        }

        if (job.status === "queued" || job.status === "running") {
          setStatus(job.message ?? "Training model...");
          continue;
        }

        if (job.status === "failed") {
          setStatus(job.error ?? "Training failed.");
          return;
        }

        const result = job.result;
        if (!result) {
          setStatus("Training completed, but no result was returned.");
          return;
        }

        const tickerList = result.tickers?.join(", ") ?? "all tickers";
        setStatus(
          `Model trained for ${result.horizon_days}-day horizon on ${tickerList} - ` +
          `${result.rows} rows, ${(result.accuracy * 100).toFixed(1)}% accuracy on ${result.test_rows} test rows. ` +
          `Refresh to see updated predictions.`
        );
        return;
      }
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
