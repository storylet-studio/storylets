#include "StoryletBoardDemoWidget.h"
#include "StoryletDebug.h"

#include "StoryletBundle.h"
#include "StoryletLiveLink.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"

#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/ScrollBox.h"
#include "Components/ScrollBoxSlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

TWeakObjectPtr<UStoryletBoardDemoWidget> UStoryletBoardDemoWidget::ActiveWidget;

namespace BoardPalette
{
	static const FLinearColor Backdrop = FLinearColor(0.051f, 0.067f, 0.090f, 1.f);
	static const FLinearColor Panel    = FLinearColor(0.082f, 0.102f, 0.133f, 1.f);
	static const FLinearColor TextMain = FLinearColor(0.788f, 0.820f, 0.851f, 1.f);
	static const FLinearColor Muted    = FLinearColor(0.545f, 0.580f, 0.620f, 1.f);
	static const FLinearColor Accent   = FLinearColor(0.941f, 0.800f, 0.533f, 1.f);
	static const FLinearColor BtnCard  = FLinearColor(0.129f, 0.149f, 0.176f, 1.f);
	static const FLinearColor BtnPlay  = FLinearColor(0.137f, 0.525f, 0.212f, 1.f);
	static const FLinearColor BtnCtrl  = FLinearColor(0.106f, 0.212f, 0.353f, 1.f);
}

/** Title-or-gameId: the name every surface of the engine shows a player, and
 *  never the internal id. */
static FString TitleOr(const FString& Title, const FString& GameId)
{
	return Title.IsEmpty() ? GameId : Title;
}

static FString TurnPart(const FStoryletBoxView& Box)
{
	return FString::Printf(TEXT("%s turn %d"), *TitleOr(Box.Title, Box.GameId), FMath::RoundToInt(Box.Turn));
}

// --- the click proxy -----------------------------------------------------------

void UStoryletBoardClickProxy::OnClicked()
{
	if (!Owner) return;

	if (OutcomeGameId.IsEmpty())
	{
		Owner->SelectCard(Hand, CardGameId);
	}
	else
	{
		Owner->PlayOutcome(Hand, CardGameId, CardLabel, OutcomeGameId, OutcomeLabel);
	}
}

// --- lifecycle ----------------------------------------------------------------

void UStoryletBoardDemoWidget::NativeOnInitialized()
{
	Super::NativeOnInitialized();

	ActiveWidget = this;

	CreateBoardSession();
	BuildUI();
	RefreshHeader();
	RefreshBoard();

	// The demo announcing itself, once: the Output Log then carries the header
	// as well as every transcript line, so a headless run reads like the screen.
	UE_LOG(LogTemp, Display, TEXT("board demo: %s"), *HeaderLine);

	// The board opens dealt: the first hands are already out, so there is
	// something to read and play the moment the demo starts.
	OnDealAllHandsClicked();
}

void UStoryletBoardDemoWidget::NativeDestruct()
{
	DropBoardSession();
	if (LiveLink.IsValid())
	{
		LiveLink->Close();
		LiveLink.Reset();
	}
	if (ActiveWidget.Get() == this)
	{
		ActiveWidget.Reset();
	}
	Super::NativeDestruct();
}

// --- session ------------------------------------------------------------------

void UStoryletBoardDemoWidget::CreateBoardSession()
{
	// The compiled bundle that ships beside the project, read straight from
	// disk: the same file the minimal demo loads.
	const FString Path = FPaths::Combine(FPaths::ProjectDir(), TEXT("Demos/the-hamlet.storyletsc"));
	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Path))
	{
		UE_LOG(LogTemp, Warning, TEXT("Board demo: could not read %s"), *Path);
		return;
	}

	FString Error;
	Bundle = UStoryletBundle::LoadFromJsonString(Json, Error);
	if (!Bundle)
	{
		UE_LOG(LogTemp, Error, TEXT("Board demo: bundle failed to compile - %s"), *Error);
		return;
	}

	// Seed 7 and the retained log on, so the examiner's log panel fills as the
	// board is played.
	Engine = UStoryletEngine::Create(Bundle, BoardSeed, /*bRetainLog=*/true);
	if (!Engine) return;
	// All play happens on a flow; a single-player demo opens one and never
	// thinks about it again (design/flows.md).
	Session = Engine->OpenFlow(TEXT("main"));
	if (!Session) return;

	Engine->RegisterForDebug(TEXT("board demo"));
	ReadBundleLabels();
	AttachLiveLink();
}

