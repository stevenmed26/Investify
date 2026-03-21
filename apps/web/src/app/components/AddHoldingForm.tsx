"use client";

import { useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Props = {
  symbol: string;
};

export default function AddHoldingForm({ symbol }: Props) {
  const [sharesOwned, setSharesOwned] = useState("");
  const [averageCostBasis, setAverageCostBasis] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      // FIX: The original sent a hardcoded DEMO_USER_ID in the request body.
      // The API now reads user_id from the JWT cookie (set by login), so we just
      // send credentials: "include" and omit user_id from the payload entirely.
      const payload: {
        symbol: string;
        shares_owned: number;
        average_cost_basis?: number;
      } = {
        symbol,
        shares_owned: Number(sharesOwned),
      };

      if (averageCostBasis.trim() !== "") {
        payload.average_cost_basis = Number(averageCostBasis);
      }

      const res = await fetch(`${API_BASE_URL}/api/v1/holdings/by-symbol`, {
        method: "POST",
        credentials: "include", // sends the investify_token cookie
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        // Surface auth errors clearly so the user knows to sign in first
        if (res.status === 401) {
          setStatus("Sign in first to add holdings.");
        } else {
          setStatus(data.error ?? "Failed to add holding");
        }
        return;
      }

      setStatus(`Holding added for ${symbol}`);
      setSharesOwned("");
      setAverageCostBasis("");
    } catch {
      setStatus("Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-white/10 bg-white/5 p-5"
    >
      <h3 className="text-lg font-semibold">Add Holding</h3>

      <div className="mt-4 grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm text-slate-300">Shares owned</span>
          <input
            type="number"
            min="0"
            step="0.000001"
            value={sharesOwned}
            onChange={(e) => setSharesOwned(e.target.value)}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none"
            placeholder="10"
            required
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm text-slate-300">Average cost basis (optional)</span>
          <input
            type="number"
            min="0"
            step="0.000001"
            value={averageCostBasis}
            onChange={(e) => setAverageCostBasis(e.target.value)}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none"
            placeholder="185.50"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-white px-4 py-2 font-medium text-slate-900 disabled:opacity-50"
        >
          {submitting ? "Adding..." : `Add ${symbol}`}
        </button>

        {status ? <p className="text-sm text-slate-300">{status}</p> : null}
      </div>
    </form>
  );
}