#include "HamletWorldSync.h"

static std::string S(const FString& In) { return std::string(TCHAR_TO_UTF8(*In)); }

void UHamletWorldSync::Bind(UStoryletWorld* InStorylets, UPatterWorld* InPatter)
{
	Storylets = InStorylets;
	Patter = InPatter;
	Storylets->OnChanged.AddDynamic(this, &UHamletWorldSync::OnStoryletChanged);
	Patter->OnChanged.AddDynamic(this, &UHamletWorldSync::OnPatterChanged);
}

// A value crosses by kind; flags are not part of this world.
void UHamletWorldSync::OnStoryletChanged(const FString& Name, const FStoryletValue& Value, bool bFromStory)
{
	FPatterValue Current;
	if (Patter->GetValue(Name, Current) && Current.Display == Value.Display) return;
	if (Value.Kind == EStoryletValueKind::Boolean) Patter->SetBool(Name, Value.bBool);
	else if (Value.Kind == EStoryletValueKind::Number) Patter->SetNumber(Name, Value.Number);
	else if (Value.Kind == EStoryletValueKind::String) Patter->SetString(Name, Value.String);
}

void UHamletWorldSync::OnPatterChanged(const FString& Name, const FPatterValue& Value, bool bFromStory)
{
	FStoryletValue Current;
	if (Storylets->GetValue(Name, Current) && Current.Display == Value.Display) return;
	if (Value.Kind == EPatterValueKind::Boolean) Storylets->SetBool(Name, Value.bBool);
	else if (Value.Kind == EPatterValueKind::Number) Storylets->SetNumber(Name, Value.Number);
	else if (Value.Kind == EPatterValueKind::String) Storylets->SetString(Name, Value.String);
}
