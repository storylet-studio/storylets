// The Hamlet's screen, a UUserWidget built in C++ with no .uasset and no
// Blueprint, as the Board demo is: places across the top, the stage (the hand,
// or the conversation), a footer, a log. All the game is FHamletGame; this
// draws it and forwards clicks.
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "HamletGame.h"
#include "HamletWidget.generated.h"

class UVerticalBox; class UHorizontalBox; class UTextBlock; class UButton; class UHamletWidget;

/** UButton::OnClicked carries no payload, so each place, card and option button gets one of these. */
UCLASS()
class UHamletClickProxy : public UObject
{
	GENERATED_BODY()
public:
	UPROPERTY() TObjectPtr<UHamletWidget> Owner = nullptr;
	UPROPERTY() FString Kind;    // place | card | option
	UPROPERTY() FString Id;      // hand gameId | card id | option id
	UPROPERTY() FString GameId;  // card gameId (card only)
	UPROPERTY() FString Title;
	UFUNCTION() void OnClicked();
};

UCLASS()
class HAMLETDEMO_API UHamletWidget : public UUserWidget
{
	GENERATED_BODY()
public:
	virtual void NativeOnInitialized() override;
	void Clicked(const UHamletClickProxy& P);
	UFUNCTION() void OnWaitClicked();
	UFUNCTION() void OnLeaveClicked();
	UFUNCTION() void OnRestartClicked();

private:
	FHamletGame Game;
	FString SavePath;
	UPROPERTY() TObjectPtr<UTextBlock> Header;
	UPROPERTY() TObjectPtr<UHorizontalBox> PlacesRow;
	UPROPERTY() TObjectPtr<UVerticalBox> Stage;
	UPROPERTY() TObjectPtr<UTextBlock> LogText;
	UPROPERTY() TArray<TObjectPtr<UHamletClickProxy>> Proxies;

	void Refresh();
	void Save();
	UButton* MakeButton(const FString& Label, bool bWide = false, bool bSelected = false);
	UTextBlock* MakeLabel(const FString& Text, float Size, const FLinearColor& Colour, bool bItalic = false);
	void AddToRow(UHorizontalBox* Row, UButton* B);
	void AddToStage(UButton* B);

	// One small palette, so the panel reads as a decision rather than as defaults.
	static constexpr FLinearColor Panel{0.04f, 0.04f, 0.05f, 0.96f};   // behind everything
	static constexpr FLinearColor Ink{0.91f, 0.90f, 0.87f, 1.f};       // speech, titles, button labels
	static constexpr FLinearColor Dim{0.63f, 0.62f, 0.59f, 1.f};       // narration, the header, the log
	static constexpr FLinearColor Face{0.17f, 0.18f, 0.20f, 1.f};      // a button against the panel
	static constexpr FLinearColor Accent{0.44f, 0.64f, 0.57f, 1.f};    // the place you are standing in
	static constexpr FLinearColor OnAccent{0.05f, 0.07f, 0.07f, 1.f};  // its label, dark enough to read on that
	UHamletClickProxy* MakeProxy(const FString& Kind, const FString& Id, const FString& GameId, const FString& Title);
};
