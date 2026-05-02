/** COCO-17 edges for YOLOv8-pose style visualization */
export const COCO_POSE_EDGES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

function isKpVisible(p) {
  return p && p.length >= 2 && (Math.abs(p[0]) > 1e-5 || Math.abs(p[1]) > 1e-5);
}

/**
 * Letterbox / pillarbox rect for a video with object-fit: contain inside its box.
 * @returns {{ ox: number, oy: number, dw: number, dh: number, vw: number, vh: number, cw: number, ch: number } | null}
 */
export function getVideoContainRect(videoEl) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const cw = videoEl.clientWidth;
  const ch = videoEl.clientHeight;
  if (!vw || !vh || !cw || !ch) return null;
  const r = vw / vh;
  const R = cw / ch;
  let dw;
  let dh;
  let ox;
  let oy;
  if (r > R) {
    dw = cw;
    dh = cw / r;
    ox = 0;
    oy = (ch - dh) / 2;
  } else {
    dh = ch;
    dw = ch * r;
    ox = (cw - dw) / 2;
    oy = 0;
  }
  return { ox, oy, dw, dh, vw, vh, cw, ch };
}

/**
 * Normalized keypoints (0–1 in server model space) map to the same axes as the
 * JPEG sent to the API: nx * videoWidth, ny * videoHeight in intrinsic pixels,
 * then into the displayed contain rect.
 */
export function normKeypointToShell(nx, ny, videoEl) {
  const lb = getVideoContainRect(videoEl);
  if (!lb) return null;
  const xInt = nx * lb.vw;
  const yInt = ny * lb.vh;
  const x = lb.ox + (xInt / lb.vw) * lb.dw;
  const y = lb.oy + (yInt / lb.vh) * lb.dh;
  return { x, y };
}

