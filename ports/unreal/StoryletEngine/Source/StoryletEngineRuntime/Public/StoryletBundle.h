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
