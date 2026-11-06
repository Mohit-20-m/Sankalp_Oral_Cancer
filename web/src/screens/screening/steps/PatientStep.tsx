import { useEffect, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, QrCode, UserPlus, Search } from "lucide-react";
import { useDraft } from "../state";
import { services } from "@/services";
import { useAsync, useDebounced } from "@/hooks";
import { useI18n } from "@/i18n";
import { SearchBar } from "@/components/common/SearchBar";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Tabs, TabsList, TabsTrigger, TabsContent, Input, Label, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { QrScanner } from "@/components/common/QrScanner";
import { ChoiceGroup } from "@/components/forms/ChoiceGroup";
import { useToast } from "@/components/ui/toast";
import type { Language, Sex } from "@/types";
import { formatDate, patientRef } from "@/utils/format";
import { cn } from "@/utils/cn";

function RegisterForm({ onDone }: { onDone: () => void }) {
  const { dispatch } = useDraft();
  const toast = useToast();
  const [f, setF] = useState({ name: "", age: "", sex: "female" as Sex, phone: "", village: "", lang: "kn" as Language });
  const [busy, setBusy] = useState(false);
  const vq = useAsync(() => services.reference.villages(), []);
  const VILLAGES = vq.data ?? [];
  const valid = f.name.trim().length > 2 && Number(f.age) > 0 && Number(f.age) < 120 && /^\d{10}$/.test(f.phone) && f.village;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const v = VILLAGES.find((x) => x.name === f.village)!;
      if (!v) throw new Error("village");
      const p = await services.patients.register({ name: f.name.trim(), age: Number(f.age), sex: f.sex, phone: f.phone, village: v.name, taluk: v.taluk, preferredLanguage: f.lang });
      dispatch({ type: "patient", patient: p });
      toast({ tone: "success", title: "Patient registered", body: `${p.name} · ${patientRef(p)}` });
      onDone();
    } catch (err) {
      toast({ tone: "error", title: "Could not register the patient", body: err instanceof Error ? err.message : "Try again" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-x-5 gap-y-4">
      <div className="col-span-2">
        <Label htmlFor="r-name">Full name</Label>
        <Input id="r-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="As on Aadhaar / ration card" />
      </div>
      <div>
        <Label htmlFor="r-age">Age (years)</Label>
        <Input id="r-age" inputMode="numeric" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, "") })} />
      </div>
      <div>
        <Label>Sex</Label>
        <ChoiceGroup name="sex" value={f.sex} onChange={(v) => setF({ ...f, sex: v })} options={[{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }]} />
      </div>
      <div>
        <Label htmlFor="r-phone">Mobile number</Label>
        <Input id="r-phone" inputMode="tel" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} placeholder="10 digits" />
      </div>
      <div>
        <Label htmlFor="r-village">Village</Label>
        <Select id="r-village" value={f.village} onChange={(e) => setF({ ...f, village: (e.target as unknown as HTMLSelectElement).value })}>
          <option value="">Select village</option>
          {[...new Set(VILLAGES.map((v) => v.taluk))].map((t) => (
            <optgroup key={t} label={t}>
              {VILLAGES.filter((v) => v.taluk === t).map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <div className="col-span-2">
        <Label>Preferred language</Label>
        <ChoiceGroup name="plang" value={f.lang} onChange={(v) => setF({ ...f, lang: v })} options={[{ value: "kn", label: "ಕನ್ನಡ" }, { value: "tcy", label: "ತುಳು" }, { value: "en", label: "English" }]} />
      </div>
      <div className="col-span-2 flex justify-end pt-2">
        <Button type="submit" loading={busy} disabled={!valid} sound="success">
          <UserPlus /> Register & select
        </Button>
      </div>
    </form>
  );
}

export function PatientStep() {
  const { t } = useI18n();
  const { draft, dispatch } = useDraft();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const res = useAsync(() => services.patients.search(dq), [dq]);
  const [tab, setTab] = useState("find");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrError, setQrError] = useState(false);

  useEffect(() => setQrError(false), [qrOpen]);

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="find">
            <Search /> Find patient
          </TabsTrigger>
          <TabsTrigger value="register">
            <UserPlus /> {t("screen.register")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="find">
          <div className="flex gap-3">
            <SearchBar size="lg" value={q} onValueChange={setQ} placeholder={t("common.searchPatients")} className="flex-1" autoFocus />
            <Button variant="secondary" size="lg" onClick={() => setQrOpen(true)}>
              <QrCode /> Scan card
            </Button>
          </div>
          <div className="mt-5">
            {res.loading ? (
              <LoadingSkeleton rows={5} />
            ) : !res.data?.length ? (
              <StateView state="noResults" compact action={<Button variant="soft" onClick={() => setTab("register")}><UserPlus /> Register new patient</Button>} />
            ) : (
              <ul className="scroll-thin grid max-h-[460px] grid-cols-1 gap-2 overflow-y-auto pr-1 xl:grid-cols-2">
                {res.data.slice(0, 20).map((p) => {
                  const sel = draft.patient?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => dispatch({ type: "patient", patient: p })}
                        className={cn("flex w-full items-center gap-3 rounded-3xl p-3 text-left transition-all", sel ? "bg-primary-deep text-white shadow-lift" : "bg-bg hover:bg-secondary/50")}
                        aria-pressed={sel}
                      >
                        <PatientAvatar name={p.name} size={44} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{p.name}</p>
                          <p className={cn("text-xs", sel ? "text-white/60" : "text-ink-mute")}>
                            {patientRef(p)} · {p.age} y · {p.sex[0].toUpperCase()} · {p.village}
                          </p>
                          {p.lastScreeningAt && <p className={cn("mt-0.5 text-[11px]", sel ? "text-white/50" : "text-ink-mute")}>Last screened {formatDate(p.lastScreeningAt)}</p>}
                        </div>
                        {sel ? (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid size-8 place-items-center rounded-full bg-accent text-primary-deep">
                            <Check className="size-4" strokeWidth={3} />
                          </motion.span>
                        ) : (
                          p.lastRisk && <RiskIndicator risk={p.lastRisk} size="sm" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
        <TabsContent value="register">
          <RegisterForm onDone={() => setTab("find")} />
        </TabsContent>
      </Tabs>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent title="Scan patient health card" description="Point the camera at the QR code on the patient's card.">
          <AnimatePresence mode="wait">
            {qrError ? (
              <StateView state="invalidQr" compact action={<Button variant="secondary" onClick={() => setQrError(false)}>Try again</Button>} />
            ) : (
              <QrScanner
                active={qrOpen}
                onResult={async (text) => {
                  const id = text.match(/PT-\d+/)?.[0];
                  if (!id) return setQrError(true);
                  try {
                    const p = await services.patients.get(id);
                    dispatch({ type: "patient", patient: p });
                    setQrOpen(false);
                  } catch {
                    setQrError(true);
                  }
                }}
              />
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </div>
  );
}
