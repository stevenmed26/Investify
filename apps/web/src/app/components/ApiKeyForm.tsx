"use client";

import { useEffect, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type ProviderStatus = {
  provider: string;
  api_key_configured: boolean;
};

export default function ApiKeyForm() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/provider-status`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setProviderStatus(null);
        return;
      }

      const data = await res.json();
      setProviderStatus(data);
    } catch {
      setProviderStatus(null);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/secrets/twelvedata`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ api_key: apiKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error ?? "Failed to store API key");
        return;
      }

      setStatus("API key stored successfully.");
      setApiKey("");
      await loadStatus();
    } catch {
      setStatus("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Market Data Provider</h2>
        <p className="text-sm text-slate-300">
          Store your Twelve Data API key for authenticated historical data ingestion.
        </p>
        {providerStatus ? (
          <div className="mt-2 text-sm text-slate-400">
            <p>Provider: {providerStatus.provider}</p>
            <p>Key configured: {providerStatus.api_key_configured ? "Yes" : "No"}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            Login to manage your provider key.
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter Twelve Data API key"
          className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-white px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save API Key"}
        </button>
      </form>

      {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
    </section>
  );
}