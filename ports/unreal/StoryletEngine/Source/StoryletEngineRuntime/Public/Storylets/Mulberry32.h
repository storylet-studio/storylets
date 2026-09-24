// The contractual PRNG (schema 3.3). The algorithm is the SHARED source,
// vendored from expr/ports/unreal/Mulberry32.h to Expr/Mulberry32.h beside
// this; it is the kernel's, named in `storylets` by Kernel.h, so Mulberry32 and ShuffleInPlace
// read here exactly as they did when this file held them.
#pragma once

#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`, and kernelCall
