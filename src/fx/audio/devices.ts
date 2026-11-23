// audio devices: finding the music input and the controller output in the browser's device list, and opening the input without voice processing

/** One audio device as the app needs to know it. */
export interface DeviceInfo { deviceId: string; label: string; kind: 'audioinput' | 'audiooutput' }

/** Labels of virtual audio devices that carry music from another app. */
export const INPUT_HINT = /blackhole|loopback|soundflower|vb-audio|cable/i;
/** Labels of DJ controllers with a built-in sound card. */
export const OUTPUT_HINT = /ddj|flx/i;

/** Capture settings for music: all voice processing off, stereo asked for. */
export const CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

/**
 * Chooses a device of `kind`: the one whose label equals `savedLabel` if there is one, otherwise
 * the first with a non-empty label matching `hint`, otherwise null. `list` is not changed.
 */
export function pickDevice(
  list: DeviceInfo[],
  kind: DeviceInfo['kind'],
  savedLabel: string | null,
  hint: RegExp,
): DeviceInfo | null {
  if (typeof savedLabel === 'string' && savedLabel !== '') {
    for (const d of list) {
      if (d.kind === kind && d.label === savedLabel) return d;
    }
  }
  // A copy without g/y flags, so test() keeps no state between entries or calls.
  const plain = new RegExp(hint.source, hint.flags.replace(/[gy]/g, ''));
  for (const d of list) {
    if (d.kind === kind && d.label !== '' && plain.test(d.label)) return d;
  }
  return null;
}

/** What the browser actually gave us for an opened input track. */
export interface TrackReport { stereo: boolean; processed: boolean; sampleRate: number | null; warnings: string[] }

/** Summarises the settings of an opened input track, with plain-sentence warnings for the user. */
export function describeTrack(settings: MediaTrackSettings): TrackReport {
  const channels = settings.channelCount;
  const stereo = typeof channels === 'number' && channels >= 2;
  const on: string[] = [];
  if (settings.echoCancellation) on.push('echo cancellation');
  if (settings.noiseSuppression) on.push('noise suppression');
  if (settings.autoGainControl) on.push('auto gain control');
  const processed = on.length > 0;
  const rate = settings.sampleRate;
  const sampleRate = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;

  const warnings: string[] = [];
  if (typeof channels !== 'number') {
    warnings.push('The browser did not report how many channels the input has; it may be mono.');
  } else if (channels < 2) {
    warnings.push('The input is mono. Check that the source sends two channels.');
  }
  if (processed) {
    warnings.push(`Browser voice processing is still on (${on.join(', ')}); it will distort music.`);
  }
  return { stereo, processed, sampleRate, warnings };
}

/** The two calls the wrappers need; `navigator.mediaDevices` fits, and tests pass a fake. */
export type MediaDevicesLike = Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia'>;

function defaultMediaDevices(): MediaDevicesLike | undefined {
  return typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
}

/**
 * Lists the audio inputs and outputs in the browser's order, as plain objects. The `default` and
 * `communications` aliases are left out. Labels are empty until the page has microphone permission.
 */
export async function listDevices(mediaDevices?: MediaDevicesLike): Promise<DeviceInfo[]> {
  const md = mediaDevices ?? defaultMediaDevices();
  if (!md || typeof md.enumerateDevices !== 'function') {
    throw new Error('This browser cannot list audio devices.');
  }
  const all = await md.enumerateDevices();
  const out: DeviceInfo[] = [];
  for (const d of all) {
    if (d.kind !== 'audioinput' && d.kind !== 'audiooutput') continue;
    if (typeof d.deviceId !== 'string' || d.deviceId === '') continue;
    if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
    out.push({ deviceId: d.deviceId, label: d.label, kind: d.kind });
  }
  return out;
}

/** Opens the input `deviceId` with `CAPTURE_CONSTRAINTS`. Browser errors pass through unchanged. */
export async function openInput(deviceId: string, mediaDevices?: MediaDevicesLike): Promise<MediaStream> {
  const md = mediaDevices ?? defaultMediaDevices();
  if (!md || typeof md.getUserMedia !== 'function') {
    throw new Error('This browser cannot open audio inputs.');
  }
  return md.getUserMedia({ audio: { ...CAPTURE_CONSTRAINTS, deviceId: { exact: deviceId } }, video: false });
}
