#include "StoryletWorld.h"
#include "StoryletValueConvert.h"
#include "Storylets/Engine.h"

#include <optional>
#include <vector>

/** Values in first-set order (Names() and a save both want a stable order),
 *  beside the game's read-only names. */
struct FStoryletWorldImpl
{
	std::vector<std::pair<std::string, storylets::StoryletValue>> Values;
	std::vector<std::string> ReadOnly;

	const storylets::StoryletValue* Find(const std::string& Name) const
	{
		for (const auto& Pair : Values) if (Pair.first == Name) return &Pair.second;
		return nullptr;
	}
	void Put(const std::string& Name, const storylets::StoryletValue& Value)
	{
		for (auto& Pair : Values) if (Pair.first == Name) { Pair.second = Value; return; }
		Values.emplace_back(Name, Value);
	}
	bool IsReadOnly(const std::string& Name) const
	{
		for (const auto& R : ReadOnly) if (R == Name) return true;
		return false;
	}
};

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
	FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }
}

UStoryletWorld::UStoryletWorld()
{
	Impl = MakePimpl<FStoryletWorldImpl>();
}

// --- the host's writes ---------------------------------------------------------

void UStoryletWorld::SetBool(const FString& Name, bool bValue) { HostSet(Std(Name), storylets::StoryletValue::Bool(bValue)); }
void UStoryletWorld::SetNumber(const FString& Name, double Value) { HostSet(Std(Name), storylets::StoryletValue::Num(Value)); }
void UStoryletWorld::SetString(const FString& Name, const FString& Value) { HostSet(Std(Name), storylets::StoryletValue::Str(Std(Value))); }
void UStoryletWorld::SetFlags(const FString& Name, const TArray<FString>& Values)
{
	std::vector<std::string> Flags;
	Flags.reserve(static_cast<size_t>(Values.Num()));
	for (const FString& V : Values) Flags.push_back(Std(V));
	HostSet(Std(Name), storylets::StoryletValue::Flags(std::move(Flags)));
}

// --- reads ------------------------------------------------------------------------

bool UStoryletWorld::Has(const FString& Name) const { return Impl->Find(Std(Name)) != nullptr; }

bool UStoryletWorld::GetValue(const FString& Name, FStoryletValue& OutValue) const
{
	const storylets::StoryletValue* V = Impl->Find(Std(Name));
	if (!V) { OutValue = FStoryletValue(); return false; }
	OutValue = StoryletValueToUe(*V);
	return true;
}

bool UStoryletWorld::GetBool(const FString& Name) const
{
	const storylets::StoryletValue* V = Impl->Find(Std(Name));
	return V && V->isBool() ? V->asBool() : false;
}

double UStoryletWorld::GetNumber(const FString& Name) const
{
	const storylets::StoryletValue* V = Impl->Find(Std(Name));
	return V && V->isNumber() ? V->asNumber() : 0.0;
}

FString UStoryletWorld::GetString(const FString& Name) const
{
	const storylets::StoryletValue* V = Impl->Find(Std(Name));
	return V ? StoryletValueDisplay(*V) : FString();
}

TArray<FString> UStoryletWorld::GetFlags(const FString& Name) const
{
	TArray<FString> Out;
	const storylets::StoryletValue* V = Impl->Find(Std(Name));
	if (V && V->isFlags()) for (const std::string& F : V->asFlags()) Out.Add(Ue(F));
	return Out;
}

TArray<FString> UStoryletWorld::Names() const
{
	TArray<FString> Out;
	for (const auto& Pair : Impl->Values) Out.Add(Ue(Pair.first));
	return Out;
}

// --- the game's policy ---------------------------------------------------------

void UStoryletWorld::SetReadOnly(const FString& Name, bool bReadOnly)
{
	const std::string N = Std(Name);
	auto& RO = Impl->ReadOnly;
	for (auto It = RO.begin(); It != RO.end(); ++It)
	{
		if (*It == N)
		{
			if (!bReadOnly) RO.erase(It);
			return;
		}
	}
	if (bReadOnly) RO.push_back(N);
}

bool UStoryletWorld::IsReadOnly(const FString& Name) const { return Impl->IsReadOnly(Std(Name)); }

// --- C++ seam ---------------------------------------------------------------------

bool UStoryletWorld::Get(const std::string& Name, storylets::StoryletValue& OutValue) const
{
	const storylets::StoryletValue* V = Impl->Find(Name);
	if (!V) return false;
	OutValue = *V;
	return true;
}

void UStoryletWorld::HostSet(const std::string& Name, const storylets::StoryletValue& Value)
{
	Impl->Put(Name, Value);
	OnChanged.Broadcast(Ue(Name), StoryletValueToUe(Value), false);
}

void UStoryletWorld::StorySet(const std::string& Name, const storylets::StoryletValue& Value)
{
	if (Impl->IsReadOnly(Name))
	{
		throw storylets::StoryletError("@world." + Name + " is the game's alone: a story tried to set it");
	}
	Impl->Put(Name, Value);
	OnChanged.Broadcast(Ue(Name), StoryletValueToUe(Value), true);
}

storylets::WorldResolver UStoryletWorld::MakeResolver()
{
	// Weak: the core outlives nothing here, but a game that drops its world
	// while an engine still holds the resolver must read unset, not crash.
	TWeakObjectPtr<UStoryletWorld> Weak(this);
	storylets::WorldResolver R;
	R.get = [Weak](const std::string& Name) -> std::optional<storylets::StoryletValue>
	{
		UStoryletWorld* W = Weak.Get();
		storylets::StoryletValue V;
		if (W && W->Get(Name, V)) return V;
		return std::nullopt;
	};
	R.set = [Weak](const std::string& Name, const storylets::StoryletValue& Value)
	{
		if (UStoryletWorld* W = Weak.Get()) W->StorySet(Name, Value);
	};
	return R;
}
