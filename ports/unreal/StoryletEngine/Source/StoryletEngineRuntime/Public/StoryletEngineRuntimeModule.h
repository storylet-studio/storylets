// The runtime module boundary. The pure engine core lives under
// Public/Storylets/ (std-only headers, no UE types); the UObject/Blueprint
// wrapper layer lands in stage 2 and rides this module.
#pragma once

#include "Modules/ModuleManager.h"

class FStoryletEngineRuntimeModule : public IModuleInterface
{
public:
	virtual void StartupModule() override {}
	virtual void ShutdownModule() override {}
};
