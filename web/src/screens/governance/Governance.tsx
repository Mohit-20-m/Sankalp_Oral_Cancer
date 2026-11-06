import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Database, FileCheck2, Cpu, Users, Camera, ArrowRight, AlertTriangle, CheckCircle2, Scale, Waves, Siren, GitBranch, RefreshCw, ExternalLink } from "lucide-react";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { ChartTooltip, CHART } from "@/components/charts/chartKit";
import { useAsync } from "@/hooks";
import { services } from "@/services";
import { formatDate } from "@/utils/format";
import { cn } from "@/utils/cn";

const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 10);
const GROUP_LABEL: Record<string, string> = { sex: "Sex", age_band: "Age", facility: "PHC", device: "Device" };

function LineageNode({ icon: I, title, sub, tone }: { icon: typeof Database; title: string; sub: string; tone: string }) {
  return (
    <div className={cn("flex min-w-[170px] flex-col gap-2 rounded-3xl p-4", tone)}>
      <I className="size-5" />
      <p className="text-sm font-bold">{title}</p>
      <p className="text-xs opacity-70">{sub}</p>
    </div>
  );
}

export default function Governance() {
  const toast = useToast();
  const g = useAsync(() => services.governance.load(), []);
  const [running, setRunning] = useState<"drift" | "fairness" | null>(null);

  async function run(kind: "drift" | "fairness") {
    setRunning(kind);
    try {
      const r = kind === "drift" ? await services.governance.runDrift() : await services.governance.runFairness();
      const msg: Record<string, string> = {
        ok: "Report created",
        insufficient_data: "Not enough new screenings yet (needs 20+ in the last 7 days)",
        no_reviews: "No specialist reviews yet — fairness needs reviewed cases",
        no_benchmark: "The benchmark set is not indexed yet",
        no_model: "No active model",
      };
      toast({ tone: r.status === "ok" ? "success" : "info", title: msg[r.status] ?? r.status });
      g.reload();
    } catch {
      toast({ tone: "error", title: "Could not run the report" });
    } finally {
      setRunning(null);
    }
  }

  if (g.loading && !g.data) return <LoadingSkeleton variant="page" />;
  if (g.error || !g.data) return <StateView state="apiUnavailable" action={<Button variant="secondary" onClick={g.reload}>Retry</Button>} />;
  const d = g.data;
  const latest = d.snapshots[0];
  const driftSeries = d.drift.map((x) => ({ m: formatDate(x.createdAt), "Score distribution (PSI)": x.psiProb, "Image features (PSI)": x.psiEmbedding, "Unusual photos": x.oodRate }));
  const lastDrift = d.drift[d.drift.length - 1];
  const fair = (d.fairness?.groups ?? []).filter((x) => !x.suppressed).map((x) => ({ g: `${GROUP_LABEL[x.group] ?? x.group}: ${x.key}`, sens: pct(x.sensitivity), spec: pct(x.specificity), n: x.n }));
  const suppressed = (d.fairness?.groups ?? []).filter((x) => x.suppressed).length;

  return (
    <Page>
      <PageHeader eyebrow="Clinical lead" title="Governance" description="Data provenance, model monitoring and safety incidents in one place." />
      <Tabs defaultValue="datasets">
        <TabsList className="mb-5">
          <TabsTrigger value="datasets"><Database /> Datasets</TabsTrigger>
          <TabsTrigger value="lineage"><GitBranch /> Lineage</TabsTrigger>
          <TabsTrigger value="drift"><Waves /> Drift</TabsTrigger>
          <TabsTrigger value="fairness"><Scale /> Fairness</TabsTrigger>
          <TabsTrigger value="incidents"><Siren /> Incidents</TabsTrigger>
        </TabsList>

        <TabsContent value="datasets">
          <DashboardCard title="Data sources (datasheets)" subtitle="Where training images came from, their licence and known issues">
            {d.datasets.length === 0 ? (
              <StateView state="empty" compact title="No datasets registered" body="They are imported from the model card when the model is installed." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-mute">
                      <th className="py-3 font-semibold">Source</th>
                      <th className="font-semibold">Images</th>
                      <th className="font-semibold">Licence</th>
                      <th className="font-semibold">Commercial use</th>
                      <th className="font-semibold">Known issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.datasets.map((x) => (
                      <tr key={x.id}>
                        <td className="py-4 font-bold">{x.name}</td>
                        <td className="num">{x.images?.toLocaleString("en-IN") ?? "—"}</td>
                        <td>{x.licence}</td>
                        <td><StatusBadge status={x.commercialUse ? "approved" : "pending"} label={x.commercialUse ? "Allowed" : "Not cleared"} /></td>
                        <td className="max-w-[260px] text-ink-soft">{x.issues ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        </TabsContent>

        <TabsContent value="lineage">
          <DashboardCard title={latest ? `Data lineage — ${latest.usedBy ?? "latest snapshot"}` : "Data lineage"} subtitle="Every retraining freezes its exact training data (hash-addressed snapshot)">
            {!latest ? (
              <StateView state="empty" compact title="No retraining yet" body="Start a retraining from Models — its training snapshot will appear here." />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-3">
                    <LineageNode icon={Camera} title="Reference set" sub={`${(latest.sources.reference ?? 0).toLocaleString("en-IN")} photos from the training set`} tone="bg-sky" />
                    <LineageNode icon={Users} title="Specialist labels" sub={`${(latest.sources.specialist_confirmed ?? 0).toLocaleString("en-IN")} consented, confirmed photos`} tone="bg-lilac" />
                  </div>
                  <ArrowRight className="size-6 text-ink-mute" />
                  <LineageNode icon={FileCheck2} title="Consent filter" sub="Only AI-training consent · withdrawn consent excluded" tone="bg-butter" />
                  <ArrowRight className="size-6 text-ink-mute" />
                  <LineageNode icon={Database} title={`Snapshot ${latest.sha256.slice(0, 8)}`} sub={`${latest.samples.toLocaleString("en-IN")} samples · refer ${latest.labels.refer ?? 0} / no-refer ${latest.labels.no_refer ?? 0}`} tone="bg-mint" />
                  <ArrowRight className="size-6 text-ink-mute" />
                  <LineageNode icon={Cpu} title={latest.usedBy ?? "candidate"} sub="Scored on the fixed benchmark before approval" tone="bg-primary-deep text-white" />
                </div>
                <ul className="mt-6 space-y-2">
                  {d.snapshots.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg p-3 text-sm">
                      <span className="num font-bold">{s.sha256.slice(0, 12)}</span>
                      <span className="text-ink-mute">{formatDate(s.createdAt)}</span>
                      <span>{s.samples.toLocaleString("en-IN")} samples</span>
                      <span className="ml-auto text-ink-soft">{s.usedBy ? `→ ${s.usedBy}` : "not used yet"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DashboardCard>
        </TabsContent>

        <TabsContent value="drift">
          <DashboardCard
            title="Input drift vs. training data"
            subtitle="Population stability index (PSI) on the AI scores and image features · alert at 0.2"
            action={
              <div className="flex items-center gap-2">
                {lastDrift?.alert && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-blush px-3 py-1 text-xs font-bold text-[#A3301F]">
                    <AlertTriangle className="size-3.5" /> Drift alert
                  </span>
                )}
                {lastDrift?.reportUrl && (
                  <a href={lastDrift.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Evidently report <ExternalLink className="size-3" />
                  </a>
                )}
                <Button size="sm" variant="secondary" loading={running === "drift"} onClick={() => run("drift")}><RefreshCw /> Run now</Button>
              </div>
            }
          >
            {driftSeries.length === 0 ? (
              <StateView state="empty" compact title="No drift report yet" body="Runs nightly, or press “Run now” once there are 20+ screenings in the last 7 days." />
            ) : (
              <div className="h-80">
                <ResponsiveContainer>
                  <LineChart data={driftSeries}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="m" axisLine={false} tickLine={false} tick={CHART.tick} />
                    <YAxis axisLine={false} tickLine={false} tick={CHART.tick} width={36} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={0.2} stroke={CHART.series.red} strokeDasharray="6 4" label={{ value: "Alert 0.2", position: "insideTopRight", fill: CHART.series.red, fontSize: 12 }} />
                    <Line dataKey="Score distribution (PSI)" stroke={CHART.series.primary} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line dataKey="Image features (PSI)" stroke={CHART.series.violet} strokeWidth={2.5} strokeDasharray="4 3" dot={false} />
                    <Line dataKey="Unusual photos" stroke={CHART.series.red} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </DashboardCard>
        </TabsContent>

        <TabsContent value="fairness">
          <DashboardCard
            title="Performance across groups"
            subtitle={d.fairness ? `Model ${d.fairness.modelVersion} · ${d.fairness.reviews} specialist-reviewed cases · groups under 5 hidden` : "Sensitivity and specificity by subgroup, from specialist reviews"}
            action={<Button size="sm" variant="secondary" loading={running === "fairness"} onClick={() => run("fairness")}><RefreshCw /> Run now</Button>}
          >
            {fair.length === 0 ? (
              <StateView state="empty" compact title="Not enough reviewed cases yet" body={suppressed ? `${suppressed} group(s) have fewer than 5 cases and are hidden for privacy.` : "Fairness is computed from specialist reviews — run it after cases are reviewed."} />
            ) : (
              <>
                <div className="h-80">
                  <ResponsiveContainer>
                    <BarChart data={fair} barGap={3}>
                      <CartesianGrid vertical={false} stroke={CHART.grid} />
                      <XAxis dataKey="g" axisLine={false} tickLine={false} tick={CHART.tick} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={CHART.tick} width={34} unit="%" />
                      <Tooltip content={<ChartTooltip unit="%" />} cursor={{ fill: "rgba(26,38,32,0.04)" }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="sens" name="Sensitivity" fill={CHART.series.deep} radius={[6, 6, 0, 0]} maxBarSize={20} />
                      <Bar dataKey="spec" name="Specificity" fill={CHART.series.lime} radius={[6, 6, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
                  <CheckCircle2 className="size-4 text-primary" /> {suppressed ? `${suppressed} small group(s) hidden for privacy.` : "All groups shown."}
                </p>
              </>
            )}
          </DashboardCard>
        </TabsContent>

        <TabsContent value="incidents">
          <DashboardCard title="Safety incidents" subtitle="Missed cases, model or data issues, unusual access — reported by staff or raised automatically">
            {d.incidents.length === 0 ? (
              <StateView state="empty" compact title="No incidents" />
            ) : (
              <ul className="space-y-3">
                {d.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-4 rounded-3xl bg-bg p-4">
                    <span className={cn("grid size-11 place-items-center rounded-2xl", i.severity === "high" ? "bg-blush text-[#A3301F]" : i.severity === "medium" ? "bg-butter text-[#8A5A00]" : "bg-sand text-ink-soft")}>
                      <Siren className="size-5" />
                    </span>
                    <div className="min-w-[220px] flex-1">
                      <p className="font-semibold">{i.description}</p>
                      <p className="text-xs text-ink-mute">
                        {i.kind.replace(/_/g, " ")} · severity {i.severity} · {formatDate(i.createdAt)}
                        {i.modelVersion ? ` · model ${i.modelVersion}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={i.status === "open" ? "failed" : i.status === "mitigated" ? "pending" : "approved"} label={i.status[0].toUpperCase() + i.status.slice(1)} />
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
