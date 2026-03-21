"use client";

import { useState, useMemo, useEffect } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

// ---------------------------------------------------------------------------
// Curated universe — diversified across sectors for better model training
// ---------------------------------------------------------------------------
type TickerDef = { symbol: string; name: string; exchange: string };
type Sector = { label: string; tickers: TickerDef[] };

const SECTORS: Sector[] = [
  {
    label: "Technology",
    tickers: [
      { symbol: "AAPL",  name: "Apple Inc.",                  exchange: "NASDAQ" },
      { symbol: "MSFT",  name: "Microsoft Corporation",        exchange: "NASDAQ" },
      { symbol: "GOOGL", name: "Alphabet Inc.",                exchange: "NASDAQ" },
      { symbol: "AMZN",  name: "Amazon.com Inc.",              exchange: "NASDAQ" },
      { symbol: "NVDA",  name: "NVIDIA Corporation",           exchange: "NASDAQ" },
      { symbol: "META",  name: "Meta Platforms Inc.",          exchange: "NASDAQ" },
      { symbol: "TSLA",  name: "Tesla Inc.",                   exchange: "NASDAQ" },
      { symbol: "AVGO",  name: "Broadcom Inc.",                exchange: "NASDAQ" },
      { symbol: "ORCL",  name: "Oracle Corporation",           exchange: "NYSE"   },
      { symbol: "CRM",   name: "Salesforce Inc.",              exchange: "NYSE"   },
      { symbol: "AMD",   name: "Advanced Micro Devices Inc.",  exchange: "NASDAQ" },
      { symbol: "INTC",  name: "Intel Corporation",            exchange: "NASDAQ" },
      { symbol: "QCOM",  name: "Qualcomm Inc.",                exchange: "NASDAQ" },
      { symbol: "NOW",   name: "ServiceNow Inc.",              exchange: "NYSE"   },
      { symbol: "ADBE",  name: "Adobe Inc.",                   exchange: "NASDAQ" },
    ],
  },
  {
    label: "Financials",
    tickers: [
      { symbol: "JPM",   name: "JPMorgan Chase & Co.",         exchange: "NYSE"   },
      { symbol: "BAC",   name: "Bank of America Corp.",        exchange: "NYSE"   },
      { symbol: "WFC",   name: "Wells Fargo & Co.",            exchange: "NYSE"   },
      { symbol: "GS",    name: "Goldman Sachs Group Inc.",     exchange: "NYSE"   },
      { symbol: "MS",    name: "Morgan Stanley",               exchange: "NYSE"   },
      { symbol: "BLK",   name: "BlackRock Inc.",               exchange: "NYSE"   },
      { symbol: "V",     name: "Visa Inc.",                    exchange: "NYSE"   },
      { symbol: "MA",    name: "Mastercard Inc.",              exchange: "NYSE"   },
      { symbol: "AXP",   name: "American Express Co.",         exchange: "NYSE"   },
      { symbol: "C",     name: "Citigroup Inc.",               exchange: "NYSE"   },
    ],
  },
  {
    label: "Healthcare",
    tickers: [
      { symbol: "JNJ",   name: "Johnson & Johnson",            exchange: "NYSE"   },
      { symbol: "UNH",   name: "UnitedHealth Group Inc.",      exchange: "NYSE"   },
      { symbol: "LLY",   name: "Eli Lilly and Co.",            exchange: "NYSE"   },
      { symbol: "ABBV",  name: "AbbVie Inc.",                  exchange: "NYSE"   },
      { symbol: "MRK",   name: "Merck & Co. Inc.",             exchange: "NYSE"   },
      { symbol: "PFE",   name: "Pfizer Inc.",                  exchange: "NYSE"   },
      { symbol: "TMO",   name: "Thermo Fisher Scientific Inc.",exchange: "NYSE"   },
      { symbol: "ABT",   name: "Abbott Laboratories",          exchange: "NYSE"   },
      { symbol: "DHR",   name: "Danaher Corporation",          exchange: "NYSE"   },
      { symbol: "AMGN",  name: "Amgen Inc.",                   exchange: "NASDAQ" },
    ],
  },
  {
    label: "Consumer",
    tickers: [
      { symbol: "WMT",   name: "Walmart Inc.",                 exchange: "NYSE"   },
      { symbol: "PG",    name: "Procter & Gamble Co.",         exchange: "NYSE"   },
      { symbol: "KO",    name: "Coca-Cola Co.",                exchange: "NYSE"   },
      { symbol: "PEP",   name: "PepsiCo Inc.",                 exchange: "NASDAQ" },
      { symbol: "COST",  name: "Costco Wholesale Corp.",       exchange: "NASDAQ" },
      { symbol: "MCD",   name: "McDonald's Corporation",       exchange: "NYSE"   },
      { symbol: "NKE",   name: "Nike Inc.",                    exchange: "NYSE"   },
      { symbol: "HD",    name: "Home Depot Inc.",              exchange: "NYSE"   },
      { symbol: "TGT",   name: "Target Corporation",           exchange: "NYSE"   },
      { symbol: "SBUX",  name: "Starbucks Corporation",        exchange: "NASDAQ" },
    ],
  },
  {
    label: "Energy",
    tickers: [
      { symbol: "XOM",   name: "Exxon Mobil Corporation",      exchange: "NYSE"   },
      { symbol: "CVX",   name: "Chevron Corporation",          exchange: "NYSE"   },
      { symbol: "COP",   name: "ConocoPhillips",               exchange: "NYSE"   },
      { symbol: "EOG",   name: "EOG Resources Inc.",           exchange: "NYSE"   },
      { symbol: "SLB",   name: "SLB (Schlumberger)",           exchange: "NYSE"   },
      { symbol: "PSX",   name: "Phillips 66",                  exchange: "NYSE"   },
      { symbol: "MPC",   name: "Marathon Petroleum Corp.",     exchange: "NYSE"   },
      { symbol: "OXY",   name: "Occidental Petroleum Corp.",   exchange: "NYSE"   },
    ],
  },
  {
    label: "Industrials",
    tickers: [
      { symbol: "CAT",   name: "Caterpillar Inc.",             exchange: "NYSE"   },
      { symbol: "DE",    name: "Deere & Company",              exchange: "NYSE"   },
      { symbol: "BA",    name: "Boeing Co.",                   exchange: "NYSE"   },
      { symbol: "HON",   name: "Honeywell International Inc.", exchange: "NASDAQ" },
      { symbol: "UPS",   name: "United Parcel Service Inc.",   exchange: "NYSE"   },
      { symbol: "RTX",   name: "RTX Corporation",              exchange: "NYSE"   },
      { symbol: "LMT",   name: "Lockheed Martin Corporation",  exchange: "NYSE"   },
      { symbol: "GE",    name: "GE Aerospace",                 exchange: "NYSE"   },
    ],
  },
  {
    label: "Communications",
    tickers: [
      { symbol: "NFLX",  name: "Netflix Inc.",                 exchange: "NASDAQ" },
      { symbol: "DIS",   name: "Walt Disney Co.",              exchange: "NYSE"   },
      { symbol: "CMCSA", name: "Comcast Corporation",          exchange: "NASDAQ" },
      { symbol: "T",     name: "AT&T Inc.",                    exchange: "NYSE"   },
      { symbol: "VZ",    name: "Verizon Communications Inc.",  exchange: "NYSE"   },
      { symbol: "TMUS",  name: "T-Mobile US Inc.",             exchange: "NASDAQ" },
      { symbol: "SPOT",  name: "Spotify Technology S.A.",      exchange: "NYSE"   },
    ],
  },
  {
    label: "Real Estate & Utilities",
    tickers: [
      { symbol: "AMT",   name: "American Tower Corporation",   exchange: "NYSE"   },
      { symbol: "PLD",   name: "Prologis Inc.",                exchange: "NYSE"   },
      { symbol: "NEE",   name: "NextEra Energy Inc.",          exchange: "NYSE"   },
      { symbol: "DUK",   name: "Duke Energy Corporation",      exchange: "NYSE"   },
      { symbol: "SO",    name: "Southern Company",             exchange: "NYSE"   },
      { symbol: "D",     name: "Dominion Energy Inc.",         exchange: "NYSE"   },
    ],
  },
];

