// The plugin's log category. Every message the Storylet Engine wrapper logs (a
// refused call, a condition the engine played through with nothing bound to
// OnError, a refused save or bundle) goes here, so a game can filter it
// (`Log LogStoryletEngine Verbose`) or silence it apart from the rest of its
// log. Patterplay's LogPatterplay, the same shape.
#pragma once

#include "CoreMinimal.h"
#include "Logging/LogMacros.h"

STORYLETENGINERUNTIME_API DECLARE_LOG_CATEGORY_EXTERN(LogStoryletEngine, Log, All);
