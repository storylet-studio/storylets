// ---------------------------------------------------------------------------
// The contractual PRNG: mulberry32, bit-for-bit across every port (schema
// 3.3; carried verbatim from the old engine). Default seed 0; the state is a
// plain uint32 persisted in the save envelope.
// ---------------------------------------------------------------------------

export interface Prng {
  /** One draw in [0, 1); advances the state. */
  next(): number;
  /** The persisted state (a uint32; feed back into makePrng to restore). */
  state(): number;
}

export function makePrng(seed: number): Prng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    },
    state(): number {
      return s;
    },
  };
}

/** The contractual shuffle: Fisher-Yates, descending (schema 3.3). */
export function shuffleInPlace<T>(arr: T[], prng: Prng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
