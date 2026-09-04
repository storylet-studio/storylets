#include "HamletWidget.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/ScrollBox.h"
#include "Components/SizeBox.h"
#include "Components/BorderSlot.h"
#include "Components/ButtonSlot.h"
#include "Components/TextBlock.h"
#include "Components/Button.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Kismet/GameplayStatics.h"

void UHamletClickProxy::OnClicked() { if (Owner) Owner->Clicked(*this); }

static FString ReadDemoFile(const TCHAR* Name)
{
	FString Text; FFileHelper::LoadFileToString(Text, *(FPaths::ProjectDir() / TEXT("Demos") / Name)); return Text;
}

void UHamletWidget::NativeOnInitialized()
{
	Super::NativeOnInitialized();
	SavePath = FPaths::ProjectSavedDir() / TEXT("hamlet-save.json");
	FString Err;
	if (!Game.Setup(ReadDemoFile(TEXT("hamlet.storyletsc")), ReadDemoFile(TEXT("hamlet.patterc")), Err))
	{
		UE_LOG(LogTemp, Error, TEXT("Hamlet: %s (run build.sh, then press Play)"), *Err);
	}
	FString Saved;
	if (FFileHelper::LoadFileToString(Saved, *SavePath))
	{
		FString LoadErr;
		if (!Game.Load(Saved, LoadErr)) { UE_LOG(LogTemp, Warning, TEXT("Hamlet: save not loaded (%s); starting fresh"), *LoadErr); IFileManager::Get().Delete(*SavePath); }
	}

	// A near-black panel behind everything. This widget is a wall of words over the
	// default template map's sky and floor, and pale text on light ground is unreadable.
	// The Unity demo needed the same and cleared its camera to black; here the map keeps
	// its own look and the panel simply covers it.
	UBorder* Backing = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Backing->SetBrushColor(Panel);
	Backing->SetPadding(FMargin(28.f, 24.f));
	WidgetTree->RootWidget = Backing;

	// A column, not a viewport. Left to fill, every line of dialogue runs the whole width
	// of the screen, which is a poor measure to read, and a full-width button is absurd on
	// a wide monitor. The web client sets the same column and everything else follows it.
	//
	// FIXED, not a range. Sized between a minimum and a maximum it takes the width its
	// CONTENT wants, so a long card title widened it and a short one narrowed it, and
	// since it is centred the whole panel jumped sideways on every card. A fixed column
	// cannot move, whatever is put in it.
	USizeBox* Column = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
	Column->SetWidthOverride(860.f);
	Backing->SetContent(Column);
	if (UBorderSlot* S = Cast<UBorderSlot>(Column->Slot))
	{
		S->SetHorizontalAlignment(HAlign_Center);
		S->SetVerticalAlignment(VAlign_Fill);
	}

	UVerticalBox* Root = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Column->AddChild(Root);
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(MakeLabel(TEXT("The Hamlet"), 26.f, Ink))) { S->SetPadding(FMargin(0.f, 0.f, 0.f, 2.f)); }
	Header = MakeLabel(TEXT(""), 12.f, Dim);
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(Header)) { S->SetPadding(FMargin(0.f, 0.f, 0.f, 16.f)); }
	PlacesRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(PlacesRow)) { S->SetPadding(FMargin(0.f, 0.f, 0.f, 16.f)); }

	// The transcript grows without limit, so it scrolls and takes the space left over.
	UScrollBox* StageScroll = WidgetTree->ConstructWidget<UScrollBox>(UScrollBox::StaticClass());
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(StageScroll)) { S->SetSize(ESlateSizeRule::Fill); }
	Stage = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	StageScroll->AddChild(Stage);

	UHorizontalBox* Footer = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(Footer)) { S->SetPadding(FMargin(0.f, 16.f, 0.f, 0.f)); }
	UButton* Wait = MakeButton(TEXT("Let time pass")); Wait->OnClicked.AddDynamic(this, &UHamletWidget::OnWaitClicked); AddToRow(Footer, Wait);
	UButton* Leave = MakeButton(TEXT("Step outside")); Leave->OnClicked.AddDynamic(this, &UHamletWidget::OnLeaveClicked); AddToRow(Footer, Leave);
	UButton* Restart = MakeButton(TEXT("Restart")); Restart->OnClicked.AddDynamic(this, &UHamletWidget::OnRestartClicked); AddToRow(Footer, Restart);
	LogText = MakeLabel(TEXT(""), 10.f, Dim);
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(LogText)) { S->SetPadding(FMargin(0.f, 12.f, 0.f, 0.f)); }
	Refresh();
}

