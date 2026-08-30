// The bundle inspector, Unreal idiom (design/engine-runtimes.md 2, piece 6): a
// details customisation on UStoryletBundle, so selecting an imported
// .storyletsc in the Content Browser answers "what may my game code call?"
// without running the game or opening Storyletter.
//
// Read-only by construction: every row comes from UStoryletBundle::DescribeBundle()
// (no session, no state), and nothing here writes to the asset. The details
// panel's own categories are the collapsible sections - Bundle (identity),
// Hands (deal), Tags by box (peek criteria), Properties (declared), Counts -
// with the LoadError surfaced at the top when the bundle failed to compile.
// SourceJson stays AdvancedDisplay on the asset: it is the artefact, not the
// answer.
//
// Slate idiom follows SStoryletStatePanel: STextBlock rows, subdued foreground
// for headings, monospace nowhere (these are labels, not a log).
#pragma once

#include "CoreMinimal.h"
#include "IDetailCustomization.h"

class IDetailLayoutBuilder;
class IDetailCategoryBuilder;
struct FStoryletBundleDescription;

class FStoryletBundleDetails : public IDetailCustomization
{
public:
	static TSharedRef<IDetailCustomization> MakeInstance();

	virtual void CustomizeDetails(IDetailLayoutBuilder& DetailBuilder) override;

private:
	/** One full-width text row in a category (headings pass bMuted). */
	static void AddLine(IDetailCategoryBuilder& Category, const FString& Text, bool bMuted = false);
};
