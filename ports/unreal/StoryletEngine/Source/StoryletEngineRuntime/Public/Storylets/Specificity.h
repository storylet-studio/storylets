// Matched-constraint specificity - port of @wildwinter/expr-specificity.
//
// The scorer is the SHARED source, vendored from expr/ports/unreal/Specificity.h
// to Expr/Specificity.h beside this. It lands in the `storylets` namespace, so
// MatchedSpecificity, CountingCall and EvalTruthy read here exactly as they did
// when this file held them.
#pragma once

#include "Storylets/Expr/Specificity.h"
