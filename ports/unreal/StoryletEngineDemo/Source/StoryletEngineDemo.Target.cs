using UnrealBuildTool;

public class StoryletEngineDemoTarget : TargetRules
{
	public StoryletEngineDemoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StoryletEngineDemo");
	}
}
