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
	UButton* MakeButton(const FString& Label);
	UTextBlock* MakeLabel(const FString& Text, float Size);
	UHamletClickProxy* MakeProxy(const FString& Kind, const FString& Id, const FString& GameId, const FString& Title);
};
