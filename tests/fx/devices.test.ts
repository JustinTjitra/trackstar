import { describe, expect, it } from 'vitest';
import {
  CAPTURE_CONSTRAINTS,
  INPUT_HINT,
  OUTPUT_HINT,
  describeTrack,
  listDevices,
  openInput,
  pickDevice,
} from '../../src/fx/audio/devices';
import type { DeviceInfo, MediaDevicesLike } from '../../src/fx/audio/devices';

const MONO_WARNING = 'The input is mono. Check that the source sends two channels.';
const UNKNOWN_WARNING = 'The browser did not report how many channels the input has; it may be mono.';

function dev(kind: DeviceInfo['kind'], label: string, deviceId = label): DeviceInfo {
  return { deviceId, label, kind };
}

function sampleList(): DeviceInfo[] {
  return [
    dev('audioinput', 'MacBook Pro Microphone'),
    dev('audioinput', 'BlackHole 2ch (Virtual)'),
    dev('audioinput', 'Loopback Audio'),
    dev('audiooutput', 'MacBook Pro Speakers'),
    dev('audiooutput', 'DDJ-FLX2'),
    dev('audiooutput', 'BlackHole 2ch (Virtual)'),
  ];
}

describe('hints', () => {
  it('INPUT_HINT matches virtual devices only', () => {
    for (const label of [
      'BlackHole 2ch (Virtual)',
      'Loopback Audio',
      'Soundflower (2ch)',
      'CABLE Output (VB-Audio Virtual Cable)',
      'VB-Audio Voicemeeter VAIO',
      'CABLE Input',
    ]) {
      expect(INPUT_HINT.test(label), label).toBe(true);
    }
    for (const label of ['MacBook Pro Microphone', 'DDJ-FLX2', '']) {
      expect(INPUT_HINT.test(label), label || '(empty)').toBe(false);
    }
  });

  it('OUTPUT_HINT matches controllers only', () => {
    for (const label of ['DDJ-FLX2', 'DDJ-FLX4 (2b73:0033)', 'Pioneer DDJ-400', 'ddj-flx2']) {
      expect(OUTPUT_HINT.test(label), label).toBe(true);
    }
    for (const label of ['MacBook Pro Speakers', 'BlackHole 2ch (Virtual)', '']) {
      expect(OUTPUT_HINT.test(label), label || '(empty)').toBe(false);
    }
  });
});

describe('CAPTURE_CONSTRAINTS', () => {
  it('turns all voice processing off and asks for stereo', () => {
    expect(CAPTURE_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    });
  });
});

