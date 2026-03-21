import BatchBackfillButton from "./components/BatchBackfillButton";
import BatchIngestButton from "./components/BatchIngestButton";
import TickerManager from "./components/TickerManager";

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
  is_active: boolean;
};

async function getTickers() {
  try {
    const baseUrl = process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";
    const res = await fetch(`${baseUrl}/api/v1/tickers`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tickers ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const tickers: Ticker[] = await getTickers();

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold">Markets</h1>
        <p className="mt-3 text-lg text-slate-300">
          Historical trend analysis, confidence scoring, and portfolio tracking.
        </p>

        {/* Setup workflow guide */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
            Setup workflow
          </h2>
          <ol className="mt-3 space-y-1 text-sm text-slate-300">
            <li><span className="mr-2 font-semibold text-white">1.</span>Sign in and add your Twelve Data API key via the menu (top right)</li>
            <li><span className="mr-2 font-semibold text-white">2.</span>Add tickers below — more diversified tickers = better model</li>
            <li><span className="mr-2 font-semibold text-white">3.</span>Run <strong>Batch Historical Ingest</strong> to seed 365 days of price data</li>
            <li><span className="mr-2 font-semibold text-white">4.</span>Run <strong>Generate All Features</strong> to compute technical indicators</li>
            <li><span className="mr-2 font-semibold text-white">5.</span>Open any ticker page and click <strong>Train Model (All Tickers)</strong></li>
            <li><span className="mr-2 font-semibold text-white">6.</span>All ticker predictions now use the trained ML model</li>
          </ol>
        </div>

        <div className="mt-6 grid gap-6">
          <TickerManager />
          <BatchIngestButton />
          <BatchBackfillButton />

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-semibold">Active tickers</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tickers.map((ticker) => (
                <a
                  key={ticker.id}
                  href={`/ticker/${ticker.symbol}`}
                  className="rounded-xl border border-white/10 bg-black/20 p-4 transition hover:border-white/30 hover:bg-black/30"
                >
                  <div className="text-xl font-semibold">{ticker.symbol}</div>
                  <div className="mt-1 text-sm text-slate-300">{ticker.company_name}</div>
                  <div className="mt-2 text-xs text-slate-400">{ticker.exchange}</div>
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}