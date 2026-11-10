import { DECKS, type ActionEvent, type Deck, type HandFrame, type Pose, type RingState } from '../types';
import { classify } from './classifier';
import { FeatureExtractor, type FeatureConfig, type HandFeatures } from './features';
import { Stabilizer, type StabilizerConfig } from './stabilizer';

export interface PipelineConfig extends FeatureConfig, StabilizerConfig {
  /** Half-width of the band around the centre line where a hand keeps its previous deck. */
  deadBand: number;
}

export interface DeckView {
  hand: HandFrame | null;
  features: HandFeatures | null;
  pose: Pose;
  ring: RingState;
}

export interface PipelineOutput {
  decks: Record<Deck, DeckView>;
  actions: ActionEvent[];
}

interface Slot {
  features: FeatureExtractor;
  stabilizer: Stabilizer;
  lastX: number | null;
}

const IDLE_RING: RingState = { phase: 'idle', action: null, progress: 0 };

/**
 * Turns raw tracked hands into per-deck ring state and action events.
 * Decks are assigned by which half of the mirrored view the wrist is in,
 * never by MediaPipe's handedness label, which flips.
 */
export class GesturePipeline {
  private cfg: PipelineConfig;
  private slots: Record<Deck, Slot>;

  constructor(cfg: PipelineConfig) {
    this.cfg = { ...cfg };
    this.slots = {
      A: { features: new FeatureExtractor(cfg), stabilizer: new Stabilizer(cfg), lastX: null },
      B: { features: new FeatureExtractor(cfg), stabilizer: new Stabilizer(cfg), lastX: null },
    };
  }

  setConfig(cfg: PipelineConfig): void {
    this.cfg = { ...cfg };
    for (const deck of DECKS) {
      this.slots[deck].features.setConfig(cfg);
      this.slots[deck].stabilizer.setConfig(cfg);
    }
  }

  update(hands: HandFrame[], t: number): PipelineOutput {
    const assigned = this.assign(hands);
    const actions: ActionEvent[] = [];
    const decks = {} as Record<Deck, DeckView>;

    for (const deck of DECKS) {
      const slot = this.slots[deck];
      const hand = assigned[deck];
      if (!hand) {
        slot.features.reset();
        slot.stabilizer.reset();
        slot.lastX = null;
        decks[deck] = { hand: null, features: null, pose: 'none', ring: IDLE_RING };
        continue;
      }
      const features = slot.features.update(hand, t);
      const pose = classify(features.fingers);
      const out = slot.stabilizer.update({ pose, clutch: features.clutch, speed: features.speed, t });
      if (out.fired) actions.push({ deck, action: out.fired, t });
      slot.lastX = features.mirroredX;
      decks[deck] = { hand, features, pose, ring: out.ring };
    }
    return { decks, actions };
  }

  private assign(hands: HandFrame[]): Record<Deck, HandFrame | null> {
    const claims: Record<Deck, { hand: HandFrame; x: number }[]> = { A: [], B: [] };
    for (const hand of hands) {
      const x = 1 - hand.landmarks[0].x;
      claims[this.deckFor(x)].push({ hand, x });
    }
    // Two hands on one half: the one nearer that deck's outer edge wins, the other is ignored.
    const pick = (deck: Deck) => {
      const list = claims[deck];
      if (list.length === 0) return null;
      list.sort((a, b) => (deck === 'A' ? a.x - b.x : b.x - a.x));
      return list[0].hand;
    };
    return { A: pick('A'), B: pick('B') };
  }

  private deckFor(x: number): Deck {
    const band = this.cfg.deadBand;
    if (x < 0.5 - band) return 'A';
    if (x > 0.5 + band) return 'B';
    let best: Deck | null = null;
    let bestDist = Infinity;
    for (const deck of DECKS) {
      const last = this.slots[deck].lastX;
      if (last === null) continue;
      const d = Math.abs(last - x);
      if (d < bestDist) {
        bestDist = d;
        best = deck;
      }
    }
    return best ?? (x < 0.5 ? 'A' : 'B');
  }
}
