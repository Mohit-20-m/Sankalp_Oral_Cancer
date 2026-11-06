import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/navigation/AppShell";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/store/auth";
import { canAccess } from "@/config/navigation";

/* Every screen is lazy-loaded → small initial bundle, code-split per module.
   To add a screen: create it under src/screens, add a lazy import + <Route>,
   then add a nav entry in src/config/navigation.ts. */
const Login = lazy(() => import("@/screens/auth/Login"));
const Home = lazy(() => import("@/screens/dashboard/Home"));
const NewScreening = lazy(() => import("@/screens/screening/NewScreening"));
const PatientList = lazy(() => import("@/screens/patients/PatientList"));
const PatientProfile = lazy(() => import("@/screens/patients/PatientProfile"));
const Queue = lazy(() => import("@/screens/specialist/Queue"));
const CaseView = lazy(() => import("@/screens/specialist/CaseView"));
const MyStats = lazy(() => import("@/screens/specialist/MyStats"));
const ReferralDesk = lazy(() => import("@/screens/referrals/ReferralDesk"));
const ProviderConnect = lazy(() => import("@/screens/provider/ProviderConnect"));
const MobileCapture = lazy(() => import("@/screens/capture/MobileCapture"));
const District = lazy(() => import("@/screens/analytics/District"));
const Models = lazy(() => import("@/screens/governance/Models"));
const Rules = lazy(() => import("@/screens/governance/Rules"));
const Governance = lazy(() => import("@/screens/governance/Governance"));
const SystemHealth = lazy(() => import("@/screens/admin/SystemHealth"));
const AuditLog = lazy(() => import("@/screens/admin/AuditLog"));
const Messages = lazy(() => import("@/screens/admin/Messages"));
const Notifications = lazy(() => import("@/screens/settings/Notifications"));
const Settings = lazy(() => import("@/screens/settings/Settings"));
const States = lazy(() => import("@/screens/settings/States"));

function Fallback() {
  return (
    <div className="p-2">
      <LoadingSkeleton variant="page" />
    </div>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!canAccess(user.role, loc.pathname))
    return (
      <StateView
        state="permissionDenied"
        action={
          <Button variant="secondary" onClick={() => history.back()}>
            Go back
          </Button>
        }
      />
    );
  return <>{children}</>;
}

export function AppRoutes() {
  const loc = useLocation();
  const { user } = useAuth();
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingSkeleton variant="list" rows={3} /></div>}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        {/* Public pages — no conventional login */}
        <Route path="/capture/:sessionId" element={<MobileCapture />} />
        <Route path="/connect" element={<ProviderConnect />} />

        <Route
          path="/*"
          element={
            <Guard>
              <AppShell>
                <AnimatePresence mode="wait" initial={false}>
                  <Suspense fallback={<Fallback />} key={loc.pathname.split("/").slice(0, 3).join("/")}>
                    <Routes location={loc}>
                      <Route index element={<Home />} />
                      <Route path="screening/new" element={<NewScreening />} />
                      <Route path="patients" element={<PatientList />} />
                      <Route path="patients/:id" element={<PatientProfile />} />
                      <Route path="specialist/queue" element={<Queue />} />
                      <Route path="specialist/case/:id" element={<CaseView />} />
                      <Route path="specialist/stats" element={<MyStats />} />
                      <Route path="referrals" element={<ReferralDesk />} />
                      <Route path="district" element={<District />} />
                      <Route path="lead/models" element={<Models />} />
                      <Route path="lead/rules" element={<Rules />} />
                      <Route path="lead/governance" element={<Governance />} />
                      <Route path="admin/health" element={<SystemHealth />} />
                      <Route path="admin/audit" element={<AuditLog />} />
                      <Route path="admin/messages" element={<Messages />} />
                      <Route path="notifications" element={<Notifications />} />
                      <Route path="settings" element={<Settings />} />
                      <Route path="states" element={<States />} />
                      <Route path="*" element={<StateView state="noResults" title="Page not found" body="This address doesn't match any screen." />} />
                    </Routes>
                  </Suspense>
                </AnimatePresence>
              </AppShell>
            </Guard>
          }
        />
      </Routes>
    </Suspense>
  );
}
