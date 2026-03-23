"use client";

import { useState, useMemo } from "react";
import TickerCard from "./TickerCard";

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
  is_active: boolean;
};

export default function TickerList({ tickers }: { tickers: Ticker[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickers;
    return tickers.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.company_name.toLowerCase().includes(q) ||
        t.exchange.toLowerCase().includes(q)
    );
  }, [query, tickers]);

  return (
    <div>
      {/* Search bar */}
      <div className="ticker-search-wrap">
        <svg
          className="ticker-search-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <line x1="13" y1="13" x2="18" y2="18" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by symbol, company, or exchange…"
          className="ticker-search-input"
          aria-label="Search tickers"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="ticker-search-clear"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Result count */}
      {query && (
        <p className="ticker-search-count">
          {filtered.length === 0
            ? "No tickers match"
            : `${filtered.length} of ${tickers.length} tickers`}
        </p>
      )}

      {/* Cards */}
      {filtered.length > 0 ? (
        <div className="ticker-list">
          {filtered.map((ticker) => (
            <TickerCard key={ticker.id} ticker={ticker} />
          ))}
        </div>
      ) : query ? (
        <div className="ticker-empty">
          <p>No results for &ldquo;{query}&rdquo;</p>
        </div>
      ) : null}
    </div>
  );
}