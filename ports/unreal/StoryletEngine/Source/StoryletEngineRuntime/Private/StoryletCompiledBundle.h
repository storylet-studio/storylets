// The Pimpl payload behind UStoryletBundle: the compiled bundle as the
// core's shared pointer, so a live session keeps the compiled model alive
// even if the asset is unloaded. Module-private: only the runtime module's
// .cpp files include the std core.
#pragma once

#include "Storylets/Bundle.h"

struct FStoryletCompiledBundle
{
	storylets::BundlePtr Bundle;
};
