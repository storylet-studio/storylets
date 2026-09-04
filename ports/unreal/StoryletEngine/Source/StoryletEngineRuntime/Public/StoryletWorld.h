#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/PimplPtr.h"
#include "StoryletTypes.h"
#include "Storylets/StoryletValue.h"

#include <string>

#include "StoryletWorld.generated.h"

namespace storylets { struct WorldResolver; }
struct FStoryletWorldImpl;

/** Fired on every change to a bound world: the host's own writes (bFromStory
 *  false) and the story's outcome writes (true). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FStoryletWorldChanged,
	const FString&, Name, const FStoryletValue&, Value, bool, bFromStory);

/** The GAME's @world container, bound to an engine at UStoryletEngine::Create
 *  (design/flows.md: @world is foreign; the engine reads and writes it through
 *  the host and never carries it in a save). Without one the engine self-backs
 *  @world from the declared defaults, which is fine for a run that never
 *  leaves the engine; bind one when the game, Patterplay and the story share
 *  values, as the Hamlet demo does.
 *
 *  Two read-only ideas meet here and stay distinct (design/Reboot.md 10):
 *  a `writable: false` declaration is the STORY's promise, checked by the
 *  compiler and refused by the engine; SetReadOnly here is the GAME's policy,
 *  refusing a story write with a thrown error that the wrapper's guarded calls
 *  turn into a false-and-message. The host's own Set* calls are never bound
 *  by either. The JS client, Godot and Unity demos keep the same split. */
UCLASS(BlueprintType)
class STORYLETENGINERUNTIME_API UStoryletWorld : public UObject
{
	GENERATED_BODY()

public:
	UStoryletWorld();

	// --- the host's writes (never refused) ---------------------------------------

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	void SetBool(const FString& Name, bool bValue);
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	void SetNumber(const FString& Name, double Value);
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	void SetString(const FString& Name, const FString& Value);
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	void SetFlags(const FString& Name, const TArray<FString>& Values);

	// --- reads (the type's default when the name is unset) ----------------------

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	bool Has(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	bool GetValue(const FString& Name, FStoryletValue& OutValue) const;
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	bool GetBool(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	double GetNumber(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	FString GetString(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	TArray<FString> GetFlags(const FString& Name) const;
	/** Every name with a value, in first-set order. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	TArray<FString> Names() const;

	// --- the game's policy ---------------------------------------------------------

	/** Refuse story writes to this name (the game's alone: a clock, a flag the
	 *  engine only reads). The host's own writes and a load still land. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	void SetReadOnly(const FString& Name, bool bReadOnly);
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|World")
	bool IsReadOnly(const FString& Name) const;

	UPROPERTY(BlueprintAssignable, Category = "Storylet Engine|World")
	FStoryletWorldChanged OnChanged;

	// --- C++ seam (Blueprint never sees these) ------------------------------------

	/** The resolver handed to the core; weak on this object, so a world the
	 *  game dropped reads as unset rather than dangling. */
	storylets::WorldResolver MakeResolver();
	/** A read in core terms; false when unset. */
	bool Get(const std::string& Name, storylets::StoryletValue& OutValue) const;
	/** The host's write in core terms (never refused; fires OnChanged with
	 *  bFromStory false). A load restores through this. */
	void HostSet(const std::string& Name, const storylets::StoryletValue& Value);
	/** The story's write: refused with storylets::StoryletError when the name
	 *  is read-only here; otherwise lands and fires OnChanged (bFromStory true). */
	void StorySet(const std::string& Name, const storylets::StoryletValue& Value);

private:
	TPimplPtr<FStoryletWorldImpl> Impl;
};
