import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardCheck, Handshake, Timer, CalendarRange } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StatCard } from "@/components/cards/StatCard";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { ChartTooltip, CHART } from "@/components/charts/chartKit";

const PIE = ["#A3301F", "#2F6B4F", "#5340B5", "#8B95A0"];

export default function MyStats() {
  const { data, loading } = useAsync(() => services.specialist.stats(), []);
  if (loading || !data) return <LoadingSkeleton variant="page" />;
  const total = data.byDecision.reduce((a, b) => a + b.value, 0);
  return (
    <Page>
      <PageHeader eyebrow="Specialist console" title="My stats" description="Your review activity and how often you agree with the screening model." />
      <Stagger className="grid grid-cols-12 gap-5">
        <StaggerItem className="col-span-6 xl:col-span-3"><StatCard label="Cases reviewed" value={data.reviewed} icon={ClipboardCheck} tone="deep" footer="all time" /></StaggerItem>
        <StaggerItem className="col-span-6 xl:col-span-3"><StatCard label="AI agreement" value={data.agreementRate * 100} decimals={1} suffix="%" icon={Handshake} tone="lime" /></StaggerItem>
        <StaggerItem className="col-span-6 xl:col-span-3"><StatCard label="Median review time" value={data.medianMinutes} decimals={1} suffix=" min" icon={Timer} tone="sky" /></StaggerItem>
        <StaggerItem className="col-span-6 xl:col-span-3"><StatCard label="This week" value={data.thisWeek} icon={CalendarRange} tone="butter" /></StaggerItem>
        <StaggerItem className="col-span-12 xl:col-span-8">
          <DashboardCard title="Reviews this week" subtitle="Total reviewed vs. agreed with AI">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data.byDay} barGap={4}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={CHART.tick} />
                  <YAxis axisLine={false} tickLine={false} tick={CHART.tick} width={28} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(26,38,32,0.04)" }} />
                  <Bar dataKey="reviewed" name="Reviewed" fill="#16352A" radius={[8, 8, 8, 8]} maxBarSize={22} />
                  <Bar dataKey="agreed" name="Agreed with AI" fill="#D6EC8C" radius={[8, 8, 8, 8]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DashboardCard>
        </StaggerItem>
        <StaggerItem className="col-span-12 xl:col-span-4">
          <DashboardCard title="Decisions" subtitle={`${total} reviews`}>
            <div className="relative h-52">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.byDecision} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={3} cornerRadius={8} stroke="none">
                    {data.byDecision.map((_, i) => (
                      <Cell key={i} fill={PIE[i]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="num text-3xl font-bold">{total}</p>
                  <p className="text-xs text-ink-mute">reviews</p>
                </div>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {data.byDecision.map((d, i) => (
                <li key={d.name} className="flex items-center gap-3 text-sm">
                  <span className="size-3 rounded-sm" style={{ background: PIE[i] }} />
                  <span className="flex-1">{d.name}</span>
                  <span className="num font-bold">{d.value}</span>
                  <span className="num w-12 text-right text-ink-mute">{Math.round((d.value / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </DashboardCard>
        </StaggerItem>
      </Stagger>
    </Page>
  );
}
