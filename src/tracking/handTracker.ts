import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandFrame } from '../types';

/** Thin wrapper over MediaPipe's HandLandmarker. Handedness labels are deliberately dropped. */
export class HandTracker {
  private lastT = -1;

  private constructor(
    private readonly landmarker: HandLandmarker,
    readonly delegate: 'GPU' | 'CPU',
  ) {}

  /** `base` is the app's base URL; assets live under `${base}mediapipe/`. */
  static async create(base: string): Promise<HandTracker> {
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}mediapipe/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      return new HandTracker(await HandLandmarker.createFromOptions(fileset, options('GPU')), 'GPU');
    } catch {
      return new HandTracker(await HandLandmarker.createFromOptions(fileset, options('CPU')), 'CPU');
    }
  }

  detect(video: HTMLVideoElement, t: number): HandFrame[] {
    // MediaPipe requires strictly increasing timestamps.
    const ts = t <= this.lastT ? this.lastT + 1 : t;
    this.lastT = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    return result.landmarks.map((landmarks, i) => ({
      landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
      world: (result.worldLandmarks[i] ?? landmarks).map(({ x, y, z }) => ({ x, y, z })),
    }));
  }

  close(): void {
    this.landmarker.close();
  }
}
