using UnrealBuildTool;
public class HamletDemoTarget : TargetRules
{
	public HamletDemoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("HamletDemo");
	}
}
