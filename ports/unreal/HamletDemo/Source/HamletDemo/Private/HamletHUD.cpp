#include "HamletHUD.h"
#include "HamletWidget.h"
#include "Blueprint/UserWidget.h"
#include "GameFramework/PlayerController.h"
void AHamletHUD::BeginPlay()
{
	Super::BeginPlay();
	APlayerController* Controller = GetOwningPlayerController();
	if (!Controller) return;
	Widget = CreateWidget<UHamletWidget>(Controller, UHamletWidget::StaticClass());
	if (!Widget) return;
	Widget->AddToViewport(0);
	Controller->bShowMouseCursor = true;
	Controller->SetInputMode(FInputModeUIOnly());
}
