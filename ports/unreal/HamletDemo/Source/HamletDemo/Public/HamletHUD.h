#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "HamletHUD.generated.h"
class UHamletWidget;
UCLASS()
class HAMLETDEMO_API AHamletHUD : public AHUD
{
	GENERATED_BODY()
protected:
	virtual void BeginPlay() override;
	UPROPERTY() TObjectPtr<UHamletWidget> Widget;
};