describe('pickDevice', () => {
  it('prefers the saved label over a hint match that comes first', () => {
    const list = sampleList();
    expect(pickDevice(list, 'audioinput', 'Loopback Audio', INPUT_HINT)).toBe(list[2]);
  });

  it('returns the first hint match without a saved label', () => {
    const list = sampleList();
    expect(pickDevice(list, 'audioinput', null, INPUT_HINT)).toBe(list[1]);
  });

  it('matches the saved label exactly, including upper and lower case', () => {
    const list = sampleList();
    // not the Loopback entry: the saved label must be the same text, so this falls back to the hint
    expect(pickDevice(list, 'audioinput', 'loopback audio', INPUT_HINT)).toBe(list[1]);
  });

  it('falls back to the hint when the saved label is not in the list', () => {
    const list = sampleList();
    expect(pickDevice(list, 'audioinput', 'Gone Device', INPUT_HINT)).toBe(list[1]);
  });

  it('ignores a saved label that exists only as the other kind', () => {
    const list = sampleList();
    expect(pickDevice(list, 'audioinput', 'DDJ-FLX2', INPUT_HINT)).toBe(list[1]);
  });

  it('picks the controller output, not the virtual output', () => {
    const list = sampleList();
    expect(pickDevice(list, 'audiooutput', null, OUTPUT_HINT)).toBe(list[4]);
  });

  it('returns null when nothing matches or the list is empty', () => {
    expect(pickDevice(sampleList(), 'audioinput', null, /nothing/)).toBeNull();
    expect(pickDevice([], 'audioinput', null, INPUT_HINT)).toBeNull();
    expect(pickDevice([], 'audioinput', 'x', INPUT_HINT)).toBeNull();
  });

  it('treats an empty saved label as none and never matches empty labels', () => {
    const list = [dev('audioinput', '', 'empty'), ...sampleList()];
    expect(pickDevice(list, 'audioinput', '', INPUT_HINT)).toBe(list[2]);
    expect(pickDevice(list, 'audioinput', '', /nothing/)).toBeNull();
    expect(pickDevice(list, 'audioinput', '', /^/)).toBe(list[1]);
  });

  it('returns the same object and leaves the list unchanged', () => {
    const list = sampleList();
    const before = JSON.stringify(list);
    const copy = [...list];
    const found = pickDevice(list, 'audiooutput', null, OUTPUT_HINT);
    expect(found).toBe(list[4]);
    expect(list).toEqual(copy);
    expect(JSON.stringify(list)).toBe(before);
  });

  it('gives the same answer every time for a hint with the global flag', () => {
    const list = sampleList();
    const hint = /blackhole/gi;
    for (let i = 0; i < 3; i++) {
      expect(pickDevice(list, 'audioinput', null, hint), `call ${i + 1}`).toBe(list[1]);
    }
    const sticky = /blackhole/iy;
    for (let i = 0; i < 3; i++) {
      expect(pickDevice([dev('audioinput', 'BlackHole 2ch')], 'audioinput', null, sticky), `sticky ${i + 1}`)
        .not.toBeNull();
    }
  });
});

