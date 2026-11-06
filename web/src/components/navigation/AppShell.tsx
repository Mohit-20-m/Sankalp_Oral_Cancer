import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronsLeft, LogOut, Settings as SettingsIcon, UserRound, Wifi, WifiOff, HelpCircle } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { navForRole, type NavItem } from "@/config/navigation";
import { branding } from "@/config/branding";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/i18n";
import { usePreferences, useOnline } from "@/hooks";
import { prefs } from "@/utils/preferences";
import { Tooltip } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { LanguageSelector } from "./LanguageSelector";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { DemoBadge } from "@/components/common/misc";
import { ROLE_LABEL } from "@/mocks/data";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useI18n();
  const loc = useLocation();
  const active = item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      onClick={() => soundManager.play("transition")}
      className={cn(
        "group relative flex h-11 items-center gap-3 rounded-2xl px-3 text-[14.5px] font-medium transition-colors",
        active ? "text-primary-deep" : "text-white/70 hover:bg-white/[0.06] hover:text-white",
        collapsed && "justify-center px-0",
      )}
      aria-current={active ? "page" : undefined}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-2xl bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
      <Icon className="relative size-[19px] shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      {!collapsed && <span className="relative truncate">{t(item.labelKey)}</span>}
    </NavLink>
  );
  return collapsed ? <Tooltip content={t(item.labelKey)}>{link}</Tooltip> : link;
}

function Sidebar() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { sidebarCollapsed: collapsed } = usePreferences();
  if (!user) return null;
  const items = navForRole(user.role);
  const sections: NavItem["section"][] = ["work", "insight", "system"];
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 88 : 264 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="sticky top-3 z-30 m-3 mr-0 flex h-[calc(100vh-24px)] shrink-0 flex-col rounded-4xl bg-primary-deep py-6 text-white"
      aria-label="Main navigation"
    >
      <div className={cn("relative mb-6 flex items-center px-5", collapsed && "justify-center px-0")}>
        <Logo tone="light" collapsed={collapsed} />
        <button
          onClick={() => {
            soundManager.play("click");
            prefs.set("sidebarCollapsed", !collapsed);
          }}
          className="absolute -right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-accent text-primary-deep shadow-soft transition-transform hover:scale-110"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3">
        {sections.map((s) => {
          const list = items.filter((i) => i.section === s);
          if (!list.length) return null;
          return (
            <div key={s} className="mb-5">
              {!collapsed ? <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{t(`nav.section.${s}`)}</p> : <div className="mx-auto mb-2 h-px w-8 bg-white/10" />}
              <div className="flex flex-col gap-0.5">
                {list.map((i) => (
                  <SideLink key={i.to} item={i} collapsed={collapsed} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-4 rounded-3xl bg-white/[0.06] p-4">
            <p className="text-[13px] font-semibold text-white">Need help?</p>
            <p className="mt-0.5 text-xs text-white/55">{branding.supportEmail}</p>
            <p className="mt-3 text-[11px] text-white/35">v{branding.version}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 bg-bg/85 px-8 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", online ? "bg-mint text-primary-deep" : "bg-butter text-[#5A4500]")} role="status">
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {online ? "Online" : "Offline — saving locally"}
        </span>
        <DemoBadge />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <LanguageSelector />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 rounded-full bg-surface py-1.5 pl-1.5 pr-4 shadow-soft transition hover:shadow-lift" aria-label="Account menu">
              <span className="grid size-9 place-items-center rounded-full bg-primary-deep font-display text-sm font-bold text-accent">{user.initials}</span>
              <span className="text-left leading-tight">
                <span className="block text-sm font-semibold text-ink">{user.displayName}</span>
                <span className="block text-[11px] text-ink-mute">{ROLE_LABEL[user.role]}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{user.facility}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => nav("/settings")}>
              <UserRound /> Profile & accessibility
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => nav("/settings")}>
              <SettingsIcon /> {t("nav.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => nav("/states")}>
              <HelpCircle /> {t("nav.states")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await logout();
                nav("/login");
              }}
              className="text-[#A3301F] [&_svg]:text-[#A3301F]"
            >
              <LogOut /> {t("common.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only z-50 rounded-xl bg-primary-deep px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-8 pb-12 pt-2">
          {children}
        </main>
      </div>
    </div>
  );
}
