#include "StoryletBundleDetails.h"

#include "StoryletBundle.h"
#include "StoryletTypes.h"

#include "DetailCategoryBuilder.h"
#include "DetailLayoutBuilder.h"
#include "DetailWidgetRow.h"
#include "Styling/CoreStyle.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

#define LOCTEXT_NAMESPACE "StoryletBundleDetails"

TSharedRef<IDetailCustomization> FStoryletBundleDetails::MakeInstance()
{
	return MakeShared<FStoryletBundleDetails>();
}

void FStoryletBundleDetails::AddLine(IDetailCategoryBuilder& Category, const FString& Text, bool bMuted)
{
	Category.AddCustomRow(FText::FromString(Text))
	.WholeRowContent()
	[
		SNew(STextBlock)
		.Text(FText::FromString(Text))
		.ColorAndOpacity(bMuted ? FSlateColor::UseSubduedForeground() : FSlateColor::UseForeground())
	];
}

void FStoryletBundleDetails::CustomizeDetails(IDetailLayoutBuilder& DetailBuilder)
{
	TArray<TWeakObjectPtr<UObject>> Objects;
	DetailBuilder.GetObjectsBeingCustomized(Objects);
	if (Objects.Num() != 1)
	{
		// Multi-select: the shape of one bundle is the only useful reading.
		return;
	}
	UStoryletBundle* Bundle = Cast<UStoryletBundle>(Objects[0].Get());
	if (!Bundle)
	{
		return;
	}

	IDetailCategoryBuilder& BundleCategory = DetailBuilder.EditCategory(
		TEXT("Bundle"), LOCTEXT("BundleCategory", "Bundle"), ECategoryPriority::Important);

	// A broken bundle still imports: say so first, and loudly.
	// A bundle that did not compile says so, WHATEVER the reason. Testing
	// LoadError alone was not enough: an asset that never parsed can carry an
	// empty one, and this then fell through to DescribeBundle(), which returns a
	// default-constructed description - so the Inspector showed blank fields
	// rather than a fault. Patterplay's copy of this file already distinguished
	// the two; ours did not, which is the drift this pair is prone to.
	if (!Bundle->IsCompiled() || !Bundle->LoadError.IsEmpty())
	{
		const FString Why = Bundle->LoadError.IsEmpty()
			? LOCTEXT("LoadErrorUnknown", "the bundle has not been parsed").ToString()
			: Bundle->LoadError;
		BundleCategory.AddCustomRow(LOCTEXT("LoadErrorFilter", "Load error"))
		.WholeRowContent()
		[
			SNew(STextBlock)
			.AutoWrapText(true)
			.ColorAndOpacity(FLinearColor::Red)
			.Text(FText::Format(LOCTEXT("LoadErrorRow", "This bundle failed to compile:\n{0}"),
				FText::FromString(Why)))
		];
		return;
	}

	const FStoryletBundleDescription D = Bundle->DescribeBundle();

	// --- identity: which bundle is this? -----------------------------------
	BundleCategory.AddCustomRow(LOCTEXT("IdentityFilter", "Identity"))
	.WholeRowContent()
	[
		SNew(STextBlock)
		.Font(FCoreStyle::GetDefaultFontStyle("Bold", 11))
		.Text(FText::FromString(FString::Printf(TEXT("%s %s"),
			*D.Identity.Project, *D.Identity.Version)))
	];
	AddLine(BundleCategory, FString::Printf(TEXT("schema %s"), *D.Identity.Schema), true);
	AddLine(BundleCategory, FString::Printf(TEXT("hash %s   metadata %s"),
		D.Identity.Hash.IsEmpty() ? TEXT("(none)") : *D.Identity.Hash, *D.Identity.Metadata), true);

	// --- hands: the Deal() surface -----------------------------------------
	IDetailCategoryBuilder& HandsCategory = DetailBuilder.EditCategory(
		TEXT("StoryletHands"), LOCTEXT("HandsCategory", "Hands (deal)"), ECategoryPriority::Important);
	if (D.Hands.Num() == 0)
	{
		AddLine(HandsCategory, TEXT("(no hands - this bundle is peek-only)"), true);
	}
	for (const FStoryletHandSummary& Hand : D.Hands)
	{
		FString Line = FString::Printf(TEXT("%s: box %s, slots %s"),
			*Hand.GameId, *Hand.Box, *Hand.SlotsLabel);
		if (!Hand.Template.IsEmpty())
		{
			Line += FString::Printf(TEXT(", template %s"), *Hand.Template);
		}
		if (!Hand.Title.IsEmpty())
		{
			Line += FString::Printf(TEXT("  - %s"), *Hand.Title);
		}
		AddLine(HandsCategory, Line);
	}

	// --- tags by box: the Peek() criteria surface --------------------------
	IDetailCategoryBuilder& TagsCategory = DetailBuilder.EditCategory(
		TEXT("StoryletTags"), LOCTEXT("TagsCategory", "Tags by box (peek criteria)"),
		ECategoryPriority::Important);
	for (const FStoryletBoxSummary& Box : D.Boxes)
	{
		AddLine(TagsCategory, Box.Title.IsEmpty() ? Box.GameId : Box.Title, true);
		if (Box.TagGroups.Num() == 0)
		{
			AddLine(TagsCategory, TEXT("    (no tag groups)"), true);
		}
		for (const FStoryletTagGroupSummary& Group : Box.TagGroups)
		{
			const FString Tags = Group.Tags.Num() > 0
				? FString::Join(Group.Tags, TEXT(", "))
				: FString(TEXT("(no tags)"));
			AddLine(TagsCategory, FString::Printf(TEXT("    %s: %s"), *Group.GameId, *Tags));
		}
	}

	// --- declared properties: what expressions read, what a host may set ---
	IDetailCategoryBuilder& PropsCategory = DetailBuilder.EditCategory(
		TEXT("StoryletProperties"), LOCTEXT("PropsCategory", "Properties (declared)"),
		ECategoryPriority::Important);
	for (const FStoryletPropertyScope& Scope : D.Properties)
	{
		AddLine(PropsCategory, Scope.Label, true);
		if (Scope.Properties.Num() == 0)
		{
			AddLine(PropsCategory, TEXT("    (none declared)"), true);
		}
		for (const FStoryletPropertySummary& Row : Scope.Properties)
		{
			AddLine(PropsCategory, FString::Printf(TEXT("    %s"), *Row.Label));
		}
	}

	// --- counts: orientation, not inventory --------------------------------
	IDetailCategoryBuilder& CountsCategory = DetailBuilder.EditCategory(
		TEXT("StoryletCounts"), LOCTEXT("CountsCategory", "Counts"), ECategoryPriority::Important);
	AddLine(CountsCategory, FString::Printf(
		TEXT("boxes %d   decks %d   cards %d   hands %d   templates %d   tag groups %d"),
		D.Totals.Boxes, D.Totals.Decks, D.Totals.Cards, D.Totals.Hands,
		D.Totals.Templates, D.Totals.TagGroups));
	for (const FStoryletBoxSummary& Box : D.Boxes)
	{
		AddLine(CountsCategory, FString::Printf(
			TEXT("%s: decks %d, cards %d, hands %d, templates %d, tag groups %d, ranking.specificity %s"),
			*Box.GameId, Box.Counts.Decks, Box.Counts.Cards, Box.Counts.Hands,
			Box.Counts.Templates, Box.Counts.TagGroups,
			Box.bRankingSpecificity ? TEXT("on") : TEXT("off")));
	}
}

#undef LOCTEXT_NAMESPACE
