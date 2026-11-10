import type { DeckView } from '../gestures/pipeline';
import { DECKS, type Deck, type Vec3 } from '../types';
import { ARMED_COLOR, DECK_COLOR, WARN_COLOR } from './colors';

const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const PALM = [0, 5, 9, 13, 17];
const LABEL_FONT = '600 13px "JetBrains Mono", ui-monospace, monospace';

export interface OverlayOptions {
  dim: number;
  showSkeleton: boolean;
  /** Text under each deck's ring, or null for none. */
  labels: Record<Deck, { text: string; warn: boolean } | null>;
}

/** Maps normalised, unmirrored camera coordinates to canvas pixels with "cover" cropping and mirroring. */
export interface ViewTransform {
  toCanvas(p: Vec3): { x: number; y: number };
  scale: number;
}

export function coverTransform(cw: number, ch: number, vw: number, vh: number): ViewTransform {
  const scale = Math.max(cw / vw, ch / vh);
  const dx = (cw - vw * scale) / 2;
  const dy = (ch - vh * scale) / 2;
  return {
    scale,
    toCanvas: (p) => ({ x: cw - (dx + p.x * vw * scale), y: dy + p.y * vh * scale }),
  };
}

export function sizeCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  decks: Record<Deck, DeckView>,
  opts: OverlayOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { w, h, dpr } = sizeCanvas(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const view = coverTransform(w, h, vw, vh);

  // Mirrored camera.
  if (video.readyState >= 2) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    const dw = vw * view.scale;
    const dh = vh * view.scale;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.fillStyle = `rgba(10, 12, 17, ${opts.dim})`;
  ctx.fillRect(0, 0, w, h);

  drawCentreLine(ctx, w, h);

  for (const deck of DECKS) {
    const d = decks[deck];
    if (!d.hand) continue;
    const pts = d.hand.landmarks.map(view.toCanvas);
    if (opts.showSkeleton) drawSkeleton(ctx, pts);
    drawRing(ctx, pts, deck, d, opts.labels[deck]);
  }
}

function drawCentreLine(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('DECK A', w / 2 - 12, h / 2);
  ctx.textAlign = 'left';
  ctx.fillText('DECK B', w / 2 + 12, h / 2);
  ctx.restore();
}

function drawSkeleton(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(233,236,243,0.55)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of EDGES) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = '#e9ecf3';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  deck: Deck,
  d: DeckView,
  label: { text: string; warn: boolean } | null,
): void {
  const cx = PALM.reduce((s, i) => s + pts[i].x, 0) / PALM.length;
  const cy = PALM.reduce((s, i) => s + pts[i].y, 0) / PALM.length;
  const size = Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y);
  const r = Math.max(40, size * 1.5);
  const color = DECK_COLOR[deck];
  const { phase, progress } = d.ring;

  ctx.save();
  ctx.lineCap = 'round';
  switch (phase) {
    case 'idle':
      ctx.strokeStyle = 'rgba(233,236,243,0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      circle(ctx, cx, cy, r);
      ctx.stroke();
      break;
    case 'armed':
      ctx.strokeStyle = ARMED_COLOR;
      ctx.lineWidth = 12;
      ctx.globalAlpha = 0.1;
      circle(ctx, cx, cy, r);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 4;
      circle(ctx, cx, cy, r);
      ctx.stroke();
      break;
    case 'forming':
      ctx.strokeStyle = ARMED_COLOR;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      circle(ctx, cx, cy, r);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, progress));
      ctx.stroke();
      break;
    case 'fired':
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      circle(ctx, cx, cy, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = label?.warn ? WARN_COLOR : color;
      ctx.lineWidth = 6;
      circle(ctx, cx, cy, r);
      ctx.stroke();
      break;
    case 'rearm':
      ctx.strokeStyle = 'rgba(233,236,243,0.35)';
      ctx.lineWidth = 2;
      circle(ctx, cx, cy, r);
      ctx.stroke();
      break;
  }
  ctx.restore();

  if (label) drawLabel(ctx, cx, cy + r + 22, label.text, phase === 'fired', label.warn ? WARN_COLOR : phaseColor(phase, color));
}

function phaseColor(phase: DeckView['ring']['phase'], deckColor: string): string {
  if (phase === 'armed') return ARMED_COLOR;
  if (phase === 'rearm') return 'rgba(233,236,243,0.6)';
  return deckColor;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, filled: boolean, color: string): void {
  ctx.save();
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 26;
  const h = 26;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = filled ? color : 'rgba(10,12,17,0.85)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = filled ? '#0a0c11' : color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
