using UnrealBuildTool;

public class StoryletEngineDemo : ModuleRules
{
	public StoryletEngineDemo(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		// UMG / Slate / SlateCore / InputCore are here for the Board demo, which
		// builds its whole clickable widget tree in C++. The plugin itself needs
		// none of them: this is the sample project's dependency, not the
		// runtime's, and it is the only Unreal-specific note in the four Board
		// demos (there is no keyboard fallback to record - the demo is clicks
		// only, as the other three runtimes are).
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"Slate",
			"SlateCore",
			"UMG",
			"StoryletEngineRuntime",
		});
	}
}