/** Axis-aligned box from visible keypoints in shell pixels, with padding */
export function boundingBoxShell(kpts, videoEl, padFrac = 0.04) {
  if (!Array.isArray(kpts) || !kpts.length || !videoEl) return null;
  const pts = [];
  for (const p of kpts) {
    if (!isKpVisible(p)) continue;
    const m = normKeypointToShell(p[0], p[1], videoEl);
    if (m) pts.push(m);
  }
  if (pts.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const lb = getVideoContainRect(videoEl);
  if (!lb) return null;
  const pw = (maxX - minX) * padFrac;
  const ph = (maxY - minY) * padFrac;
  minX = Math.max(lb.ox, minX - pw);
  minY = Math.max(lb.oy, minY - ph);
  maxX = Math.min(lb.ox + lb.dw, maxX + pw);
  maxY = Math.min(lb.oy + lb.dh, maxY + ph);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * @param {CanvasRenderingContext2D} ctx — logical units (already scaled for DPR)
 * @param {HTMLVideoElement} videoEl
 * @param {object} opts
 */
export function drawPoseOverlay(ctx, videoEl, opts) {
  const {
    keypointsNormalized,
    keypointConfidences,
    stateText,
    actionText,
    confidenceText,
    targetLabel = "Target ID 1",
    insideBoxText = "Live feed · browser camera",
  } = opts;

  const lb = getVideoContainRect(videoEl);
  if (!lb) return;

  ctx.clearRect(0, 0, lb.cw, lb.ch);

  const kpts = keypointsNormalized;
  if (!Array.isArray(kpts) || kpts.length < 17) {
    drawHudLine(ctx, stateText || "State: —", 16, 30, "cyan");
    return;
  }

  const conf = Array.isArray(keypointConfidences) ? keypointConfidences : [];

  /** skip edge if either endpoint invisible or low conf */
  const edgeOk = (i, j) => {
    const a = kpts[i];
    const b = kpts[j];
    if (!isKpVisible(a) || !isKpVisible(b)) return false;
    const ca = conf[i] != null ? Number(conf[i]) : 0.35;
    const cj = conf[j] != null ? Number(conf[j]) : 0.35;
    return ca > 0.2 && cj > 0.2;
  };

  const lineNeon = "#4ADE80";
  const lineNeonDim = "rgba(74, 222, 128, 0.35)";

  ctx.strokeStyle = lineNeonDim;
  ctx.lineWidth = 4;
  for (const [i, j] of COCO_POSE_EDGES) {
    if (!edgeOk(i, j)) continue;
    const p1 = normKeypointToShell(kpts[i][0], kpts[i][1], videoEl);
    const p2 = normKeypointToShell(kpts[j][0], kpts[j][1], videoEl);
    if (!p1 || !p2) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.strokeStyle = lineNeon;
  ctx.lineWidth = 2.25;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [i, j] of COCO_POSE_EDGES) {
    if (!edgeOk(i, j)) continue;
    const p1 = normKeypointToShell(kpts[i][0], kpts[i][1], videoEl);
    const p2 = normKeypointToShell(kpts[j][0], kpts[j][1], videoEl);
    if (!p1 || !p2) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const kpFill = "#86EFAC";
  const kpStroke = "rgba(15, 23, 42, 0.9)";
  for (let i = 0; i < kpts.length; i++) {
    const p = kpts[i];
    if (!isKpVisible(p)) continue;
    const c = conf[i] != null ? Number(conf[i]) : 0.5;
    if (c <= 0.12) continue;
    const m = normKeypointToShell(p[0], p[1], videoEl);
    if (!m) continue;
    const r = Math.max(3.5, 2.5 + c * 4);
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fillStyle = kpFill;
    ctx.fill();
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = kpStroke;
    ctx.stroke();
  }

  const box = boundingBoxShell(kpts, videoEl, 0.05);
  if (box && box.width > 8 && box.height > 8) {
    const cyan = "#22D3EE";
    const padGlow = 2;

    ctx.save();
    ctx.shadowColor = "rgba(34, 211, 238, 0.55)";
    ctx.shadowBlur = 14;
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 3.5;
    strokeRoundRect(ctx, box.minX, box.minY, box.width, box.height, 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1;
    strokeRoundRect(ctx, box.minX + 0.5, box.minY + 0.5, box.width - 1, box.height - 1, 2);
    ctx.stroke();

    const tagH = 24;
    const tagR = 4;
    const tyRaw = box.minY - tagH - padGlow;
    const tagY = tyRaw >= 6 ? tyRaw : box.minY + 6;
    const tx = box.minX;

    ctx.font = "700 13px Consolas, ui-monospace, monospace";
    const tw = ctx.measureText(targetLabel).width;
    const tagW = tw + 20;

    ctx.fillStyle = "#0EA5E9";
    fillRoundRect(ctx, tx, tagY, tagW, tagH, tagR);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    strokeRoundRect(ctx, tx + 0.5, tagY + 0.5, tagW - 1, tagH - 1, tagR - 0.5);
    ctx.stroke();

    ctx.font = "700 12.5px Consolas, ui-monospace, monospace";
    drawHudLine(ctx, targetLabel, tx + 10, tagY + 16.5, "#ffffff", false);

    if (insideBoxText) {
      ctx.font = "600 12px system-ui, -apple-system, Segoe UI, sans-serif";
      drawHudLine(
        ctx,
        insideBoxText,
        box.minX + 8,
        box.minY + box.height - 10,
        "rgba(255, 255, 255, 0.92)",
        false,
      );
    }
  }

  ctx.font = "700 17px Consolas, ui-monospace, monospace";
  drawHudLine(ctx, stateText || "State: —", 16, 34, "#7DD3FC");

  ctx.font = "700 16px Consolas, ui-monospace, monospace";
  drawHudLine(ctx, actionText || "—", 16, 58, "#4ADE80");

  if (confidenceText) {
    ctx.font = "600 12.5px system-ui, -apple-system, Segoe UI, sans-serif";
    drawHudLine(ctx, confidenceText, 16, 78, "rgba(255, 255, 255, 0.8)", false);
  }
}

/** @param {boolean} withShadow default true */
function drawHudLine(ctx, text, x, y, color, withShadow = true) {
  if (withShadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.92)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function fillRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.stroke();
}
