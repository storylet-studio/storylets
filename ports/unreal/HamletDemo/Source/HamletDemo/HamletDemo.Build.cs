using UnrealBuildTool;
public class HamletDemo : ModuleRules
{
	public HamletDemo(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		// HamletGame.h includes Patterplay's std C++ core (Patter/Engine.h), whose expression kernel
		// throws; any module including a kernel header needs this. A Mac build compiles with
		// exceptions whatever this says, so only a Windows or Linux build would catch its absence.
		bEnableExceptions = true;
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore", "UMG", "Json",
			"StoryletEngineRuntime",   // the Storylet Engine plugin (sibling folder)
			"PatterplayRuntime",       // Patter's plugin (sibling folder, from its pinned release)
		});
	}
}