void UStoryletBoardDemoWidget::ReadBundleLabels()
{
	if (!Bundle) return;

	// Board() keys hands by gameId; the bundle description carries their
	// titles, and the identity the header line prints.
	const FStoryletBundleDescription Description = Bundle->DescribeBundle();
	ProjectLabel = Description.Identity.Project;
	VersionLabel = Description.Identity.Version;
	HandTitles.Reset();
	for (const FStoryletHandSummary& Hand : Description.Hands)
	{
		HandTitles.Add(Hand.GameId, Hand.Title);
	}
}

// The Live Link (design/live-link.md), the shape every game wires: open it
// with the build id, attach the flow, and leave it. OnBundle is the live
// refresh: the editor saved, so apply the pushed bundle in place (the engine
// and flow objects stay the same, the run carries across) and report the new
// build.
void UStoryletBoardDemoWidget::AttachLiveLink()
{
#if !UE_BUILD_SHIPPING
	if (!Session || !Bundle) return;

	if (!LiveLink.IsValid())
	{
		LiveLink = FStoryletLiveLink::Create(Bundle->GetBuildId(), ProjectLabel);
		FStoryletDebug::RegisterLink(LiveLink);   // the Runtime State panel shows where it is
		TWeakObjectPtr<UStoryletBoardDemoWidget> Weak(this);
		LiveLink->OnBundle = [Weak](const FString& Build, const FString& Data)
		{
			UStoryletBoardDemoWidget* Self = Weak.Get();
			if (!Self || !Self->Engine || !Self->LiveLink.IsValid()) return;

			FString Error;
			if (!FStoryletLiveLink::ApplyLiveBundle(Self->Engine, Data, Error))
			{
				Self->AppendTranscript(FString::Printf(TEXT("! live link: %s"), *Error));
				return;
			}
			Self->LiveLink->SetBuild(Build);

			// The session now plays the pushed bundle: re-read the labels from
			// it and show the table as it stands (a card the edit removed
			// leaves at the next deal; one it re-gated stays until then).
			Self->Bundle = Self->Engine->GetBundle();
			Self->ReadBundleLabels();
			Self->AppendTranscript(FString::Printf(TEXT("live link: applied build %s"), *Build));
			Self->RefreshHeader();
			Self->RefreshBoard();
		};
	}

	// A restart makes a fresh session on the bundle from disk: attach it, and
	// report its build in case a pushed one had moved the link on.
	LiveLink->Attach(Engine);
	LiveLink->SetBuild(Bundle->GetBuildId());
#endif
}

void UStoryletBoardDemoWidget::DropBoardSession()
{
	if (LiveLink.IsValid())
	{
		LiveLink->Detach();
	}
	if (Engine)
	{
		Engine->UnregisterForDebug();
	}
	Session = nullptr;
	Engine = nullptr;
	Bundle = nullptr;
	OpenHand.Empty();
	OpenCardGameId.Empty();
}

FString UStoryletBoardDemoWidget::HandLabel(const FString& HandGameId) const
{
	const FString* Title = HandTitles.Find(HandGameId);
	return TitleOr(Title ? *Title : FString(), HandGameId);
}

// --- controls -----------------------------------------------------------------

void UStoryletBoardDemoWidget::OnDealAllHandsClicked()
{
	if (!Session) return;

	// One call deals every hand; the returned dealt slice is exactly the hands
	// that changed, in the order the engine dealt them.
	const TArray<FStoryletHandContents> Dealt = Session->DealAllHands();
	for (const FStoryletHandContents& Hand : Dealt)
	{
		FString Cards;
		for (int32 i = 0; i < Hand.Cards.Num(); ++i)
		{
			if (i > 0) Cards += TEXT(", ");
			Cards += TitleOr(Hand.Cards[i].Title, Hand.Cards[i].GameId);
		}
		if (Cards.IsEmpty())
		{
			Cards = TEXT("(nothing here right now)");
		}
		AppendTranscript(FString::Printf(TEXT("dealt: %s <- %s"), *HandLabel(Hand.Hand), *Cards));
	}

	OpenHand.Empty();
	OpenCardGameId.Empty();
	RefreshHeader();
	RefreshBoard();
}

