#include "StoryletBoardDemoHUD.h"

#include "StoryletBoardDemoWidget.h"

#include "Blueprint/UserWidget.h"
#include "GameFramework/PlayerController.h"

void AStoryletBoardDemoHUD::BeginPlay()
{
	Super::BeginPlay();

	APlayerController* Controller = GetOwningPlayerController();
	if (!Controller) return;

	BoardWidget = CreateWidget<UStoryletBoardDemoWidget>(Controller, UStoryletBoardDemoWidget::StaticClass());
	if (!BoardWidget) return;

	BoardWidget->AddToViewport(0);
	Controller->bShowMouseCursor = true;
	Controller->SetInputMode(FInputModeUIOnly());
}