const ALL_TICKERS: TickerDef[] = SECTORS.flatMap((s) => s.tickers);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type UpsertResult = {
  inserted: number;
  updated: number;
  results: { symbol: string; action?: string; error?: string }[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TickerManager() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [existingSymbols, setExistingSymbols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpsertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load existing tickers so we can show which are already in the DB
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/tickers`)
      .then((r) => r.json())
      .then((d) => {
        const symbols = new Set<string>(
          (d.tickers ?? []).map((t: { symbol: string }) => t.symbol)
        );
        setExistingSymbols(symbols);
      })
      .catch(() => {});
  }, [result]); // Refresh after a successful upsert

  const filteredSectors = useMemo<Sector[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTORS;
    return SECTORS.map((sector) => ({
      ...sector,
      tickers: sector.tickers.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q)
      ),
    })).filter((s) => s.tickers.length > 0);
  }, [search]);

  function toggle(symbol: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  function toggleSector(sector: Sector) {
    const sectorSymbols = sector.tickers.map((t) => t.symbol);
    const allSelected = sectorSymbols.every((s) => selected.has(s));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        sectorSymbols.forEach((s) => next.delete(s));
      } else {
        sectorSymbols.forEach((s) => next.add(s));
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(ALL_TICKERS.map((t) => t.symbol)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const tickers = ALL_TICKERS.filter((t) => selected.has(t.symbol)).map(
      (t) => ({ symbol: t.symbol, company_name: t.name, exchange: t.exchange })
    );

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/tickers/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setError("Sign in first to manage tickers.");
        } else {
          setError(data.error ?? "Failed to add tickers");
        }
        return;
      }

      setResult(data as UpsertResult);
      setSelected(new Set());
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  const newCount = [...selected].filter((s) => !existingSymbols.has(s)).length;
  const updateCount = [...selected].filter((s) => existingSymbols.has(s)).length;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Manage Tickers</h2>
          <p className="mt-1 text-sm text-slate-400">
            {existingSymbols.size} ticker{existingSymbols.size !== 1 ? "s" : ""} currently in database.
            Select tickers to add or re-sync.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-slate-300 hover:bg-black/40"
          >
            All ({ALL_TICKERS.length})
          </button>
          <button
            type="button"
            onClick={selectNone}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-slate-300 hover:bg-black/40"
          >
            None
          </button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by symbol or name…"
        className="mt-4 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/30"
      />

      {/* Sector groups */}
      <div className="mt-5 space-y-5 max-h-[480px] overflow-y-auto pr-1">
        {filteredSectors.map((sector) => {
          const sectorSymbols = sector.tickers.map((t) => t.symbol);
          const allSectorSelected = sectorSymbols.every((s) => selected.has(s));
          const someSectorSelected = sectorSymbols.some((s) => selected.has(s));

          return (
            <div key={sector.label}>
              <button
                type="button"
                onClick={() => toggleSector(sector)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white"
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors ${
                    allSectorSelected
                      ? "border-white/60 bg-white text-slate-900"
                      : someSectorSelected
                      ? "border-white/40 bg-white/20 text-white"
                      : "border-white/20 bg-transparent"
                  }`}
                >
                  {allSectorSelected ? "✓" : someSectorSelected ? "–" : ""}
                </span>
                {sector.label}
                <span className="font-normal normal-case tracking-normal text-slate-500">
                  ({sector.tickers.length})
                </span>
              </button>

              <div className="mt-2 flex flex-wrap gap-2">
                {sector.tickers.map((t) => {
                  const isSelected = selected.has(t.symbol);
                  const isExisting = existingSymbols.has(t.symbol);

                  return (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => toggle(t.symbol)}
                      title={t.name}
                      className={`relative rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-white/60 bg-white text-slate-900"
                          : "border-white/10 bg-black/20 text-white hover:border-white/30 hover:bg-black/40"
                      }`}
                    >
                      {t.symbol}
                      {isExisting && (
                        <span
                          className={`absolute -right-1 -top-1 h-2 w-2 rounded-full border border-slate-900 ${
                            isSelected ? "bg-emerald-400" : "bg-emerald-600"
                          }`}
                          title="Already in database"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer action */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
        <p className="text-sm text-slate-400">
          {selected.size === 0 ? (
            "No tickers selected"
          ) : (
            <>
              <span className="font-semibold text-white">{selected.size}</span> selected
              {newCount > 0 && (
                <> — <span className="text-emerald-400">{newCount} new</span></>
              )}
              {updateCount > 0 && (
                <> · <span className="text-sky-400">{updateCount} re-sync</span></>
              )}
            </>
          )}
        </p>

        <button
          type="button"
          onClick={handleAdd}
          disabled={loading || selected.size === 0}
          className="rounded-xl bg-white px-5 py-2.5 font-medium text-slate-900 disabled:opacity-50"
        >
          {loading
            ? "Adding…"
            : selected.size === 0
            ? "Select tickers to add"
            : `Add ${selected.size} ticker${selected.size !== 1 ? "s" : ""}`}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-medium text-white">
            Done —{" "}
            <span className="text-emerald-400">{result.inserted} added</span>
            {result.updated > 0 && (
              <>, <span className="text-sky-400">{result.updated} updated</span></>
            )}
          </p>
          {result.results.some((r) => r.error) && (
            <ul className="mt-2 space-y-1 text-slate-400">
              {result.results
                .filter((r) => r.error)
                .map((r) => (
                  <li key={r.symbol}>
                    {r.symbol}: {r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
          Already in database
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded border border-white/60 bg-white" />
          Selected
        </span>
      </div>
    </section>
  );
}