// The world moved, so the board does too: re-deal every hand, which fills the
// slots a play emptied and drops any card the new state invalidated. Silently,
// on purpose: the transcript keeps the beats you caused, and the arrivals and
// departures are already in the Runtime State tab's log panel.
void UStoryletBoardDemoWidget::Refill()
{
	if (Session)
	{
		// DealAllHands, not DealMany({}): an empty filter deals NO hands.
		Session->DealAllHands();
	}
	RefreshHeader();
	RefreshBoard();
}

void UStoryletBoardDemoWidget::OnNextTurnClicked()
{
	if (!Session) return;

	const TArray<FStoryletBoxView> Boxes = Session->ListBoxes();
	for (const FStoryletBoxView& Box : Boxes)
	{
		Session->AdvanceTurns(Box.GameId, 1);
		AppendTranscript(FString::Printf(TEXT("turn %s -> %d"),
			*TitleOr(Box.Title, Box.GameId), FMath::RoundToInt(Session->GetTurn(Box.GameId))));
	}

	// Time passed: cooldowns lapse, so the hands refresh too.
	Refill();
	RefreshHeader();
	RefreshBoard();
}

void UStoryletBoardDemoWidget::OnRestartClicked()
{
	DropBoardSession();
	CreateBoardSession();

	ClearTranscript();
	AppendTranscript(FString::Printf(TEXT("restarted (seed %d)"), BoardSeed));

	// A restart deals too, so the board is never empty.
	OnDealAllHandsClicked();
}

// --- the board's own buttons ---------------------------------------------------

void UStoryletBoardDemoWidget::SelectCard(const FString& InHand, const FString& InCardGameId)
{
	// Only one card is open at a time: clicking the open one shuts it.
	if (OpenHand == InHand && OpenCardGameId == InCardGameId)
	{
		OpenHand.Empty();
		OpenCardGameId.Empty();
	}
	else
	{
		OpenHand = InHand;
		OpenCardGameId = InCardGameId;
	}
	RefreshBoard();
}

void UStoryletBoardDemoWidget::PlayOutcome(const FString& InHand, const FString& InCardGameId, const FString& InCardLabel,
	const FString& InOutcomeGameId, const FString& InOutcomeLabel)
{
	if (!Session) return;

	FString Error;
	if (Session->Play(InCardGameId, InOutcomeGameId, InHand, Error))
	{
		AppendTranscript(FString::Printf(TEXT("played \"%s\" -> %s"), *InCardLabel, *InOutcomeLabel));
	}
	else
	{
		AppendTranscript(FString::Printf(TEXT("! %s"), *Error));
	}

	OpenHand.Empty();
	OpenCardGameId.Empty();
	Refill();
}

// --- UI construction ----------------------------------------------------------

