#pragma once

// The core value <-> Blueprint struct crossing, shared by the world container
// (StoryletWorld.cpp). The engine and bundle sources carry their own older
// copies of the core -> Blueprint half with the same rendering; converge on
// this header when next touched.

#include "StoryletTypes.h"
#include "Storylets/StoryletValue.h"

#include <string>
#include <vector>

inline FString StoryletValueDisplay(const storylets::StoryletValue& V)
{
	switch (V.kind)
	{
		case storylets::StoryletKind::Bool:
			return V.asBool() ? TEXT("true") : TEXT("false");
		case storylets::StoryletKind::Number:
			return FString(UTF8_TO_TCHAR(storylets::StoryletValue::JsNumber(V.asNumber()).c_str()));
		case storylets::StoryletKind::Str:
			return FString(UTF8_TO_TCHAR(V.asString().c_str()));
		default:
		{
			FString Out;
			const std::vector<std::string>& Flags = V.asFlags();
			for (size_t i = 0; i < Flags.size(); ++i)
			{
				if (i > 0) Out += TEXT(", ");
				Out += FString(UTF8_TO_TCHAR(Flags[i].c_str()));
			}
			return Out;
		}
	}
}

inline FStoryletValue StoryletValueToUe(const storylets::StoryletValue& V)
{
	FStoryletValue Out;
	switch (V.kind)
	{
		case storylets::StoryletKind::Bool:
			Out.Kind = EStoryletValueKind::Boolean;
			Out.bBool = V.asBool();
			break;
		case storylets::StoryletKind::Number:
			Out.Kind = EStoryletValueKind::Number;
			Out.Number = V.asNumber();
			break;
		case storylets::StoryletKind::Str:
			Out.Kind = EStoryletValueKind::String;
			Out.String = FString(UTF8_TO_TCHAR(V.asString().c_str()));
			break;
		default:
			Out.Kind = EStoryletValueKind::Flags;
			for (const std::string& F : V.asFlags()) Out.Flags.Add(FString(UTF8_TO_TCHAR(F.c_str())));
			break;
	}
	Out.Display = StoryletValueDisplay(V);
	return Out;
}

inline storylets::StoryletValue StoryletValueFromUe(const FStoryletValue& V)
{
	switch (V.Kind)
	{
		case EStoryletValueKind::Boolean: return storylets::StoryletValue::Bool(V.bBool);
		case EStoryletValueKind::Number: return storylets::StoryletValue::Num(V.Number);
		case EStoryletValueKind::String: return storylets::StoryletValue::Str(std::string(TCHAR_TO_UTF8(*V.String)));
		default:
		{
			std::vector<std::string> Flags;
			Flags.reserve(static_cast<size_t>(V.Flags.Num()));
			for (const FString& F : V.Flags) Flags.push_back(std::string(TCHAR_TO_UTF8(*F)));
			return storylets::StoryletValue::Flags(std::move(Flags));
		}
	}
}
