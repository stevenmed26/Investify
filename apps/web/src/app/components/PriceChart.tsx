"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type PricePoint = {
  trading_date: string;
  close: number;
};

type Props = {
  data: PricePoint[];
};

export default function PriceChart({ data }: Props) {
  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            dataKey="trading_date"
            tick={{ fontSize: 12 }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            domain={["auto", "auto"]}
            width={64}
          />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="close"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}