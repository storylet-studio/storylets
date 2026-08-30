// The contractual PRNG: mulberry32, bit-for-bit across every port (schema 3.3;
// packages/runtime/src/prng.ts ported exactly). Default seed 0; the state is a
// plain uint32 persisted in the save envelope. All arithmetic is unsigned
// 32-bit (uint32_t), matching JavaScript's `>>> 0` / Math.imul.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace storylets
{
    class Mulberry32
    {
    public:
        /** makePrng(seed): the seed is coerced like JS `seed >>> 0`. */
        explicit Mulberry32(double seed) : s_(ToUint32(seed)) {}

        explicit Mulberry32(uint32_t state) : s_(state) {}

        /** One draw in [0, 1); advances the state. */
        double next()
        {
            s_ += 0x6d2b79f5u;
            uint32_t t = (s_ ^ (s_ >> 15)) * (1u | s_);           // Math.imul(s ^ (s >>> 15), 1 | s)
            t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;           // (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return (t ^ (t >> 14)) / 4294967296.0;                // ((t ^ (t >>> 14)) >>> 0) / 0x100000000
        }

        /** The persisted state (a uint32; feed back into the constructor to
         *  restore - the TS `state()`). */
        uint32_t state() const { return s_; }
        void setState(uint32_t state) { s_ = state; }

        /** JS ToUint32 for a numeric seed. */
        static uint32_t ToUint32(double seed)
        {
            if (std::isnan(seed) || std::isinf(seed)) return 0;
            double truncated = std::trunc(seed);
            double modded = std::fmod(truncated, 4294967296.0);
            if (modded < 0) modded += 4294967296.0;
            return static_cast<uint32_t>(modded);
        }

    private:
        uint32_t s_;
    };

    /** The contractual shuffle: Fisher-Yates, descending (schema 3.3). */
    template <typename T>
    void ShuffleInPlace(std::vector<T>& arr, Mulberry32& prng)
    {
        if (arr.empty()) return;
        for (size_t i = arr.size() - 1; i > 0; --i)
        {
            size_t j = static_cast<size_t>(std::floor(prng.next() * static_cast<double>(i + 1)));
            std::swap(arr[i], arr[j]);
        }
    }
}
