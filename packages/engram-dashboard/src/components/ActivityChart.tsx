import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ActivityPoint } from "../api/types.js";

interface Props { data: ActivityPoint[]; }

export default function ActivityChart({ data }: Props) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--text-faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={d => d.slice(5)} // MM-DD
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--text-faint)" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: 12,
            color: "var(--text-primary)",
          }}
          cursor={{ fill: "var(--bg-hover)" }}
        />
        <Bar dataKey="count" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