void UStoryletBoardDemoWidget::BuildUI()
{
	if (!WidgetTree) return;

	UBorder* Backdrop = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Backdrop->SetBrushColor(BoardPalette::Backdrop);
	Backdrop->SetPadding(FMargin(20.f, 16.f, 20.f, 16.f));
	Backdrop->SetHorizontalAlignment(HAlign_Center);
	Backdrop->SetVerticalAlignment(VAlign_Top);
	WidgetTree->RootWidget = Backdrop;

	USizeBox* Column = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
	Column->SetWidthOverride(640.f);
	Backdrop->AddChild(Column);

	UVerticalBox* Root = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Column->AddChild(Root);

	// Title.
	{
		UTextBlock* Title = MakeLabel(TEXT("STORYLET ENGINE - BOARD DEMO"), 11.f, BoardPalette::Accent);
		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(Title);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 6.f));
	}

	// 1. The header line: project, version, and every box's turn.
	{
		HeaderText = MakeLabel(TEXT(""), 12.f, BoardPalette::TextMain);
		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(HeaderText);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 4.f));
	}

	// Where the examiner lives, said on screen as well as in the README.
	{
		UTextBlock* Hint = MakeLabel(
			TEXT("Window > Storylet Engine Runtime State shows this session live."), 9.f, BoardPalette::Muted);
		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(Hint);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f));
	}

	// 2 and 3. The board: hands, their dealt cards, and the open card's
	// outcomes. Rebuilt whole on every refresh.
	{
		UBorder* Frame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
		Frame->SetBrushColor(BoardPalette::Panel);
		Frame->SetPadding(FMargin(10.f, 8.f, 10.f, 8.f));

		USizeBox* Sized = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Sized->SetHeightOverride(320.f);

		BoardScroll = WidgetTree->ConstructWidget<UScrollBox>(UScrollBox::StaticClass());
		Sized->AddChild(BoardScroll);
		Frame->AddChild(Sized);

		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(Frame);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f));
	}

	// 4. The controls, in the shared order and with the shared labels.
	{
		UHorizontalBox* Controls = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());

		UButton* BtnDeal = MakeButton(TEXT("Deal all hands"), BoardPalette::BtnCtrl);
		BtnDeal->OnClicked.AddDynamic(this, &UStoryletBoardDemoWidget::OnDealAllHandsClicked);
		Controls->AddChildToHorizontalBox(BtnDeal)->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));

		UButton* BtnTurn = MakeButton(TEXT("Next turn"), BoardPalette::BtnCtrl);
		BtnTurn->OnClicked.AddDynamic(this, &UStoryletBoardDemoWidget::OnNextTurnClicked);
		Controls->AddChildToHorizontalBox(BtnTurn)->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));

		UButton* BtnRestart = MakeButton(TEXT("Restart"), BoardPalette::BtnCard);
		BtnRestart->OnClicked.AddDynamic(this, &UStoryletBoardDemoWidget::OnRestartClicked);
		Controls->AddChildToHorizontalBox(BtnRestart);

		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(Controls);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f));
	}

	// 5. The transcript: newest last, scrolled to the bottom.
	{
		UTextBlock* Caption = MakeLabel(TEXT("Transcript"), 9.f, BoardPalette::Muted);
		UVerticalBoxSlot* Slot = Root->AddChildToVerticalBox(Caption);
		Slot->SetPadding(FMargin(0.f, 0.f, 0.f, 4.f));
	}
	{
		UBorder* Frame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
		Frame->SetBrushColor(BoardPalette::Panel);
		Frame->SetPadding(FMargin(10.f, 8.f, 10.f, 8.f));

		USizeBox* Sized = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Sized->SetHeightOverride(180.f);

		TranscriptScroll = WidgetTree->ConstructWidget<UScrollBox>(UScrollBox::StaticClass());
		Sized->AddChild(TranscriptScroll);
		Frame->AddChild(Sized);

		Root->AddChildToVerticalBox(Frame);
	}
}

void UStoryletBoardDemoWidget::RefreshHeader()
{
	if (!Session)
	{
		HeaderLine = TEXT("(no session: is Demos/the-hamlet.storyletsc in place?)");
	}
	else
	{
		// The project and version the bundle carries, then the current turn of
		// every box, named title-or-gameId and in listBoxes() order.
		TArray<FString> Parts;
		for (const FStoryletBoxView& Box : Session->ListBoxes())
		{
			Parts.Add(TurnPart(Box));
		}
		HeaderLine = FString::Printf(TEXT("%s %s - %s"),
			*ProjectLabel, *VersionLabel, *FString::Join(Parts, TEXT(", ")));
	}

	if (HeaderText)
	{
		HeaderText->SetText(FText::FromString(HeaderLine));
	}
}

