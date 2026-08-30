#include "StoryletEngineRuntimeModule.h"

// The state kernel headers no other module TU pulls in yet: included here so
// the plugin build compiles them (ScopeRegistry is the host-facing kernel
// surface; readScopeRegistrySpec has no in-module caller).
#include "Storylets/ScopeRegistry.h"

IMPLEMENT_MODULE(FStoryletEngineRuntimeModule, StoryletEngineRuntime);
