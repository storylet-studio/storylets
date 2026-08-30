// The Board demo: the second Storylet Engine Unreal demo, and the one that
// shows the loop. It deals the village board into clickable UMG buttons: click
// a card to see its outcomes, click an available outcome to play it, and every
// action lands as a line in the transcript pane (and in the Output Log, which
// mirrors it). The same Board demo ships for Godot, Unity and JavaScript with
// the same on-screen content, the same control labels and the same transcript
// grammar, so the four read as one demo in four idioms.
//
// The smallest possible integration is CreateBoardSession() plus
// OnDealAllHandsClicked(): load the bundle, create a session, deal, read
// Board(). Everything else here is the UI around that handful of calls, and
// those two functions are the thing to copy into your own game.
//
// The bundle is Demos/the-hamlet.storyletsc, read straight from disk beside
// the project: no import, no asset. Seed 7, retained log on, and the session
// is registered with the editor examiner under the label "board demo", so
// Window > Storylet Engine Runtime State follows the play.
//
// Outside Shipping the demo also opens a Live Link to Storyletter
// (FStoryletLiveLink, ws://127.0.0.1:4472): with the editor listening, its
// Board mirrors this one, and a save in the editor pushes the new bundle
// into the running demo, which applies it in place and carries the run
// across. Nothing listening is a silent no-op.
//
// To run it: the project's default game mode is still the minimal demo, so
// pick the Board demo in Project Settings > Maps & Modes > Default GameMode
// (choose StoryletBoardDemoGameMode) and press Play. From a command line, add
// ?game=/Script/StoryletEngineDemo.StoryletBoardDemoGameMode to the map URL.
//
// The widget builds its whole tree in C++ (no .uasset, no Blueprint, no UMG
// designer), which is why this sample project ships source-only.
//
// This sample project is a demo shell and is freely deletable.
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "StoryletBoardDemoWidget.generated.h"

class UBorder;
class UButton;
class UScrollBox;
class UStoryletBundle;
class UStoryletEngine;
class UStoryletFlow;
class UTextBlock;
class UVerticalBox;
class UStoryletBoardDemoWidget;
class FStoryletLiveLink;

/** UButton::OnClicked carries no payload, so every card and outcome button
 *  gets one of these: a tiny UObject holding the identifiers that click means,
 *  with a handler that calls back into the widget. The widget keeps them alive
 *  in a UPROPERTY array and throws them away whenever it rebuilds the board. */
UCLASS()
class UStoryletBoardClickProxy : public UObject
{
	GENERATED_BODY()

public:
	UPROPERTY()
	TObjectPtr<UStoryletBoardDemoWidget> Owner = nullptr;

	/** The hand this card sits in (its gameId, as Board() keys it). */
	UPROPERTY()
	FString Hand;

	UPROPERTY()
	FString CardGameId;

	/** The card's title-or-gameId, captured while it is still on the board so
	 *  the transcript line can name it after the play removes it. */
	UPROPERTY()
	FString CardLabel;

	/** Empty on a card button; set on an outcome button. */
	UPROPERTY()
	FString OutcomeGameId;

	UPROPERTY()
	FString OutcomeLabel;

	UFUNCTION()
	void OnClicked();
};

/**
 * The Board demo's screen: header, the board as clickable hands of cards, the
 * three controls, and the transcript.
 */
UCLASS()
class STORYLETENGINEDEMO_API UStoryletBoardDemoWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	/** The seed every Board demo runs on, so the four runtimes deal alike. */
	static constexpr int32 BoardSeed = 7;

	virtual void NativeOnInitialized() override;
	virtual void NativeDestruct() override;

	// --- the handlers behind the three controls -----------------------------

	UFUNCTION()
	void OnDealAllHandsClicked();

	UFUNCTION()
	void OnNextTurnClicked();

	UFUNCTION()
	void OnRestartClicked();

	// --- the handlers behind the board's own buttons ------------------------

	/** Reveal this card's outcomes, or collapse them when it is already open.
	 *  Only one card is open at a time. */
	void SelectCard(const FString& InHand, const FString& InCardGameId);

	/** Play one outcome of one card. Labels come from the click proxy so the
	 *  transcript can name what has just left the board. */
	void PlayOutcome(const FString& InHand, const FString& InCardGameId, const FString& InCardLabel,
		const FString& InOutcomeGameId, const FString& InOutcomeLabel);

	// --- the headless driver ------------------------------------------------

	/** Walk the demo through one round of its own handlers: deal, open the
	 *  first card, play its first available outcome, next turn, restart. The
	 *  storylet.BoardDemo.Drive console command calls this, which is how a
	 *  -game -nullrhi run exercises a click-driven demo (no mouse involved,
	 *  the same functions the buttons call). */
	void DriveOnce();

	/** The widget the HUD put on screen, or a fresh one built on the first
	 *  local player controller when nothing is on screen (a headless run has
	 *  no viewport, but CreateWidget still gives the demo a player context and
	 *  runs its initialisation). */
	static UStoryletBoardDemoWidget* FindOrCreateForDriving();

private:
	// --- session ------------------------------------------------------------

	void CreateBoardSession();
	void DropBoardSession();

	/** Board() keys hands by gameId and the header names the project, both
	 *  from the bundle description: read once per bundle (and again after a
	 *  live refresh swaps the bundle). */
	void ReadBundleLabels();

	/** The Live Link to Storyletter: opened once, attached to each session the
	 *  demo creates, closed with the widget. A no-op in Shipping, where the
	 *  whole client compiles out. */
	void AttachLiveLink();

	/** Rooted while the widget lives: the session and the bundle it plays. */
	UPROPERTY()
	TObjectPtr<UStoryletEngine> Engine = nullptr;

	UPROPERTY()
	TObjectPtr<UStoryletFlow> Session = nullptr;

	UPROPERTY()
	TObjectPtr<UStoryletBundle> Bundle = nullptr;

	TSharedPtr<FStoryletLiveLink> LiveLink;

	/** Hand gameId -> title, read from the bundle description once: Board()
	 *  keys hands by gameId, and the board labels want title-or-gameId. */
	TMap<FString, FString> HandTitles;

	FString ProjectLabel;
	FString VersionLabel;

	/** The header line as last built, kept so it can be logged as well as shown. */
	FString HeaderLine;

	/** The one open card, empty when none is open. */
	FString OpenHand;
	FString OpenCardGameId;

	// --- UI -----------------------------------------------------------------

	void BuildUI();
	/** Re-deal every hand after the world moves (a play, a turn). */
	void Refill();
	void RefreshHeader();
	void RefreshBoard();
	void AppendTranscript(const FString& Line);
	void ClearTranscript();

	FString HandLabel(const FString& HandGameId) const;

	UTextBlock* MakeLabel(const FString& Text, float Size, FLinearColor Colour);
	UButton* MakeButton(const FString& Label, FLinearColor Background);
	UStoryletBoardClickProxy* MakeProxy(const FString& InHand, const FString& InCardGameId, const FString& InCardLabel);

	UPROPERTY()
	TObjectPtr<UTextBlock> HeaderText = nullptr;

	/** The board's rebuilt half: cleared and refilled on every refresh. */
	UPROPERTY()
	TObjectPtr<UScrollBox> BoardScroll = nullptr;

	UPROPERTY()
	TObjectPtr<UScrollBox> TranscriptScroll = nullptr;

	/** Alive as long as the buttons they belong to. */
	UPROPERTY()
	TArray<TObjectPtr<UStoryletBoardClickProxy>> ClickProxies;

	static TWeakObjectPtr<UStoryletBoardDemoWidget> ActiveWidget;
};
