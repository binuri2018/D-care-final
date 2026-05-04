import { analyzeConfusionWebcamFrame } from "../api.js";
import { defaultAnalyzeFrame } from "../hooks/useFacialEmotion.js";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

function confusionLevelFromScore(u) {
  if (u == null || Number.isNaN(Number(u))) return null;
  const x = Number(u);
  if (x < 0.35) return "low";
  if (x < 0.65) return "medium";
  return "high";
}

/**
 * Sends each webcam frame to POST /api/analyze-confusion-frame (YOLO best.pt on server).
 * On network errors or ``ok: false``, falls back to the local placeholder (not YOLO).
 */
export function createYoloConfusionAnalyzer(options = {}) {
  const fallback = options.fallbackAnalyzeFrame || defaultAnalyzeFrame;
  return function analyzeFrame(canvas, ctx) {
    return new Promise((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(fallback(canvas, ctx));
            return;
          }
          try {
            const j = await analyzeConfusionWebcamFrame(blob);
            if (j.ok === false) {
              if (isDev) {
                console.warn("[YOLO confusion] ok=false:", j.error || j.note || j);
              }
              resolve(fallback(canvas, ctx));
              return;
            }
            const u = j.confusion_score != null ? Number(j.confusion_score) : null;
            resolve({
              emotion: j.emotion ?? "neutral",
              confusion_score: u,
              confusion_level: j.confusion_level ?? confusionLevelFromScore(u),
              predicted_label: j.predicted_label ?? null,
              model_confidence:
                j.model_confidence != null && Number.isFinite(Number(j.model_confidence))
                  ? Number(j.model_confidence)
                  : null,
              raw_model_label: j.raw_model_label ?? null,
              source: j.source || "best.pt",
            });
          } catch (e) {
            if (isDev) console.warn("[YOLO confusion] request failed:", e?.message || e);
            resolve(fallback(canvas, ctx));
          }
        },
        "image/jpeg",
        0.82
      );
    });
  };
}
