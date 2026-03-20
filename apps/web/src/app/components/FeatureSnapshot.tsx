type FeatureRow = {
  trading_date: string;
  sma_20?: number | null;
  sma_50?: number | null;
  ema_12?: number | null;
  ema_26?: number | null;
  rsi_14?: number | null;
  macd?: number | null;
  momentum_5d?: number | null;
  momentum_20d?: number | null;
  volatility_20d?: number | null;
};

type Props = {
  latest: FeatureRow | null;
};

function formatNumber(value?: number | null, digits = 2) {
  if (value === null || value === undefined) {
    return "—";
  }
  return value.toFixed(digits);
}

export default function FeatureSnapshot({ latest }: Props) {
  if (!latest) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="text-lg font-semibold">Latest Technical Features</h3>
        <p className="mt-4 text-sm text-slate-300">
          No features found yet. Generate features after historical prices are loaded.
        </p>
      </div>
    );
  }

  const items = [
    { label: "Trading Date", value: latest.trading_date },
    { label: "SMA 20", value: formatNumber(latest.sma_20) },
    { label: "SMA 50", value: formatNumber(latest.sma_50) },
    { label: "EMA 12", value: formatNumber(latest.ema_12) },
    { label: "EMA 26", value: formatNumber(latest.ema_26) },
    { label: "RSI 14", value: formatNumber(latest.rsi_14) },
    { label: "MACD", value: formatNumber(latest.macd, 4) },
    { label: "Momentum 5D %", value: formatNumber(latest.momentum_5d, 2) },
    { label: "Momentum 20D %", value: formatNumber(latest.momentum_20d, 2) },
    { label: "Volatility 20D %", value: formatNumber(latest.volatility_20d, 2) },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h3 className="text-lg font-semibold">Latest Technical Features</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-white/10 bg-black/20 p-3"
          >
            <div className="text-xs text-slate-400">{item.label}</div>
            <div className="mt-1 text-base font-medium">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}