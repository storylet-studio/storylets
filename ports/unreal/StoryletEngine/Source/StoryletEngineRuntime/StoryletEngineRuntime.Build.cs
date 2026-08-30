using UnrealBuildTool;

public class StoryletEngineRuntime : ModuleRules
{
	public StoryletEngineRuntime(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		// The pure C++ engine under Public/Storylets is header-only std code. Keep this
		// module out of unity (jumbo) builds so each .cpp is its own translation unit.
		bUseUnity = false;

		// The engine uses the C++ standard library (std::string / std::vector / ...). Allow
		// exceptions for its StoryletError / EvalError use (the Patterplay precedent).
		bEnableExceptions = true;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"Json",
		});

		// The Live Link (FStoryletLiveLink) is a debug-only tool: pull in the WebSockets module
		// everywhere EXCEPT Shipping, where the client compiles to no-ops (#if !UE_BUILD_SHIPPING),
		// exactly as Patterplay's debug link does.
		if (Target.Configuration != UnrealTargetConfiguration.Shipping)
		{
			PrivateDependencyModuleNames.Add("WebSockets");
		}
	}
}
