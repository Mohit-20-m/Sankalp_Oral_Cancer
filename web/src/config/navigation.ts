import {
  LayoutDashboard,
  ScanFace,
  Users,
  ClipboardList,
  BarChart3,
  QrCode,
  Stethoscope,
  Map,
  Cpu,
  SlidersHorizontal,
  ShieldCheck,
  Activity,
  ScrollText,
  MessageSquareText,
  Bell,
  Settings,
  Layers,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/types";

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
  section: "work" | "insight" | "system";
}

const ALL: Role[] = ["asha", "nurse", "specialist", "local_doctor", "district_officer", "clinical_lead", "admin"];
const SCREENERS: Role[] = ["asha", "nurse"];

/**
 * Role-based navigation. This only shapes the UI — the backend permission
 * system stays authoritative (routes are also guarded in src/navigation/guards.tsx).
 * To add a screen: add a route in src/navigation/routes.tsx and an entry here.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.home", icon: LayoutDashboard, roles: ALL, section: "work" },
  { to: "/screening/new", labelKey: "nav.newScreening", icon: ScanFace, roles: SCREENERS, section: "work" },
  { to: "/patients", labelKey: "nav.patients", icon: Users, roles: [...SCREENERS, "specialist"], section: "work" },
  { to: "/specialist/queue", labelKey: "nav.queue", icon: ClipboardList, roles: ["specialist"], section: "work" },
  { to: "/specialist/stats", labelKey: "nav.myStats", icon: BarChart3, roles: ["specialist"], section: "insight" },
  { to: "/referrals", labelKey: "nav.referralDesk", icon: QrCode, roles: ["nurse", "specialist"], section: "work" },
  { to: "/connect", labelKey: "nav.providerConnect", icon: Stethoscope, roles: ["local_doctor"], section: "work" },
  { to: "/district", labelKey: "nav.district", icon: Map, roles: ["district_officer", "clinical_lead"], section: "insight" },
  { to: "/lead/models", labelKey: "nav.models", icon: Cpu, roles: ["clinical_lead"], section: "insight" },
  { to: "/lead/rules", labelKey: "nav.rules", icon: SlidersHorizontal, roles: ["clinical_lead"], section: "insight" },
  { to: "/lead/governance", labelKey: "nav.governance", icon: ShieldCheck, roles: ["clinical_lead"], section: "insight" },
  { to: "/admin/health", labelKey: "nav.health", icon: Activity, roles: ["admin"], section: "system" },
  { to: "/admin/audit", labelKey: "nav.audit", icon: ScrollText, roles: ["admin"], section: "system" },
  { to: "/admin/messages", labelKey: "nav.messages", icon: MessageSquareText, roles: ["admin"], section: "system" },
  { to: "/notifications", labelKey: "nav.notifications", icon: Bell, roles: ALL, section: "system" },
  { to: "/states", labelKey: "nav.states", icon: Layers, roles: ALL, section: "system" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, roles: ALL, section: "system" },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

/** Route prefix → roles allowed. Used by the route guard. */
export const ROUTE_ACCESS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/screening", roles: SCREENERS },
  { prefix: "/patients", roles: [...SCREENERS, "specialist"] },
  { prefix: "/specialist", roles: ["specialist"] },
  { prefix: "/referrals", roles: ["nurse", "specialist"] },
  { prefix: "/district", roles: ["district_officer", "clinical_lead"] },
  { prefix: "/lead", roles: ["clinical_lead"] },
  { prefix: "/admin", roles: ["admin"] },
];

export function canAccess(role: Role, path: string): boolean {
  const rule = ROUTE_ACCESS.find((r) => path.startsWith(r.prefix));
  return rule ? rule.roles.includes(role) : true;
}