void UHamletWidget::Clicked(const UHamletClickProxy& P)
{
	try
	{
		if (P.Kind == TEXT("place")) Game.Go(P.Id);
		else if (P.Kind == TEXT("card")) { for (const auto& c : Game.Hand()) if (c.Id == P.Id) { Game.Start(c); break; } }
		else if (P.Kind == TEXT("option")) Game.Choose(P.Id);
		else if (P.Kind == TEXT("continue")) Game.Finish();
	}
	catch (const std::exception& ex) { UE_LOG(LogTemp, Error, TEXT("Hamlet: %s"), UTF8_TO_TCHAR(ex.what())); }
	Save(); Refresh();
}
void UHamletWidget::OnWaitClicked() { Game.Wait(); Save(); Refresh(); }
void UHamletWidget::OnLeaveClicked() { Game.Go(TEXT("")); Save(); Refresh(); }
void UHamletWidget::OnRestartClicked()
{
	IFileManager::Get().Delete(*SavePath);
	UGameplayStatics::OpenLevel(this, FName(*UGameplayStatics::GetCurrentLevelName(this)));
}

void UHamletWidget::Save() { FFileHelper::SaveStringToFile(Game.Save(), *SavePath); }

void UHamletWidget::Refresh()
{
	Header->SetText(FText::FromString(TEXT("The Storylet Engine chooses the beat. Patter performs it.    ") + Game.World.Line()));
	Proxies.Empty(); PlacesRow->ClearChildren(); Stage->ClearChildren();
	for (const auto& p : Game.Places)
	{
		// The place you are standing in is SELECTED, not disabled: greying it out says
		// "you may not go here", which is the opposite of what it means. It takes the
		// accent instead, and simply has nothing bound to it.
		const bool bHere = p.Key == Game.At;
		UButton* B = MakeButton(p.Value, false, bHere);
		if (!bHere) B->OnClicked.AddDynamic(MakeProxy(TEXT("place"), p.Key, TEXT(""), p.Value), &UHamletClickProxy::OnClicked);
		AddToRow(PlacesRow, B);
	}
	if (Game.Playing)
	{
		for (const auto& s : Game.Playing->Shown)
		{
			// A spoken line reads as speech; narration is quieter and set in italic, as
			// the web client draws it. Every line gets air beneath it, or the transcript
			// runs together into one grey paragraph.
			const bool bLine = s.Kind == TEXT("line");
			UTextBlock* T = MakeLabel(bLine ? s.Character + TEXT(": ") + s.Text : s.Text, 12.f, bLine ? Ink : Dim, !bLine);
			if (UVerticalBoxSlot* S = Stage->AddChildToVerticalBox(T)) { S->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f)); }
		}
		if (Game.Playing->bDone)
		{
			// The scene has ended: the outcome plays when the player has read it.
			UButton* C = MakeButton(TEXT("Continue"), true);
			C->OnClicked.AddDynamic(MakeProxy(TEXT("continue"), TEXT(""), TEXT(""), TEXT("")), &UHamletClickProxy::OnClicked);
			AddToStage(C);
		}
		for (const auto& ch : Game.Playing->Choices)
		{
			// Shut options are shown and unclickable, rather than hidden: the player sees
			// what the scene could have offered, which is half the point of gating it.
			UButton* B = MakeButton(ch.bEnabled ? ch.Text : ch.Text + TEXT("  (") + ch.Why + TEXT(")"), true);
			if (ch.bEnabled) B->OnClicked.AddDynamic(MakeProxy(TEXT("option"), ch.Id, TEXT(""), ch.Text), &UHamletClickProxy::OnClicked);
			B->SetIsEnabled(ch.bEnabled);
			AddToStage(B);
		}
	}
	else if (Game.At.IsEmpty()) Stage->AddChildToVerticalBox(MakeLabel(TEXT("Choose somewhere to be."), 12.f, Dim, true));
	else
	{
		auto hand = Game.Hand();
		if (hand.IsEmpty()) Stage->AddChildToVerticalBox(MakeLabel(TEXT("Nothing here just now."), 12.f, Dim, true));
		for (const auto& c : hand)
		{
			const FString Title = c.Title.IsEmpty() ? c.GameId : c.Title;
			UButton* B = MakeButton(Title, true); B->OnClicked.AddDynamic(MakeProxy(TEXT("card"), c.Id, c.GameId, Title), &UHamletClickProxy::OnClicked);
			AddToStage(B);
		}
	}
	TArray<FString> Lines; for (int i = 0; i < Game.Log.Num() && i < 6; ++i) Lines.Add(Game.Log[i]);
	LogText->SetText(FText::FromString(FString::Join(Lines, TEXT("\n"))));
}

