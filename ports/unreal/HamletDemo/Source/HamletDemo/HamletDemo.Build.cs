using UnrealBuildTool;
public class HamletDemo : ModuleRules
{
	public HamletDemo(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore", "UMG", "Json",
			"StoryletEngineRuntime",   // the Storylet Engine plugin (sibling folder)
			"PatterplayRuntime",       // Patter's plugin (sibling folder, from its pinned release)
		});
	}
}
