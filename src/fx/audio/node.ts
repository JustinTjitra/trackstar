// creates the effects node: loads the worklet script and builds a stereo-in, stereo-out AudioWorkletNode.

import processorUrl from '../worklet/processor.ts?worker&url';
import type { FxMessage } from '../protocol';

/** The name the processor registers under in worklet/processor.ts. */
export const FX_PROCESSOR_NAME = 'trackstar-fx';

/**
 * Loads the effects processor into `ctx` and returns its node: one stereo input, one stereo output.
 * `initial` messages are applied before the first sample (use it for offline rendering, where
 * messages posted later arrive at an unknown time). Send later messages with `node.port.postMessage`.
 */
export async function createFxNode(ctx: BaseAudioContext, initial: FxMessage[] = []): Promise<AudioWorkletNode> {
  await ctx.audioWorklet.addModule(processorUrl);
  return new AudioWorkletNode(ctx, FX_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { initial },
  });
}