/** A button that reads as one: a dark face against the panel, its own padding, and a
 *  gap from its neighbours (set by the caller's slot). `bWide` is for a list of choices
 *  or cards, which fill the width and read from the left; the rest sit in a row and take
 *  only the width their words need, instead of stretching to share the line. */
UButton* UHamletWidget::MakeButton(const FString& Label, bool bWide, bool bSelected)
{
	UButton* B = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
	B->SetBackgroundColor(bSelected ? Accent : Face);
	UTextBlock* T = MakeLabel(Label, 11.f, bSelected ? OnAccent : Ink);
	// A row button holds two or three words and never wraps. A choice or a card can be a
	// whole sentence, so its label wraps inside a capped box: unwrapped, one long option
	// would push the button past the column and take the layout with it.
	T->SetAutoWrapText(bWide);
	UWidget* Content = T;
	if (bWide)
	{
		USizeBox* Cap = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Cap->SetMaxDesiredWidth(600.f);
		Cap->AddChild(T);
		Content = Cap;
	}
	B->AddChild(Content);
	if (UButtonSlot* S = Cast<UButtonSlot>(Content->Slot))
	{
		S->SetPadding(FMargin(14.f, 7.f));
		S->SetHorizontalAlignment(bWide ? HAlign_Left : HAlign_Center);
	}
	return B;
}
UTextBlock* UHamletWidget::MakeLabel(const FString& Text, float Size, const FLinearColor& Colour, bool bItalic)
{
	UTextBlock* T = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
	T->SetText(FText::FromString(Text)); T->SetAutoWrapText(true);
	T->SetColorAndOpacity(FSlateColor(Colour));
	FSlateFontInfo Font = T->GetFont(); Font.Size = Size;
	if (bItalic) Font.TypefaceFontName = FName(TEXT("Italic"));
	T->SetFont(Font); return T;
}
/** A button in a row: only as wide as its words, with a gap after it. */
void UHamletWidget::AddToRow(UHorizontalBox* Row, UButton* B)
{
	if (UHorizontalBoxSlot* S = Row->AddChildToHorizontalBox(B))
	{
		S->SetSize(ESlateSizeRule::Automatic);
		S->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
	}
}
/** A button in the transcript: as wide as its own words, hard against the left, with air
 *  beneath it. Filling the row makes one option look like a banner rather than a choice. */
void UHamletWidget::AddToStage(UButton* B)
{
	if (UVerticalBoxSlot* S = Stage->AddChildToVerticalBox(B))
	{
		S->SetPadding(FMargin(0.f, 0.f, 0.f, 8.f));
		S->SetHorizontalAlignment(HAlign_Left);
	}
}
UHamletClickProxy* UHamletWidget::MakeProxy(const FString& Kind, const FString& Id, const FString& GameId, const FString& Title)
{
	UHamletClickProxy* P = NewObject<UHamletClickProxy>(this); P->Owner = this; P->Kind = Kind; P->Id = Id; P->GameId = GameId; P->Title = Title;
	Proxies.Add(P); return P;
}
