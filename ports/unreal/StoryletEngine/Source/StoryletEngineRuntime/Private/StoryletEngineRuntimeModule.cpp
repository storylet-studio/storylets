#include "StoryletEngineRuntimeModule.h"

// The state kernel headers no other module TU pulls in yet: included here so
// the plugin build compiles them (ScopeRegistry, vendored from ../expr, is the
// host-facing kernel surface; readScopeRegistrySpec has no in-module caller).
#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`, and kernelCall

IMPLEMENT_MODULE(FStoryletEngineRuntimeModule, StoryletEngineRuntime);
