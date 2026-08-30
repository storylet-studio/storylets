// The "Storylet Engine Runtime State" editor panel: lists sessions registered
// via FStoryletDebug and, for each, the examiner - Save/Load State buttons,
// its declared properties with type-aware editors (toggle / number / text /
// enum / flags) behind a search filter, per-row reset-to-default, the
// read-only turns (per box, title-or-gameId) and board sections, and the
// session's retained log (design 2.3; the old port's SStoryletEngineLogPanel
// is the high-water mark) behind per-kind filters with Autoscroll, Copy and
// Clear. The Slate parity of the Unity Runtime State window / Godot state
// panel; the PIE attach/detach and search-filter patterns lifted from the
// old port's inspector, re-based on the debug registry (weak pointers, so
// PIE teardown detaches cleanly without GC rooting).
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

class SVerticalBox;
class UStoryletEngine;
class UStoryletFlow;
struct FStoryletPropertyView;

class SStoryletStatePanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SStoryletStatePanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual ~SStoryletStatePanel() override;

	// Save/Load the whole run to a .storyletsave file (the tagged
	// storylets/savefile@1 file). Static: the buttons capture only a weak
	// session.
	static void SaveStateToFile(UStoryletEngine* Engine);
	static void LoadStateFromFile(UStoryletEngine* Engine);

private:
	// Repopulate the whole list from the current registry. Cheap: run only
	// when the set of sessions or their structure changes; steady-state value
	// updates ride on the per-widget bound getters.
	void Rebuild();

	// A fingerprint of the session list + each session's property paths and
	// box/hand structure (values excluded), used to detect when a Rebuild()
	// is actually needed.
	FString Signature() const;

	// One property's row: label, a type-aware editor, and a reset button.
	TSharedRef<SWidget> BuildRow(TWeakObjectPtr<UStoryletFlow> Session, const FStoryletPropertyView& Row);

	EActiveTimerReturnType OnRefresh(double InCurrentTime, float InDeltaTime);

	// PIE attach/detach (lifted from the old inspector): the registry is the
	// truth, but rebuilding on these edges makes attach/detach immediate
	// instead of waiting out the poll interval.
	void HandlePostPIEStarted(bool bIsSimulating);
	void HandleEndPIE(bool bIsSimulating);

	TSharedPtr<SVerticalBox> Body;
	FString LastSignature;
	FString FilterText;
	FDelegateHandle ChangedHandle;
	FDelegateHandle PostPIEStartedHandle;
	FDelegateHandle EndPIEHandle;

	// Enum option lists must outlive their SComboBox; rebuilt whenever the
	// panel is (the old port's EnumSources lesson).
	TArray<TSharedRef<TArray<TSharedPtr<FString>>>> EnumSources;
};
