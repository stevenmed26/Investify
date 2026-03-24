import TickerList from "./components/TickerList";

type Ticker = {
  id: string; symbol: string; company_name: string;
  exchange: string; sector?: string; is_active: boolean;
};

async function getTickers(): Promise<Ticker[]> {
  try {
    const baseUrl = process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";
    const res = await fetch(`${baseUrl}/api/v1/tickers`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tickers ?? []).filter((t: Ticker) => t.is_active);
  } catch { return []; }
}

export default async function HomePage() {
  const tickers: Ticker[] = await getTickers();
  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Markets</h1>
          <p className="mt-1 text-sm text-slate-400">
            {tickers.length} active tickers · predictions updated daily after market close
          </p>
        </div>
        {tickers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center text-slate-400">
            <p className="text-lg font-medium">No tickers loaded yet</p>
            <p className="mt-2 text-sm">The daily pipeline auto-runs after market close.</p>
          </div>
        ) : (
          <TickerList tickers={tickers} />
        )}
      </div>
    </main>
  );
}