void UStoryletBoardDemoWidget::RefreshBoard()
{
	if (!BoardScroll || !WidgetTree) return;

	// The dynamic half of the tree goes away whole, proxies and all.
	BoardScroll->ClearChildren();
	ClickProxies.Reset();

	if (!Session) return;

	for (const FStoryletHandContents& Hand : Session->Board())
	{
		UVerticalBox* Group = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
		if (UScrollBoxSlot* GroupSlot = Cast<UScrollBoxSlot>(BoardScroll->AddChild(Group)))
		{
			GroupSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f));
		}

		{
			UTextBlock* Label = MakeLabel(HandLabel(Hand.Hand), 11.f, BoardPalette::Accent);
			Group->AddChildToVerticalBox(Label)->SetPadding(FMargin(0.f, 0.f, 0.f, 4.f));
		}

		if (Hand.Cards.Num() == 0)
		{
			UTextBlock* Empty = MakeLabel(TEXT("(nothing here right now)"), 10.f, BoardPalette::Muted);
			Group->AddChildToVerticalBox(Empty)->SetPadding(FMargin(12.f, 0.f, 0.f, 0.f));
			continue;
		}

		for (const FStoryletDealtCard& Card : Hand.Cards)
		{
			const FString CardLabel = TitleOr(Card.Title, Card.GameId);

			UStoryletBoardClickProxy* Proxy = MakeProxy(Hand.Hand, Card.GameId, CardLabel);
			UButton* CardButton = MakeButton(CardLabel, BoardPalette::BtnCard);
			CardButton->OnClicked.AddDynamic(Proxy, &UStoryletBoardClickProxy::OnClicked);

			UVerticalBoxSlot* CardSlot = Group->AddChildToVerticalBox(CardButton);
			CardSlot->SetPadding(FMargin(12.f, 0.f, 0.f, 2.f));
			CardSlot->SetHorizontalAlignment(HAlign_Left);

			const bool bOpen = (OpenHand == Hand.Hand && OpenCardGameId == Card.GameId);
			if (!bOpen) continue;

			// Availability is asked for now, not remembered from deal time.
			for (const FStoryletOutcomeView& Outcome : Session->Outcomes(Card.GameId, Hand.Hand))
			{
				const FString OutcomeLabel = TitleOr(Outcome.Title, Outcome.GameId);
				const FString ButtonLabel = Outcome.bAvailable ? OutcomeLabel : OutcomeLabel + TEXT(" (locked)");

				UButton* OutcomeButton = MakeButton(ButtonLabel,
					Outcome.bAvailable ? BoardPalette::BtnPlay : BoardPalette::BtnCard);

				if (Outcome.bAvailable)
				{
					UStoryletBoardClickProxy* OutcomeProxy = MakeProxy(Hand.Hand, Card.GameId, CardLabel);
					OutcomeProxy->OutcomeGameId = Outcome.GameId;
					OutcomeProxy->OutcomeLabel = OutcomeLabel;
					OutcomeButton->OnClicked.AddDynamic(OutcomeProxy, &UStoryletBoardClickProxy::OnClicked);
				}
				else
				{
					// Shut outcomes still show: the shape of the card is part
					// of what the board says.
					OutcomeButton->SetIsEnabled(false);
				}

				UVerticalBoxSlot* OutcomeSlot = Group->AddChildToVerticalBox(OutcomeButton);
				OutcomeSlot->SetPadding(FMargin(36.f, 0.f, 0.f, 2.f));
				OutcomeSlot->SetHorizontalAlignment(HAlign_Left);
			}
		}
	}
}

void UStoryletBoardDemoWidget::AppendTranscript(const FString& Line)
{
	// The Output Log mirrors the transcript line for line, which is what makes
	// a headless run of this demo readable.
	UE_LOG(LogTemp, Display, TEXT("%s"), *Line);

	if (!TranscriptScroll || !WidgetTree) return;

	UTextBlock* Block = MakeLabel(Line, 10.f, BoardPalette::TextMain);
	TranscriptScroll->AddChild(Block);
	TranscriptScroll->ScrollToEnd();
}

void UStoryletBoardDemoWidget::ClearTranscript()
{
	if (TranscriptScroll)
	{
		TranscriptScroll->ClearChildren();
	}
}

// --- widget factories ---------------------------------------------------------

UTextBlock* UStoryletBoardDemoWidget::MakeLabel(const FString& Text, float Size, FLinearColor Colour)
{
	UTextBlock* Block = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
	if (!Block) return nullptr;

	FSlateFontInfo Font;
	Font.Size = static_cast<int32>(Size);
	Font.FontObject = GEngine ? GEngine->GetMediumFont() : nullptr;
	Block->SetFont(Font);
	Block->SetText(FText::FromString(Text));
	Block->SetColorAndOpacity(FSlateColor(Colour));
	return Block;
}

UButton* UStoryletBoardDemoWidget::MakeButton(const FString& Label, FLinearColor Background)
{
	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
	if (!Button) return nullptr;

	Button->SetBackgroundColor(Background);
	if (UTextBlock* Text = MakeLabel(Label, 10.f, BoardPalette::TextMain))
	{
		Button->AddChild(Text);
	}
	return Button;
}

