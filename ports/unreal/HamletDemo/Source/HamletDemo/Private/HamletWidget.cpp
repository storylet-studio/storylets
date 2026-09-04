#include "HamletWidget.h"
#include "Blueprint/WidgetTree.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/HorizontalBox.h"
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

	UVerticalBox* Root = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	WidgetTree->RootWidget = Root;
	Root->AddChildToVerticalBox(MakeLabel(TEXT("The Hamlet"), 26.f));
	Header = MakeLabel(TEXT(""), 12.f); Root->AddChildToVerticalBox(Header);
	PlacesRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass()); Root->AddChildToVerticalBox(PlacesRow);
	Stage = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	if (UVerticalBoxSlot* S = Root->AddChildToVerticalBox(Stage)) { S->SetPadding(FMargin(0.f, 12.f)); }
	UHorizontalBox* Footer = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass()); Root->AddChildToVerticalBox(Footer);
	UButton* Wait = MakeButton(TEXT("Let time pass")); Wait->OnClicked.AddDynamic(this, &UHamletWidget::OnWaitClicked); Footer->AddChild(Wait);
	UButton* Leave = MakeButton(TEXT("Step outside")); Leave->OnClicked.AddDynamic(this, &UHamletWidget::OnLeaveClicked); Footer->AddChild(Leave);
	UButton* Restart = MakeButton(TEXT("Restart")); Restart->OnClicked.AddDynamic(this, &UHamletWidget::OnRestartClicked); Footer->AddChild(Restart);
	LogText = MakeLabel(TEXT(""), 10.f); Root->AddChildToVerticalBox(LogText);
	Refresh();
}

void UHamletWidget::Clicked(const UHamletClickProxy& P)
{
	try
	{
		if (P.Kind == TEXT("place")) Game.Go(P.Id);
		else if (P.Kind == TEXT("card")) { for (const auto& c : Game.Hand()) if (c.Id == P.Id) { Game.Start(c); break; } }
		else if (P.Kind == TEXT("option")) Game.Choose(P.Id);
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
		UButton* B = MakeButton(p.Value); B->SetIsEnabled(p.Key != Game.At);
		B->OnClicked.AddDynamic(MakeProxy(TEXT("place"), p.Key, TEXT(""), p.Value), &UHamletClickProxy::OnClicked);
		PlacesRow->AddChild(B);
	}
	if (Game.Playing)
	{
		for (const auto& s : Game.Playing->Shown) Stage->AddChildToVerticalBox(MakeLabel(s.Kind == TEXT("line") ? s.Character + TEXT(": ") + s.Text : s.Text, 12.f));
		for (const auto& ch : Game.Playing->Choices)
		{
			UButton* B = MakeButton(ch.Text); B->OnClicked.AddDynamic(MakeProxy(TEXT("option"), ch.Id, TEXT(""), ch.Text), &UHamletClickProxy::OnClicked);
			Stage->AddChildToVerticalBox(B);
		}
	}
	else if (Game.At.IsEmpty()) Stage->AddChildToVerticalBox(MakeLabel(TEXT("Choose somewhere to be."), 12.f));
	else
	{
		auto hand = Game.Hand();
		if (hand.IsEmpty()) Stage->AddChildToVerticalBox(MakeLabel(TEXT("Nothing here just now."), 12.f));
		for (const auto& c : hand)
		{
			const FString Title = c.Title.IsEmpty() ? c.GameId : c.Title;
			UButton* B = MakeButton(Title); B->OnClicked.AddDynamic(MakeProxy(TEXT("card"), c.Id, c.GameId, Title), &UHamletClickProxy::OnClicked);
			Stage->AddChildToVerticalBox(B);
		}
	}
	TArray<FString> Lines; for (int i = 0; i < Game.Log.Num() && i < 6; ++i) Lines.Add(Game.Log[i]);
	LogText->SetText(FText::FromString(FString::Join(Lines, TEXT("\n"))));
}

UButton* UHamletWidget::MakeButton(const FString& Label)
{
	UButton* B = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
	B->AddChild(MakeLabel(Label, 11.f)); return B;
}
UTextBlock* UHamletWidget::MakeLabel(const FString& Text, float Size)
{
	UTextBlock* T = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
	T->SetText(FText::FromString(Text)); T->SetAutoWrapText(true);
	FSlateFontInfo Font = T->GetFont(); Font.Size = Size; T->SetFont(Font); return T;
}
UHamletClickProxy* UHamletWidget::MakeProxy(const FString& Kind, const FString& Id, const FString& GameId, const FString& Title)
{
	UHamletClickProxy* P = NewObject<UHamletClickProxy>(this); P->Owner = this; P->Kind = Kind; P->Id = Id; P->GameId = GameId; P->Title = Title;
	Proxies.Add(P); return P;
}
