/**
 * On-device face landmarks (MediaPipe Face Landmarker, 478 points incl. irises) for the mouth-opening measurement.
 * Runs entirely in the browser; the WebAssembly runtime and the model are served by this app from /mediapipe/
 * (see scripts/copy-mediapipe-wasm.mjs), so it also works offline. Loaded lazily the first time it is needed.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { MouthPoints } from "@/types";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker.task";
/** Canonical face-mesh indices: inner edge of the upper lip (centre) and of the lower lip (centre). */
const UPPER_INNER_LIP = 13;
const LOWER_INNER_LIP = 14;

let loading: Promise<{ lm: FaceLandmarker; irisSets: number[][] }> | null = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks(WASM_PATH);
      const lm = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
      // iris boundary points (4 per iris) come from the library's own connection lists — no magic numbers
      const ids = (c: { start: number; end: number }[]) => [...new Set(c.flatMap((x) => [x.start, x.end]))];
      return { lm, irisSets: [ids(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS), ids(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS)] };
    })().catch((e) => {
      loading = null; // allow a retry
      throw e;
    });
  }
  return loading;
}

export interface FaceDetection {
  points: MouthPoints;
  headPose: { yaw: number; pitch: number; roll: number };
}

/** Rotation (degrees) from MediaPipe's 4x4 facial transformation matrix (column-major). */
function headPose(data: number[] | undefined): FaceDetection["headPose"] {
  if (!data || data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const R = (i: number, j: number) => data[j * 4 + i];
  const deg = (r: number) => Number(((r * 180) / Math.PI).toFixed(1));
  return {
    pitch: deg(Math.atan2(R(2, 1), R(2, 2))),
    yaw: deg(Math.atan2(-R(2, 0), Math.hypot(R(2, 1), R(2, 2)))),
    roll: deg(Math.atan2(R(1, 0), R(0, 0))),
  };
}

/**
 * Finds both irises (horizontal edges) and the inner upper/lower lip in a photo.
 * Returns points in the image's natural pixel coordinates, or null when no face is found.
 */
export async function detectMouthPoints(img: HTMLImageElement): Promise<FaceDetection | null> {
  const { lm, irisSets } = await load();
  const res = lm.detect(img);
  const face = res.faceLandmarks?.[0];
  if (!face) return null;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const px = (i: number) => ({ x: face[i].x * W, y: face[i].y * H });
  const irises = irisSets
    .filter((set) => set.every((i) => face[i]))
    .map((set) => {
      const pts = set.map(px).sort((a, b) => a.x - b.x);
      return [pts[0], pts[pts.length - 1]] as [{ x: number; y: number }, { x: number; y: number }];
    });
  if (!irises.length || !face[UPPER_INNER_LIP] || !face[LOWER_INNER_LIP]) return null;
  return {
    points: { irises, lips: [px(UPPER_INNER_LIP), px(LOWER_INNER_LIP)] },
    headPose: headPose(res.facialTransformationMatrixes?.[0]?.data),
  };
}
