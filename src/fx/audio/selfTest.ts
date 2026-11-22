// a self-test of the effects node, rendered offline in the browser; used by the smoke test and for a quick manual check with ?fxtest.

import type { FxMessage } from '../protocol';
import { createFxNode } from './node';

const SAMPLE_RATE = 48000;
const FRAMES = 48000;

/** The outcome of the effects self-test. */
export interface FxSelfTestResult {
  /** Largest difference between the bypassed render and a render without the node. 0 means bit-exact. */
  bypassMaxDiff: number;
  /** RMS difference between a render with an echo and a neutral render: above 0 means the effect is audible. */
  effectRmsDiff: number;
  /** State messages received from the processor during the neutral one-second render (10 expected). */
  stateMessages: number;
  /** Error messages received from the processor over all renders (0 expected). */
  errors: number;
}

declare global {
  interface Window {
    /** Present only when the page URL has ?fxtest. */
    __trackstarFxSelfTest?: () => Promise<FxSelfTestResult>;
  }
}

interface Render {
  left: Float32Array;
  right: Float32Array;
  states: number;
  errors: number;
}

/** Renders one second of a 440 Hz tone, through the effects node when `initial` is given. */
async function render(initial: FxMessage[] | null): Promise<Render> {
  const ctx = new OfflineAudioContext(2, FRAMES, SAMPLE_RATE);
  const osc = new OscillatorNode(ctx, { frequency: 440 });
  const gain = new GainNode(ctx, { gain: 0.5 });
  osc.connect(gain);
  let states = 0;
  let errors = 0;
  if (initial) {
    const node = await createFxNode(ctx, initial);
    node.port.onmessage = (e: MessageEvent) => {
      const type = (e.data as { type?: string } | null)?.type;
      if (type === 'state') states++;
      else if (type === 'error') errors++;
    };
    gain.connect(node);
    node.connect(ctx.destination);
  } else {
    gain.connect(ctx.destination);
  }
  osc.start();
  const buffer = await ctx.startRendering();
  await new Promise((r) => setTimeout(r, 100));
  return { left: buffer.getChannelData(0), right: buffer.getChannelData(1), states, errors };
}

/** Renders the tone dry, bypassed, neutral and with an echo, and measures what the effects node did. */
export async function runFxSelfTest(): Promise<FxSelfTestResult> {
  const dry = await render(null);
  const bypass = await render([{ type: 'bypass', on: true }]);
  const neutral = await render([]);
  const effect = await render([
    { type: 'sceneSlot', slot: 1 },
    { type: 'sceneAmount', value: 0.8 },
  ]);

  let bypassMaxDiff = 0;
  for (let i = 0; i < FRAMES; i++) {
    bypassMaxDiff = Math.max(bypassMaxDiff, Math.abs(bypass.left[i] - dry.left[i]), Math.abs(bypass.right[i] - dry.right[i]));
  }
  let sum = 0;
  for (let i = 0; i < FRAMES; i++) {
    const d = effect.left[i] - neutral.left[i];
    sum += d * d;
  }
  return {
    bypassMaxDiff,
    effectRmsDiff: Math.sqrt(sum / FRAMES),
    stateMessages: neutral.states,
    errors: bypass.errors + neutral.errors + effect.errors,
  };
}
