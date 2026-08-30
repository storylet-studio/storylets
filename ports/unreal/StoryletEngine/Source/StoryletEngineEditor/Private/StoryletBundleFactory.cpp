#include "StoryletBundleFactory.h"

#include "StoryletBundle.h"

#include "EditorFramework/AssetImportData.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogStoryletBundleFactory, Log, All);

namespace
{
	void TrackSourceFile(UStoryletBundle* Bundle, const FString& Filename)
	{
		if (!Bundle->AssetImportData)
		{
			Bundle->AssetImportData = NewObject<UAssetImportData>(Bundle, TEXT("AssetImportData"));
		}
		Bundle->AssetImportData->Update(Filename);
	}
}

UStoryletBundleFactory::UStoryletBundleFactory()
{
	bCreateNew = false;      // can't create blank; must import a file
	bEditorImport = true;
	bText = true;            // JSON is text
	SupportedClass = UStoryletBundle::StaticClass();
	Formats.Add(TEXT("storyletsc;Storylet Engine compiled bundle"));
}

bool UStoryletBundleFactory::FactoryCanImport(const FString& Filename)
{
	return Filename.EndsWith(TEXT(".storyletsc"));
}

UObject* UStoryletBundleFactory::FactoryCreateFile(UClass* InClass, UObject* InParent, FName InName,
	EObjectFlags Flags, const FString& Filename, const TCHAR* /*Parms*/, FFeedbackContext* /*Warn*/,
	bool& bOutOperationCanceled)
{
	bOutOperationCanceled = false;

	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Filename))
	{
		UE_LOG(LogStoryletBundleFactory, Error, TEXT("Failed to read source file: %s"), *Filename);
		return nullptr;
	}

	UStoryletBundle* Bundle = NewObject<UStoryletBundle>(InParent, InClass, InName, Flags);
	Bundle->SourceJson = Json;
	if (!Bundle->Rebuild())
	{
		// A broken bundle still imports; the error stays readable on the asset.
		UE_LOG(LogStoryletBundleFactory, Error,
			TEXT("'%s' imported with errors - %s"), *InName.ToString(), *Bundle->LoadError);
	}
	TrackSourceFile(Bundle, Filename);
	return Bundle;
}

bool UStoryletBundleFactory::CanReimport(UObject* Obj, TArray<FString>& OutFilenames)
{
	UStoryletBundle* Bundle = Cast<UStoryletBundle>(Obj);
	if (!Bundle || !Bundle->AssetImportData) return false;
	Bundle->AssetImportData->ExtractFilenames(OutFilenames);
	return true;
}

void UStoryletBundleFactory::SetReimportPaths(UObject* Obj, const TArray<FString>& NewReimportPaths)
{
	UStoryletBundle* Bundle = Cast<UStoryletBundle>(Obj);
	if (!Bundle || NewReimportPaths.Num() == 0) return;
	if (!Bundle->AssetImportData)
	{
		Bundle->AssetImportData = NewObject<UAssetImportData>(Bundle, TEXT("AssetImportData"));
	}
	Bundle->AssetImportData->UpdateFilenameOnly(NewReimportPaths[0]);
}

EReimportResult::Type UStoryletBundleFactory::Reimport(UObject* Obj)
{
	UStoryletBundle* Bundle = Cast<UStoryletBundle>(Obj);
	if (!Bundle || !Bundle->AssetImportData) return EReimportResult::Failed;

	const FString Filename = Bundle->AssetImportData->GetFirstFilename();
	if (Filename.IsEmpty() || !FPaths::FileExists(Filename))
	{
		UE_LOG(LogStoryletBundleFactory, Warning,
			TEXT("Reimport failed: source file not found at '%s'"), *Filename);
		return EReimportResult::Failed;
	}

	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Filename))
	{
		return EReimportResult::Failed;
	}
	Bundle->SourceJson = Json;
	if (!Bundle->Rebuild())
	{
		// Keep the asset (raw JSON + readable LoadError) but report the failure.
		UE_LOG(LogStoryletBundleFactory, Error,
			TEXT("Reimport: '%s' compiled with errors - %s"), *Bundle->GetName(), *Bundle->LoadError);
	}
	Bundle->AssetImportData->Update(Filename);
	Bundle->MarkPackageDirty();
	return EReimportResult::Succeeded;
}
