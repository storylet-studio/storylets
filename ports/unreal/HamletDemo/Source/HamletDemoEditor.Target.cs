using UnrealBuildTool;
public class HamletDemoEditorTarget : TargetRules
{
	public HamletDemoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("HamletDemo");
	}
}