describe('describeTrack', () => {
  it('reports a good track with no warnings', () => {
    expect(
      describeTrack({
        channelCount: 2,
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }),
    ).toEqual({ stereo: true, processed: false, sampleRate: 48000, warnings: [] });
  });

  it('counts more than two channels as stereo', () => {
    const report = describeTrack({ channelCount: 4, sampleRate: 44100 });
    expect(report.stereo).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('warns about a mono input', () => {
    const r = describeTrack({ channelCount: 1, sampleRate: 44100 });
    expect(r.stereo).toBe(false);
    expect(r.warnings).toEqual([MONO_WARNING]);
  });

  it('warns when the channel count is not reported', () => {
    const r = describeTrack({ sampleRate: 44100 });
    expect(r.stereo).toBe(false);
    expect(r.warnings).toEqual([UNKNOWN_WARNING]);
  });

  it('lists the processing that is still on, in a fixed order', () => {
    const base = { channelCount: 2 };
    const two = describeTrack({ ...base, echoCancellation: true, noiseSuppression: false, autoGainControl: true });
    expect(two.processed).toBe(true);
    expect(two.warnings).toHaveLength(1);
    expect(two.warnings[0].endsWith('(echo cancellation, auto gain control); it will distort music.')).toBe(true);
    expect(two.warnings[0]).toBe(
      'Browser voice processing is still on (echo cancellation, auto gain control); it will distort music.',
    );

    const all = describeTrack({ ...base, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(all.warnings).toEqual([
      'Browser voice processing is still on (echo cancellation, noise suppression, auto gain control); it will distort music.',
    ]);

    const one = describeTrack({ ...base, noiseSuppression: true });
    expect(one.processed).toBe(true);
    expect(one.warnings).toEqual([
      'Browser voice processing is still on (noise suppression); it will distort music.',
    ]);
  });

  it('puts the channel warning before the processing warning', () => {
    const r = describeTrack({ channelCount: 1, echoCancellation: true });
    expect(r.warnings).toEqual([
      MONO_WARNING,
      'Browser voice processing is still on (echo cancellation); it will distort music.',
    ]);
  });

  it('gives null for a missing or unusable sample rate', () => {
    const cases: Array<[string, MediaTrackSettings]> = [
      ['missing', { channelCount: 2 }],
      ['NaN', { channelCount: 2, sampleRate: NaN }],
      ['zero', { channelCount: 2, sampleRate: 0 }],
      ['infinite', { channelCount: 2, sampleRate: Infinity }],
      ['negative', { channelCount: 2, sampleRate: -1 }],
    ];
    for (const [label, settings] of cases) {
      expect(describeTrack(settings).sampleRate, label).toBeNull();
    }
  });

  it('handles empty settings', () => {
    const r = describeTrack({});
    expect(r.stereo).toBe(false);
    expect(r.processed).toBe(false);
    expect(r.sampleRate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });
});

describe('listDevices', () => {
  it('filters aliases and other kinds, and returns plain copies', async () => {
    const raw = [
      { kind: 'audioinput', deviceId: 'default', label: 'Default - BlackHole 2ch', groupId: 'g0' },
      { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Mic', groupId: 'g0' },
      { kind: 'audioinput', deviceId: 'a1', label: 'BlackHole 2ch (Virtual)', groupId: 'g1' },
      { kind: 'videoinput', deviceId: 'v1', label: 'FaceTime HD Camera', groupId: 'g2' },
      { kind: 'audiooutput', deviceId: 'o1', label: 'DDJ-FLX2', groupId: 'g3' },
      { kind: 'audioinput', deviceId: '', label: '', groupId: 'g4' },
      { kind: 'audiooutput', deviceId: 'o2', label: '', groupId: 'g5' },
    ];
    const fake = { enumerateDevices: async () => raw } as unknown as MediaDevicesLike;
    const result = await listDevices(fake);
    expect(result).toEqual([
      { deviceId: 'a1', label: 'BlackHole 2ch (Virtual)', kind: 'audioinput' },
      { deviceId: 'o1', label: 'DDJ-FLX2', kind: 'audiooutput' },
      { deviceId: 'o2', label: '', kind: 'audiooutput' },
    ]);
    expect(result[0]).not.toBe(raw[2]);
    for (const entry of result) {
      expect(Object.keys(entry).sort()).toEqual(['deviceId', 'kind', 'label']);
      expect('groupId' in entry).toBe(false);
    }
  });

  it('rejects when the browser cannot list devices', async () => {
    await expect(listDevices({} as unknown as MediaDevicesLike)).rejects.toThrow(
      'This browser cannot list audio devices.',
    );
    await expect(listDevices()).rejects.toThrow('This browser cannot list audio devices.');
  });

  it('passes a rejection from enumerateDevices through unchanged', async () => {
    const err = new Error('boom');
    const fake = { enumerateDevices: () => Promise.reject(err) } as unknown as MediaDevicesLike;
    await expect(listDevices(fake)).rejects.toBe(err);
  });
});

describe('openInput', () => {
  it('asks for the exact device with voice processing off', async () => {
    const stream = {} as MediaStream;
    const calls: unknown[][] = [];
    const fake = {
      getUserMedia: async (...args: unknown[]) => {
        calls.push(args);
        return stream;
      },
    } as unknown as MediaDevicesLike;
    const before = JSON.stringify(CAPTURE_CONSTRAINTS);
    const result = await openInput('a1', fake);
    expect(result).toBe(stream);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          deviceId: { exact: 'a1' },
        },
        video: false,
      },
    ]);
    expect(JSON.stringify(CAPTURE_CONSTRAINTS)).toBe(before);
    expect('deviceId' in CAPTURE_CONSTRAINTS).toBe(false);
  });

  it('rejects when the browser cannot open inputs', async () => {
    await expect(openInput('a1', {} as unknown as MediaDevicesLike)).rejects.toThrow(
      'This browser cannot open audio inputs.',
    );
    await expect(openInput('a1')).rejects.toThrow('This browser cannot open audio inputs.');
  });

  it('passes a getUserMedia rejection through unchanged', async () => {
    const err = new Error('denied');
    err.name = 'NotAllowedError';
    const fake = { getUserMedia: () => Promise.reject(err) } as unknown as MediaDevicesLike;
    await expect(openInput('a1', fake)).rejects.toBe(err);
  });
});
