// The contractual PRNG: mulberry32, bit-for-bit across every port (schema 3.3;
// packages/runtime/src/prng.ts ported exactly). Default seed 0; the state is a
// plain uint32 persisted in the save envelope. All arithmetic is unchecked
// 32-bit (uint), matching JavaScript's `>>> 0` / Math.imul.

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    public sealed class Mulberry32
    {
        private uint _s;

        /// <summary>makePrng(seed): the seed is coerced like JS `seed >>> 0`.</summary>
        public Mulberry32(double seed)
        {
            _s = ToUint32(seed);
        }

        public Mulberry32(uint state)
        {
            _s = state;
        }

        /// <summary>One draw in [0, 1); advances the state.</summary>
        public double Next()
        {
            unchecked
            {
                _s = _s + 0x6d2b79f5u;
                uint t = (_s ^ (_s >> 15)) * (1u | _s);           // Math.imul(s ^ (s >>> 15), 1 | s)
                t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;       // (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
                return (t ^ (t >> 14)) / 4294967296.0;            // ((t ^ (t >>> 14)) >>> 0) / 0x100000000
            }
        }

        /// <summary>The persisted state (a uint32; feed back into the constructor
        /// to restore - the TS `state()`).</summary>
        public uint State { get => _s; set => _s = value; }

        /// <summary>JS ToUint32 for a numeric seed.</summary>
        public static uint ToUint32(double seed)
        {
            if (double.IsNaN(seed) || double.IsInfinity(seed)) return 0;
            double truncated = Math.Truncate(seed);
            double modded = truncated % 4294967296.0;
            if (modded < 0) modded += 4294967296.0;
            return (uint)modded;
        }
    }

    public static class Prng
    {
        /// <summary>The contractual shuffle: Fisher-Yates, descending (schema 3.3).</summary>
        public static void ShuffleInPlace<T>(IList<T> arr, Mulberry32 prng)
        {
            for (int i = arr.Count - 1; i > 0; i--)
            {
                int j = (int)Math.Floor(prng.Next() * (i + 1));
                T tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            }
        }
    }
}
