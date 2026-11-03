#include "StoryletVersion.h"
#include "StoryletValueConvert.h"
#include "Storylets/Version.h"

using StoryletConvert::Std;
using StoryletConvert::Ue;

FString UStoryletVersion::GetStoryletEngineVersion()
{
	return Ue(storylets::StoryletEngineVersion);
}

bool UStoryletVersion::StoryletEngineVersionInRange(const FString& Version, const FString& Min, const FString& MaxExclusive)
{
	return storylets::versionInRange(Std(Version), Std(Min), Std(MaxExclusive));
}
