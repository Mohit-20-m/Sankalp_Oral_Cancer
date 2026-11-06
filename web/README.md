# Arogya - web application

The browser app for ASHA workers, nurses, specialists, clinical leads, district officers and administrators.
React 18, TypeScript, Vite, Tailwind CSS, Radix primitives, Framer Motion, Recharts, Lucide and MediaPipe.

In the full stack it is built into the `web` container and served by nginx behind Traefik (see the repository
[deployment guide](../docs/deployment.md)). It can also run on its own with built-in demo data.

## Run it

```bash
npm ci
npm run dev          # http://localhost:5173 (mock mode by default, see below)
npm run build        # type-check + production build -> dist/
npm run preview      # serve the production build
```

Requires Node 18 or newer. Fonts and the MediaPipe runtime are bundled, so the app works offline.

| `VITE_API_MODE` | Behaviour |
|---|---|
| `mock` (default for `npm run dev`) | Runs entirely in the browser with generated demo data (watermarked sample photos). Any password of 4+ characters works on the role cards. A yellow **Demo data** badge is shown. |
| `http` (default in Docker) | Talks to the Arogya API (`/api/v1`) and Keycloak (`/auth`). Set `DEV_BACKEND_URL` for `npm run dev` against a running stack. |

See [`.env.example`](.env.example) for all settings.

## Screens

| Module | Route | Highlights |
|---|---|---|
| Login | `/login` | Brand hero, English / Kannada / Tulu, demo accounts |
| Home | `/` | Role-specific dashboard |
| New screening | `/screening/new` | Patient, consent (signature, thumbprint or witnessed verbal), habits, symptoms, 7 guided photos, mouth opening, review, result |
| Photo capture | in the wizard | Phone (QR-linked), webcam or upload; live sharpness, light, glare and mouth-tissue checks identical to the server's quality gate |
| Mouth opening | in the wizard | MediaPipe Face Landmarker finds both irises and the inner lips on device; iris = 11.7 mm ruler; drag to adjust, mark by hand as fallback; head-pose warning |
| Result | in the wizard | Risk level, reasons, next steps; retake panel for flagged sites; referral slip with QR; health card |
| Patients | `/patients`, `/patients/:id` | Filters, timeline, referrals, reviews, medicines, follow-ups, photo comparison |
| Specialist | `/specialist/queue`, `/specialist/case/:id`, `/specialist/stats` | Prioritised shared queue, zoomable photos with heat maps, similar confirmed cases, verdict with mandatory reason on disagreement |
| Referral desk | `/referrals` | QR scan or code, book or reschedule an appointment (date and time, patient SMS), visited, completed |
| Provider Connect | `/connect` | Local doctor scans the health card, patient shares a one-time code, time-limited summary |
| District | `/district` | KPIs, trends, referral funnel, village map with small-cell suppression |
| Clinical lead | `/lead/models`, `/lead/rules`, `/lead/governance` | Model lifecycle (shadow, promote, rollback, retrain), maker-checker rule approval, datasets and lineage |
| Admin | `/admin/health`, `/admin/audit`, `/admin/messages` | Service health, failed-job retry, audit chain verification, message log |
| Settings | `/settings` | Language, text size, voice prompts, sound, reduced motion, high contrast |

Routes are guarded by role; the API enforces the same rules again (OPA policies and row-level security).

## Branding

Name, tagline and colours live in [`src/config/branding.ts`](src/config/branding.ts) and are applied as CSS
variables, so every Tailwind colour class follows them. Logo files are in [`public/brand/`](public/brand)
(transparent PNGs; see [`src/assets/brand/README.md`](src/assets/brand/README.md)).

## Project layout

```
src/
├── screens/        one folder per area: auth, dashboard, screening, capture, patients, specialist,
│                   referrals, provider, analytics (district), governance (lead), admin, settings
├── components/     shared UI: screening capture, cards, modals, navigation, brand
├── services/       contracts.ts (the interface) and http/ (real API); demo data lives in src/mocks/
├── utils/          image quality, mouth measurement, face landmarks, formatting
├── config/         branding, theme, navigation, constants (quality thresholds)
└── i18n/           English, Kannada and Tulu strings
scripts/copy-mediapipe-wasm.mjs   copies the MediaPipe WebAssembly runtime into public/ before dev and build
```
