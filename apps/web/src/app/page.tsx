import BatchBackfillButton from "./components/BatchBackfillButton";
import BatchIngestButton from "./components/BatchIngestButton";
import TickerCard from "./components/TickerCard";
import TickerManager from "./components/TickerManager";

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
  is_active: boolean;
};

async function getTickers(): Promise<Ticker[]> {
  try {
    const baseUrl = process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";
    const res = await fetch(`${baseUrl}/api/v1/tickers`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tickers ?? []).filter((t: Ticker) => t.is_active);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const tickers: Ticker[] = await getTickers();

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Markets</h1>
          <p className="mt-1 text-sm text-slate-400">
            {tickers.length} active ticker{tickers.length !== 1 ? "s" : ""} · live ML predictions
          </p>
        </div>

        {/* Setup / admin section — collapsed by default visually */}
        <details className="mb-6 group">
          <summary className="cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 hover:text-white list-none flex items-center justify-between">
            <span>⚙ Setup &amp; data management</span>
            <span className="text-slate-500 text-xs group-open:hidden">expand</span>
            <span className="text-slate-500 text-xs hidden group-open:inline">collapse</span>
          </summary>
          <div className="mt-3 grid gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-white">Workflow:</strong>{" "}
              Sign in → Add Twelve Data API key → Batch Ingest (365d) → Generate Features → Train Model on any ticker page
            </div>
            <TickerManager />
            <BatchIngestButton />
            <BatchBackfillButton />
          </div>
        </details>

        {/* Ticker list */}
        {tickers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center text-slate-400">
            <p className="text-lg">No tickers yet.</p>
            <p className="mt-2 text-sm">Expand setup above to add tickers.</p>
          </div>
        ) : (
          <div className="ticker-list">
            {tickers.map((ticker) => (
              <TickerCard key={ticker.id} ticker={ticker} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}