#include "Modules/ModuleManager.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Docking/TabManager.h"
#include "PropertyEditorModule.h"
#include "Widgets/Docking/SDockTab.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"

#include "SStoryletStatePanel.h"
#include "StoryletBundle.h"
#include "StoryletBundleDetails.h"

#define LOCTEXT_NAMESPACE "StoryletEngineEditor"

static const FName StoryletStateTabName(TEXT("StoryletEngineRuntimeState"));
static const FName StoryletBundleClassName(TEXT("StoryletBundle"));

// The editor module registers two things: a nomad tab (Window menu, under
// Tools) hosting the Runtime State examiner for live Storylet Engine sessions,
// and the details customisation that turns a selected .storyletsc asset into
// the read-only bundle inspector (design 2, piece 6). The .storyletsc import
// factory is a self-registering UCLASS, so it needs nothing here beyond the
// module existing.
class FStoryletEngineEditorModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
			StoryletStateTabName,
			FOnSpawnTab::CreateRaw(this, &FStoryletEngineEditorModule::SpawnStateTab))
			.SetDisplayName(LOCTEXT("RuntimeStateTitle", "Storylet Engine Runtime State"))
			.SetTooltipText(LOCTEXT("RuntimeStateTip",
				"Watch and edit the properties, turns and board of live Storylet Engine sessions."))
			.SetGroup(WorkspaceMenu::GetMenuStructure().GetToolsCategory());

		FPropertyEditorModule& PropertyEditor =
			FModuleManager::LoadModuleChecked<FPropertyEditorModule>("PropertyEditor");
		PropertyEditor.RegisterCustomClassLayout(
			StoryletBundleClassName,
			FOnGetDetailCustomizationInstance::CreateStatic(&FStoryletBundleDetails::MakeInstance));
		PropertyEditor.NotifyCustomizationModuleChanged();
	}

	virtual void ShutdownModule() override
	{
		if (FSlateApplication::IsInitialized())
		{
			FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(StoryletStateTabName);
		}
		if (FModuleManager::Get().IsModuleLoaded("PropertyEditor"))
		{
			FPropertyEditorModule& PropertyEditor =
				FModuleManager::GetModuleChecked<FPropertyEditorModule>("PropertyEditor");
			PropertyEditor.UnregisterCustomClassLayout(StoryletBundleClassName);
			PropertyEditor.NotifyCustomizationModuleChanged();
		}
	}

private:
	TSharedRef<SDockTab> SpawnStateTab(const FSpawnTabArgs&)
	{
		return SNew(SDockTab)
			.TabRole(ETabRole::NomadTab)
			[
				SNew(SStoryletStatePanel)
			];
	}
};

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FStoryletEngineEditorModule, StoryletEngineEditor);
