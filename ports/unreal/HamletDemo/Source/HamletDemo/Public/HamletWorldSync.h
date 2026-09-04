#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "StoryletWorld.h"
#include "PatterWorld.h"
#include "HamletWorldSync.generated.h"

/** One world behind two plugins' containers. Each plugin owns a container type
 *  (UStoryletWorld, UPatterWorld) and takes only its own at Create, so a game
 *  running both keeps them mirrored: a change in either is copied to the other
 *  as a HOST write when the value actually differs (the difference check is
 *  what stops the two OnChanged events chasing each other). Read-only is set on
 *  both, so each engine's story is refused by its own container. */
UCLASS()
class HAMLETDEMO_API UHamletWorldSync : public UObject
{
	GENERATED_BODY()

public:
	void Bind(UStoryletWorld* InStorylets, UPatterWorld* InPatter);

	UFUNCTION()
	void OnStoryletChanged(const FString& Name, const FStoryletValue& Value, bool bFromStory);
	UFUNCTION()
	void OnPatterChanged(const FString& Name, const FPatterValue& Value, bool bFromStory);

private:
	UPROPERTY()
	TObjectPtr<UStoryletWorld> Storylets = nullptr;
	UPROPERTY()
	TObjectPtr<UPatterWorld> Patter = nullptr;
};
