#include "StoryletStages.h"
#include "StoryletValueConvert.h"

#include <exception>

using StoryletConvert::Std;
using StoryletConvert::Ue;

namespace
{
	std::vector<std::string> Ladder(const TArray<FString>& Stages)
	{
		std::vector<std::string> Out;
		Out.reserve(static_cast<size_t>(Stages.Num()));
		for (const FString& S : Stages) Out.push_back(Std(S));
		return Out;
	}
}

int32 UStoryletStages::StageIndex(const TArray<FString>& Stages, const FString& Value)
{
	return storylets::StageIndex(Ladder(Stages), storylets::StoryletValue::Str(Std(Value)));
}

bool UStoryletStages::CompareStages(const TArray<FString>& Stages, const FString& A, const FString& B, int32& Result, FString& Error)
{
	Result = 0;
	Error.Reset();
	try
	{
		Result = storylets::CompareStages(Ladder(Stages), storylets::StoryletValue::Str(Std(A)), storylets::StoryletValue::Str(Std(B)));
		return true;
	}
	catch (const std::exception& E)
	{
		Error = Ue(E.what());
		return false;
	}
}

bool UStoryletStages::NextStage(const TArray<FString>& Stages, const FString& Value, FString& Next, FString& Error)
{
	Next.Reset();
	Error.Reset();
	try
	{
		Next = Ue(storylets::NextStage(Ladder(Stages), storylets::StoryletValue::Str(Std(Value))));
		return true;
	}
	catch (const std::exception& E)
	{
		Error = Ue(E.what());
		return false;
	}
}
