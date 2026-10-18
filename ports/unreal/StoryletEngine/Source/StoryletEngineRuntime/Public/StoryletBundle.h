// A compiled .storyletsc bundle imported as a UDataAsset. The asset persists
// the raw source JSON verbatim (never re-serialised); the compiled
// storylets::Bundle is rebuilt in PostLoad behind a Pimpl, so the engine's
// std model stays out of UE headers. A broken bundle still imports, with the
// error readable on the asset (LoadError). Create a UStoryletEngine on it
// to play.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Templates/PimplPtr.h"
#include "StoryletTypes.h"
#include "StoryletBundle.generated.h"

class UAssetImportData;

/** Pimpl holder for the compiled storylets::Bundle (defined in the module's
 *  private StoryletCompiledBundle.h; shared with the session wrapper). */
struct FStoryletCompiledBundle;

UCLASS(BlueprintType)
class STORYLETENGINERUNTIME_API UStoryletBundle : public UDataAsset
{
	GENERATED_BODY()

public:
	/** The compiled .storyletsc JSON, persisted verbatim into the asset and
	 *  re-compiled on load. */
	UPROPERTY(VisibleAnywhere, AdvancedDisplay, Category = "Storylet Engine")
	FString SourceJson;

	/** Empty when the bundle compiled cleanly; otherwise the parse/load
	 *  error, readable on the asset (a broken bundle still imports). */
	UPROPERTY(VisibleAnywhere, Category = "Storylet Engine")
	FString LoadError;

#if WITH_EDITORONLY_DATA
	/** Tracks the source .storyletsc file so reimport can refresh from disk. */
	UPROPERTY(VisibleAnywhere, Instanced, Category = "Storylet Engine")
	TObjectPtr<UAssetImportData> AssetImportData;
#endif

	/** Compile a transient bundle from a JSON string (the DLC side door: a
	 *  .storyletsc fetched or read at runtime, no asset import involved).
	 *  Returns nullptr with OutError set on a parse/compile failure. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine",
		meta = (DisplayName = "Load Storylet Bundle From JSON String"))
	static UStoryletBundle* LoadFromJsonString(const FString& Json, FString& OutError);

	/** True when the compiled bundle is present (SourceJson compiled cleanly). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	bool IsCompiled() const;

	/** The bundle's content identity (content.project), empty when uncompiled. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetProject() const;

	/** The build identity (content.hash) a Live Link reports to the editor,
	 *  empty when uncompiled or unhashed. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetBuildId() const;

	/** The bundle inspector's runtime half (design/engine-runtimes.md 2, piece
	 *  6): what a host may call, read from this asset alone - no session, no
	 *  state, no game running. Identity, the Deal() surface (hands), the Peek()
	 *  criteria surface (tag groups + tags), the declared property scopes, and
	 *  counts for orientation. An empty description when uncompiled (check
	 *  LoadError). Blueprint-callable because integrators are the audience: the
	 *  editor's details view is one reading of it, a startup check that a hand
	 *  name still exists is another. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine",
		meta = (DisplayName = "Describe Bundle"))
	FStoryletBundleDescription DescribeBundle() const;

	/** A dealt card's fields with every field the box's card template
	 *  declares filled in from its default where the card sets none (a card's
	 *  own Fields hold only what it sets, so "sets nothing" and "sets the
	 *  default" stay apart). Then any field with no declaration, as it is. Box
	 *  is the box's gameId (or id); an unknown box declares nothing. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Fields")
	TArray<FStoryletFieldEntry> GetEffectiveCardFields(const FString& Box, const TArray<FStoryletFieldEntry>& Fields) const;

	/** The same for an outcome's fields, against the box's outcome fields. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Fields")
	TArray<FStoryletFieldEntry> GetEffectiveOutcomeFields(const FString& Box, const TArray<FStoryletFieldEntry>& Fields) const;

	/** The declaration of the card field (or, with bOutcomeField, the outcome
	 *  field) named Field in Box, in OutDecl. False when Box declares no such
	 *  field. Hand a quality field's to the Storylet stage functions to compare
	 *  or step its stage. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Fields")
	bool GetFieldDecl(const FString& Box, const FString& Field, bool bOutcomeField, FStoryletFieldDecl& OutDecl) const;

	/** One extension's values on a node with every field the extension
	 *  declares for that node kind filled in from its default where the node
	 *  sets none, then any value with no declaration, as it is (the extension
	 *  counterpart of GetEffectiveCardFields). Kind is the node kind: card,
	 *  outcome, box, deck, tagGroup, tag, handTemplate, hand or project.
	 *  Extensions is the node's raw list, as a dealt card, an outcome, a box
	 *  view or ExtensionsOf hands it over. An extension this bundle does not
	 *  carry declares nothing. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	TArray<FStoryletExtensionEntry> GetEffectiveExtensionValues(const FString& Kind, const FString& Extension,
		const TArray<FStoryletExtensionValues>& Extensions) const;

	/** A node's extension values read off the bundle, raw, by the name a game
	 *  already holds: project (no address); box, deck, card and hand by
	 *  gameId; handTemplate as "box/template"; outcome as "card/outcome";
	 *  tagGroup and tag as "box/name", or the bare name for the project map's.
	 *  Empty when the node has none, the address names nothing or the kind is
	 *  unknown. For the nodes no view carries (a deck, a hand, a tag). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	TArray<FStoryletExtensionValues> ExtensionsOf(const FString& Kind, const FString& Address) const;

	/** One extension's settings, every one its manifest declares, as the
	 *  project resolved them: setting name to value. Empty when the bundle
	 *  carries no such extension or it has no settings. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	TMap<FString, FString> ExtensionSettings(const FString& Extension) const;

	/** The declaration of the field named Field that Extension declares for
	 *  node kind Kind, in OutDecl (its default in DefaultJson, and in Default
	 *  as well when it is a scalar). False when no such field is declared.
	 *  Hand a quality field's to the Storylet stage functions to compare or
	 *  step its stage. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	bool GetExtensionFieldDecl(const FString& Extension, const FString& Kind, const FString& Field,
		FStoryletFieldDecl& OutDecl) const;

	/** One extension field's value, as JSON text, in OutJson: the entry named
	 *  Field under Extension in a node's list. False when the node sets none
	 *  (pass the list through GetEffectiveExtensionValues first to see the
	 *  default instead). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	static bool FindExtensionValue(const TArray<FStoryletExtensionValues>& Extensions, const FString& Extension,
		const FString& Field, FString& OutJson);

	/** An extension value's JSON text as a Storylet value, when it is one: a
	 *  boolean, a number, a string, or a list of strings (as flags). False for
	 *  a record, a map, any other list, null, or text that is not JSON. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Extensions")
	static bool ExtensionValueToScalar(const FString& Json, FStoryletValue& OutValue);

	/** (Re)compile SourceJson into the cached storylets::Bundle. Sets or
	 *  clears LoadError; returns false on failure (the raw JSON is kept
	 *  either way). Called by the importer and PostLoad. */
	bool Rebuild();

	virtual void PostLoad() override;

	/** The compiled bundle behind the Pimpl; null when uncompiled. In-module
	 *  C++ access only (the session wrapper); Blueprint never sees it. */
	FStoryletCompiledBundle* GetCompiled() const { return Compiled.Get(); }

private:
	TPimplPtr<FStoryletCompiledBundle> Compiled;
};