UStoryletBoardClickProxy* UStoryletBoardDemoWidget::MakeProxy(const FString& InHand, const FString& InCardGameId,
	const FString& InCardLabel)
{
	UStoryletBoardClickProxy* Proxy = NewObject<UStoryletBoardClickProxy>(this);
	Proxy->Owner = this;
	Proxy->Hand = InHand;
	Proxy->CardGameId = InCardGameId;
	Proxy->CardLabel = InCardLabel;
	ClickProxies.Add(Proxy);
	return Proxy;
}

// --- the headless driver -------------------------------------------------------

UStoryletBoardDemoWidget* UStoryletBoardDemoWidget::FindOrCreateForDriving()
{
	if (UStoryletBoardDemoWidget* Existing = ActiveWidget.Get())
	{
		return Existing;
	}
	if (!GEngine) return nullptr;

	for (const FWorldContext& Context : GEngine->GetWorldContexts())
	{
		if (Context.WorldType != EWorldType::Game && Context.WorldType != EWorldType::PIE) continue;

		UWorld* World = Context.World();
		if (!World) continue;

		if (APlayerController* Controller = World->GetFirstPlayerController())
		{
			// No AddToViewport: a nullrhi run has nothing to draw into, but
			// CreateWidget still gives the widget a player context, which is
			// what runs its initialisation.
			return CreateWidget<UStoryletBoardDemoWidget>(Controller, UStoryletBoardDemoWidget::StaticClass());
		}
	}
	return nullptr;
}

void UStoryletBoardDemoWidget::DriveOnce()
{
	if (!Session)
	{
		UE_LOG(LogTemp, Warning, TEXT("Board demo: no session to drive."));
		return;
	}

	OnDealAllHandsClicked();

	// Open the first card the deal put on the board, then play its first
	// available outcome: exactly what a player's two clicks do.
	FString FirstHand, FirstCard;
	for (const FStoryletHandContents& Hand : Session->Board())
	{
		if (Hand.Cards.Num() > 0)
		{
			FirstHand = Hand.Hand;
			FirstCard = Hand.Cards[0].GameId;
			break;
		}
	}

	if (!FirstCard.IsEmpty())
	{
		// Count the hand before the play so the log proves the refill: the play
		// empties a slot and PlayOutcome's Refill() must put a card back.
		int32 CountBefore = 0;
		for (const FStoryletHandContents& Hand : Session->Board())
		{
			if (Hand.Hand == FirstHand) { CountBefore = Hand.Cards.Num(); break; }
		}
		SelectCard(FirstHand, FirstCard);

		FString CardLabel = FirstCard;
		for (const FStoryletHandContents& Hand : Session->Board())
		{
			if (Hand.Hand != FirstHand) continue;
			for (const FStoryletDealtCard& Card : Hand.Cards)
			{
				if (Card.GameId == FirstCard) CardLabel = TitleOr(Card.Title, Card.GameId);
			}
		}

		for (const FStoryletOutcomeView& Outcome : Session->Outcomes(FirstCard, FirstHand))
		{
			if (!Outcome.bAvailable) continue;
			PlayOutcome(FirstHand, FirstCard, CardLabel, Outcome.GameId, TitleOr(Outcome.Title, Outcome.GameId));

		int32 CountAfter = 0;
		for (const FStoryletHandContents& Hand : Session->Board())
		{
			if (Hand.Hand == FirstHand) { CountAfter = Hand.Cards.Num(); break; }
		}
		UE_LOG(LogTemp, Display, TEXT("board demo refill: %s had %d, has %d after the play"),
			*FirstHand, CountBefore, CountAfter);
			break;
		}
	}

	OnNextTurnClicked();
	OnRestartClicked();
}

/** The console command that stands in for a mouse: a -game -nullrhi run has no
 *  clicks to make, so it calls the very handlers the buttons are wired to.
 *  Run it with -ExecCmds="storylet.BoardDemo.Drive". */
static FAutoConsoleCommand GStoryletBoardDemoDrive(
	TEXT("storylet.BoardDemo.Drive"),
	TEXT("Drive the Storylet Engine Board demo through one round of its own button handlers."),
	FConsoleCommandDelegate::CreateLambda([]()
	{
		if (UStoryletBoardDemoWidget* Widget = UStoryletBoardDemoWidget::FindOrCreateForDriving())
		{
			Widget->DriveOnce();
		}
		else
		{
			UE_LOG(LogTemp, Warning, TEXT("Board demo: no board demo widget and no player controller to build one on."));
		}
	}));
