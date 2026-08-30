using UnrealBuildTool;

public class StoryletEngineEditor : ModuleRules
{
	public StoryletEngineEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		// The state panel's Save/Load path rides the runtime module's
		// exception-reporting boundary - same setting as the runtime module.
		bEnableExceptions = true;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"UnrealEd",
			"StoryletEngineRuntime",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"InputCore",
			"WorkspaceMenuStructure",
			"PropertyEditor",    // the bundle inspector's details customisation
			"DesktopPlatform",   // native Save/Load file dialogs on the state panel
			"ApplicationCore",   // clipboard for the log panel's Copy button
		});
	}
}
