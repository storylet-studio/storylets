// Imports a compiled .storyletsc file into a UStoryletBundle asset.
//
//   - Drag-and-drop / File > Import: FactoryCreateFile reads the JSON and
//     stashes it on the asset verbatim; the compiled form is rebuilt from it.
//   - Reimport (right-click an existing asset): refreshes from the tracked
//     source file via FReimportHandler.
//
// A broken bundle still imports: the asset keeps the raw JSON with LoadError
// set and readable in the editor, so a bad export is a visible asset state,
// not a vanished import.
#pragma once

#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "EditorReimportHandler.h"
#include "StoryletBundleFactory.generated.h"

UCLASS(hidecategories = Object)
class UStoryletBundleFactory
	: public UFactory
	, public FReimportHandler
{
	GENERATED_BODY()

public:
	UStoryletBundleFactory();

	// UFactory
	virtual UObject* FactoryCreateFile(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags,
		const FString& Filename, const TCHAR* Parms, FFeedbackContext* Warn, bool& bOutOperationCanceled) override;
	virtual bool FactoryCanImport(const FString& Filename) override;

	// FReimportHandler
	virtual bool CanReimport(UObject* Obj, TArray<FString>& OutFilenames) override;
	virtual void SetReimportPaths(UObject* Obj, const TArray<FString>& NewReimportPaths) override;
	virtual EReimportResult::Type Reimport(UObject* Obj) override;
};
