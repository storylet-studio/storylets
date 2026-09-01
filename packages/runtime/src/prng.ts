// The contractual PRNG now lives in @wildwinter/expr, the package both product
// families already depend on: mulberry32 is a fixed published algorithm that
// neither family owns, and it existed thirteen times across the two of them.
//
// This file stays as a re-export so nothing that imports `./prng.js` has to
// move, and so the runtime's public surface is unchanged.
// toUint32 is deliberately NOT re-exported: it is the seed-coercion detail a
// PORT has to reproduce, not something a game author calls, and widening this
// runtime's public surface by accident is how a sample stops being the answer
// to "how do I use this". Import it from @wildwinter/expr if you need it.
export { makePrng, shuffleInPlace } from "@wildwinter/expr";
export type { Prng } from "@wildwinter/expr";
