/** Demo governance data (VITE_API_MODE=mock only). Real data comes from /api/v1/governance/*. */
import type { GovernanceData } from "@/services/contracts";

const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

export const GOVERNANCE: GovernanceData = {
  datasets: [
    { id: "d1", name: "zaidpy/oral-cancer-dataset", images: 1001, licence: "verify before commercial use", commercialUse: false },
    { id: "d2", name: "roboflow:oral-dquwv/oralleukoplakia", images: 192, licence: "CC BY 4.0", commercialUse: true },
    { id: "d3", name: "PHC specialist-confirmed labels", images: 418, licence: "consented (DPDP)", commercialUse: true },
  ],
  snapshots: [
    { id: "s2", createdAt: ago(3), samples: 6737, labels: { refer: 3301, no_refer: 3436 }, sources: { reference: 6319, specialist_confirmed: 418 }, usedBy: "1.0.0+head.2", sha256: "9f2c…" },
    { id: "s1", createdAt: ago(40), samples: 6319, labels: { refer: 3080, no_refer: 3239 }, sources: { reference: 6319 }, usedBy: "1.0.0", sha256: "41ab…" },
  ],
  drift: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({
    id: m, createdAt: ago(180 - i * 28), modelVersion: "1.0.0", alert: i === 6,
    psiProb: 0.04 + i * 0.012 + (i === 6 ? 0.1 : 0), psiEmbedding: 0.03 + i * 0.01, oodRate: 0.02 + i * 0.004,
  })),
  fairness: {
    createdAt: ago(2), modelVersion: "1.0.0", reviews: 418,
    groups: [
      { group: "sex", key: "female", n: 171, sensitivity: 0.92, specificity: 0.94, agreement: 0.9 },
      { group: "sex", key: "male", n: 247, sensitivity: 0.91, specificity: 0.95, agreement: 0.89 },
      { group: "age_band", key: "40-59", n: 196, sensitivity: 0.93, specificity: 0.94, agreement: 0.91 },
      { group: "age_band", key: "60+", n: 141, sensitivity: 0.9, specificity: 0.93, agreement: 0.88 },
    ],
  },
  incidents: [
    { id: "INC-031", kind: "model_issue", severity: "high", status: "open", description: "Under-tongue drift exceeded PSI 0.2", createdAt: ago(2) },
    { id: "INC-029", kind: "data_issue", severity: "medium", status: "mitigated", description: "Webcam captures from one PHC consistently under-exposed", createdAt: ago(9) },
  ],
};
