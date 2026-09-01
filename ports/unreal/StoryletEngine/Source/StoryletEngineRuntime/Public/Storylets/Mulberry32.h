// The contractual PRNG (schema 3.3). The algorithm is the SHARED source,
// vendored from expr/ports/unreal/Mulberry32.h to Expr/Mulberry32.h beside
// this; it lands in the `storylets` namespace, so Mulberry32 and ShuffleInPlace
// read here exactly as they did when this file held them.
#pragma once

#include "Storylets/Expr/Mulberry32.h"
