"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import TickerCard from "./TickerCard";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Ticker = {
  id: string; symbol: string; company_name: string;
  exchange: string; sector?: string; is_active: boolean;
};
type SortField = "symbol" | "company" | "exchange" | "sector";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "symbol",   label: "Symbol" },
  { value: "company",  label: "Company" },
  { value: "exchange", label: "Exchange" },
  { value: "sector",   label: "Sector" },
];

export default function TickerList({ tickers }: { tickers: Ticker[] }) {
  const [query, setQuery]             = useState("");
  const [sortField, setSortField]     = useState<SortField>("symbol");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [myHoldings, setMyHoldings]   = useState(false);
  const [holdingSymbols, setHoldingSymbols] = useState<Set<string>>(new Set());
  const [loadingHoldings, setLoadingHoldings] = useState(false);

  const fetchHoldings = useCallback(async () => {
    setLoadingHoldings(true);
    try {
      const res = await fetch(`${API}/api/v1/holdings`, { credentials: "include" });
      if (!res.ok) { setMyHoldings(false); return; }
      const data = await res.json();
      setHoldingSymbols(new Set((data.holdings ?? []).map((h: { symbol: string }) => h.symbol)));
    } catch { setMyHoldings(false); }
    finally { setLoadingHoldings(false); }
  }, []);

  useEffect(() => { if (myHoldings) fetchHoldings(); }, [myHoldings, fetchHoldings]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  const processed = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = tickers.filter(t => {
      if (myHoldings && !holdingSymbols.has(t.symbol)) return false;
      if (!q) return true;
      return t.symbol.toLowerCase().includes(q) ||
             t.company_name.toLowerCase().includes(q) ||
             t.exchange.toLowerCase().includes(q) ||
             (t.sector ?? "").toLowerCase().includes(q);
    });
    return [...result].sort((a, b) => {
      const av = sortField === "symbol" ? a.symbol : sortField === "company" ? a.company_name :
                 sortField === "exchange" ? a.exchange : (a.sector ?? "");
      const bv = sortField === "symbol" ? b.symbol : sortField === "company" ? b.company_name :
                 sortField === "exchange" ? b.exchange : (b.sector ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [tickers, query, sortField, sortDir, myHoldings, holdingSymbols]);

  return (
    <div>
      <div className="tl-controls">
        <div className="ticker-search-wrap" style={{ flex: 1, marginBottom: 0 }}>
          <svg className="ticker-search-icon" viewBox="0 0 20 20" fill="none"
            stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <line x1="13" y1="13" x2="18" y2="18" strokeLinecap="round" />
          </svg>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search symbol, company, exchange, sector…"
            className="ticker-search-input" spellCheck={false} autoComplete="off" />
          {query && <button onClick={() => setQuery("")} className="ticker-search-clear">✕</button>}
        </div>
        <button className={`tl-filter-btn ${myHoldings ? "tl-filter-btn-active" : ""}`}
          onClick={() => setMyHoldings(v => !v)} disabled={loadingHoldings}>
          {loadingHoldings ? "…" : "★ My Holdings"}
        </button>
      </div>

      <div className="tl-sort-bar">
        <span className="tl-sort-label">Sort by:</span>
        {SORT_OPTIONS.map(opt => (
          <button key={opt.value}
            className={`tl-sort-btn ${sortField === opt.value ? "tl-sort-btn-active" : ""}`}
            onClick={() => toggleSort(opt.value)}>
            {opt.label}{sortField === opt.value && <span className="tl-sort-arrow">{sortDir === "asc" ? " ↑" : " ↓"}</span>}
          </button>
        ))}
        <span className="tl-count">
          {processed.length < tickers.length ? `${processed.length} of ${tickers.length}` : `${tickers.length} tickers`}
        </span>
      </div>

      {processed.length > 0 ? (
        <div className="ticker-list">
          {processed.map(ticker => (
            <TickerCard key={ticker.id} ticker={ticker} isOwned={holdingSymbols.has(ticker.symbol)} />
          ))}
        </div>
      ) : (
        <div className="ticker-empty">
          {myHoldings && holdingSymbols.size === 0
            ? <p>No holdings yet. Add some via the menu → Portfolio tab.</p>
            : <p>No results for &ldquo;{query}&rdquo;</p>}
        </div>
      )}
    </div>
  );
}