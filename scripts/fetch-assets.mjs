// Copies MediaPipe's WASM runtime and downloads the hand model into public/mediapipe,
// so the app serves everything from its own origin and works offline at a gig.
import { cpSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const modelPath = join(outDir, 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

mkdirSync(outDir, { recursive: true });

if (!existsSync(wasmSrc)) {
  console.error('MediaPipe WASM not found. Run `npm install` first.');
  process.exit(1);
}
cpSync(wasmSrc, join(outDir, 'wasm'), { recursive: true });

if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) {
  console.log('fetch-assets: model already present');
} else {
  console.log('fetch-assets: downloading hand model...');
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('fetch-assets: model saved');
  } catch (err) {
    console.error(`fetch-assets: could not download the hand model (${err.message}).`);
    console.error(`Download it manually from ${MODEL_URL} to ${modelPath}`);
    process.exit(1);
  }
}
