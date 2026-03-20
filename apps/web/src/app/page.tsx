async function getTickers() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
    const res = await fetch(`${baseUrl}/api/v1/tickers`, { cache: "no-store" });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.tickers ?? [];
  } catch {
    return [];
  }
}

type Ticker = {
  id: string;
  symbol: string;
  company_name: string;
  exchange: string;
  is_active: boolean;
};

export default async function HomePage() {
  const tickers: Ticker[] = await getTickers();

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold">Investify</h1>
        <p className="mt-3 text-lg text-slate-300">
          Historical trend analysis, confidence scoring, and portfolio tracking.
        </p>

        <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-semibold">Starter ticker universe</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tickers.map((ticker) => (
              <div
                key={ticker.id}
                className="rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="text-xl font-semibold">{ticker.symbol}</div>
                <div className="mt-1 text-sm text-slate-300">{ticker.company_name}</div>
                <div className="mt-2 text-xs text-slate-400">{ticker.exchange}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}