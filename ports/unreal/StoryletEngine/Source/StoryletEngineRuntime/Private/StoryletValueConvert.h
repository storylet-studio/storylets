#pragma once

// The core <-> Blueprint crossing for every UObject source in this module: the
// engine and its flows, the bundle description and the world container. One
// copy, so a value renders the same on an examiner row, a card field, a
// getter and a world change: there were three, identical only by care.

#include "StoryletTypes.h"
#include "Storylets/Kernel.h"   // StoryletValue and the PropertyTypes vocabulary

#include <string>
#include <vector>

namespace StoryletConvert
{
	inline std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
	inline FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	inline EStoryletPropertyType PropertyTypeFrom(const std::string& T)
	{
		if (T == storylets::PropertyTypes::Number) return EStoryletPropertyType::Number;
		if (T == storylets::PropertyTypes::String) return EStoryletPropertyType::String;
		if (T == storylets::PropertyTypes::Enum) return EStoryletPropertyType::Enum;
		if (T == storylets::PropertyTypes::Flags) return EStoryletPropertyType::Flags;
		if (T == storylets::PropertyTypes::Quality) return EStoryletPropertyType::Quality;
		return EStoryletPropertyType::Boolean;
	}
}

/** The one display rendering: raw strings (no quotes), "true"/"false",
 *  JS-stable numbers, flags joined with ", " (what the examiner's flags
 *  editor parses back). */
inline FString StoryletValueDisplay(const storylets::StoryletValue& V)
{
	using StoryletConvert::Ue;
	switch (V.kind)
	{
		case storylets::StoryletKind::Bool:
			return V.asBool() ? TEXT("true") : TEXT("false");
		case storylets::StoryletKind::Number:
			return Ue(storylets::StoryletValue::JsNumber(V.asNumber()));
		case storylets::StoryletKind::Str:
			return Ue(V.asString());
		default:
		{
			FString Out;
			const std::vector<std::string>& Flags = V.asFlags();
			for (size_t i = 0; i < Flags.size(); ++i)
			{
				if (i > 0) Out += TEXT(", ");
				Out += Ue(Flags[i]);
			}
			return Out;
		}
	}
}

inline FStoryletValue StoryletValueToUe(const storylets::StoryletValue& V)
{
	using StoryletConvert::Ue;
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
			Out.String = Ue(V.asString());
			break;
		default:
			Out.Kind = EStoryletValueKind::Flags;
			for (const std::string& F : V.asFlags()) Out.Flags.Add(Ue(F));
			break;
	}
	Out.Display = StoryletValueDisplay(V);
	return Out;
}

inline storylets::StoryletValue StoryletValueFromUe(const FStoryletValue& V)
{
	using StoryletConvert::Std;
	switch (V.Kind)
	{
		case EStoryletValueKind::Boolean: return storylets::StoryletValue::Bool(V.bBool);
		case EStoryletValueKind::Number: return storylets::StoryletValue::Num(V.Number);
		case EStoryletValueKind::String: return storylets::StoryletValue::Str(Std(V.String));
		default:
		{
			std::vector<std::string> Flags;
			Flags.reserve(static_cast<size_t>(V.Flags.Num()));
			for (const FString& F : V.Flags) Flags.push_back(Std(F));
			return storylets::StoryletValue::Flags(std::move(Flags));
		}
	}
}
