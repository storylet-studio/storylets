using UnrealBuildTool;

public class StoryletEngineDemoEditorTarget : TargetRules
{
	public StoryletEngineDemoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StoryletEngineDemo");
	}
}
