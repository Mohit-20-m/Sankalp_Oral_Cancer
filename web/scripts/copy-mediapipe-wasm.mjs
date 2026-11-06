// Copies MediaPipe's WebAssembly runtime into public/ so face detection works offline (no CDN).
// Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dst = join(root, "public", "mediapipe", "wasm");

if (!existsSync(src)) {
  console.error(`[mediapipe] ${src} not found — run npm install first`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
if (!existsSync(join(root, "public", "mediapipe", "face_landmarker.task"))) {
  console.error("[mediapipe] public/mediapipe/face_landmarker.task is missing (the face model, committed with the app)");
  process.exit(1);
}
console.log("[mediapipe] wasm runtime copied to public/mediapipe/wasm");
