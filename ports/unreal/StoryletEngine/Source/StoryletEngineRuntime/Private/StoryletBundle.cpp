#include "StoryletBundle.h"

#include "StoryletCompiledBundle.h"
#include "StoryletJsonBridge.h"

#include "Storylets/DescribeBundle.h"
#include "Storylets/JsonValue.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

#if WITH_EDITORONLY_DATA
#include "EditorFramework/AssetImportData.h"
#endif

UStoryletBundle* UStoryletBundle::LoadFromJsonString(const FString& Json, FString& OutError)
{
	UStoryletBundle* Bundle = NewObject<UStoryletBundle>(GetTransientPackage());
	Bundle->SourceJson = Json;
	if (!Bundle->Rebuild())
	{
		OutError = Bundle->LoadError;
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: failed to compile bundle - %s"), *OutError);
		return nullptr;
	}
	OutError.Reset();
	return Bundle;
}

bool UStoryletBundle::IsCompiled() const
{
	return Compiled.IsValid() && Compiled->Bundle != nullptr;
}

FString UStoryletBundle::GetProject() const
{
	if (!IsCompiled()) return FString();
	return FString(UTF8_TO_TCHAR(Compiled->Bundle->content.project.c_str()));
}

FString UStoryletBundle::GetBuildId() const
{
	if (!IsCompiled()) return FString();
	return FString(UTF8_TO_TCHAR(Compiled->Bundle->content.hash.c_str()));
}

namespace
{
	// The Blueprint boundary conversions for the bundle description. Deliberately
	// local to this translation unit: the session wrapper's copies serve the
	// session's own views, and neither is worth a shared private header for four
	// three-line helpers (nothing std may reach a public UE header).
	FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	EStoryletPropertyType PropertyTypeFrom(const std::string& T)
	{
		if (T == storylets::PropertyTypes::Number) return EStoryletPropertyType::Number;
		if (T == storylets::PropertyTypes::String) return EStoryletPropertyType::String;
		if (T == storylets::PropertyTypes::Enum) return EStoryletPropertyType::Enum;
		if (T == storylets::PropertyTypes::Flags) return EStoryletPropertyType::Flags;
		if (T == storylets::PropertyTypes::Quality) return EStoryletPropertyType::Quality;
		return EStoryletPropertyType::Boolean;
	}

	EStoryletScopeKind ScopeKindFrom(const std::string& S)
	{
		if (S == storylets::scopekind::Story) return EStoryletScopeKind::Story;
		if (S == storylets::scopekind::Box) return EStoryletScopeKind::Box;
		if (S == storylets::scopekind::Deck) return EStoryletScopeKind::Deck;
		if (S == storylets::scopekind::Hand) return EStoryletScopeKind::Hand;
		if (S == storylets::scopekind::Tag) return EStoryletScopeKind::Tag;
		return EStoryletScopeKind::World;
	}

	FStoryletValue ConvertValue(const storylets::StoryletValue& V)
	{
		FStoryletValue Out;
		switch (V.kind)
		{
			case storylets::StoryletKind::Bool:
				Out.Kind = EStoryletValueKind::Boolean;
				Out.bBool = V.asBool();
				Out.Display = V.asBool() ? TEXT("true") : TEXT("false");
				break;
			case storylets::StoryletKind::Number:
				Out.Kind = EStoryletValueKind::Number;
				Out.Number = V.asNumber();
				Out.Display = Ue(storylets::StoryletValue::JsNumber(V.asNumber()));
				break;
			case storylets::StoryletKind::Str:
				Out.Kind = EStoryletValueKind::String;
				Out.String = Ue(V.asString());
				Out.Display = Out.String;
				break;
			default:
			{
				Out.Kind = EStoryletValueKind::Flags;
				const std::vector<std::string>& Flags = V.asFlags();
				for (size_t i = 0; i < Flags.size(); ++i)
				{
					Out.Flags.Add(Ue(Flags[i]));
					if (i > 0) Out.Display += TEXT(", ");
					Out.Display += Ue(Flags[i]);
				}
				break;
			}
		}
		return Out;
	}
}

FStoryletBundleDescription UStoryletBundle::DescribeBundle() const
{
	FStoryletBundleDescription Out;
	if (!IsCompiled())
	{
		return Out;
	}
	const storylets::BundleDescription D = storylets::describeBundle(*Compiled->Bundle);

	Out.Identity.Schema = Ue(D.identity.schema);
	Out.Identity.Project = Ue(D.identity.project);
	Out.Identity.Version = Ue(D.identity.version);
	Out.Identity.Hash = Ue(D.identity.hash);
	Out.Identity.Metadata = Ue(D.identity.metadata);

	Out.Totals.Boxes = D.totals.boxes;
	Out.Totals.Decks = D.totals.decks;
	Out.Totals.Cards = D.totals.cards;
	Out.Totals.Hands = D.totals.hands;
	Out.Totals.Templates = D.totals.templates;
	Out.Totals.TagGroups = D.totals.tagGroups;

	for (const storylets::BoxSummary& B : D.boxes)
	{
		FStoryletBoxSummary Box;
		Box.GameId = Ue(B.gameId);
		Box.Title = Ue(B.title);
		Box.bRankingSpecificity = B.rankingSpecificity;
		Box.TurnSeconds = B.turnSeconds.has_value() ? *B.turnSeconds : 0.0;
		Box.DurableCards = B.durableCards;
		for (const storylets::TagGroupSummary& G : B.tagGroups)
		{
			FStoryletTagGroupSummary Group;
			Group.GameId = Ue(G.gameId);
			for (const std::string& T : G.tags) Group.Tags.Add(Ue(T));
			Box.TagGroups.Add(MoveTemp(Group));
		}
		Box.Counts.Decks = B.counts.decks;
		Box.Counts.Cards = B.counts.cards;
		Box.Counts.Hands = B.counts.hands;
		Box.Counts.Templates = B.counts.templates;
		Box.Counts.TagGroups = B.counts.tagGroups;
		Out.Boxes.Add(MoveTemp(Box));
	}

	for (const storylets::HandSummary& H : D.hands)
	{
		FStoryletHandSummary Hand;
		Hand.GameId = Ue(H.gameId);
		Hand.Title = Ue(H.title);
		Hand.Box = Ue(H.box);
		Hand.Slots = H.slots;
		Hand.SlotsLabel = Ue(storylets::SlotsLabel(H.slots));
		Hand.Template = Ue(H.templateGameId);
		for (const storylets::MovableHole& M : H.movable)
		{
			FStoryletMovableHole Hole;
			Hole.Group = Ue(M.group);
			Hole.From = Ue(M.from);
			Hand.Movable.Add(MoveTemp(Hole));
		}
		Out.Hands.Add(MoveTemp(Hand));
	}

	for (const storylets::PropertyScopeSummary& S : D.properties)
	{
		FStoryletPropertyScope Scope;
		Scope.Scope = ScopeKindFrom(S.scope);
		Scope.Owner = Ue(S.owner);
		Scope.Box = Ue(S.box);
		Scope.Group = Ue(S.group);
		Scope.Label = Ue(storylets::ScopeLabel(S));
		for (const storylets::PropertySummary& P : S.properties)
		{
			FStoryletPropertySummary Row;
			Row.Name = Ue(P.name);
			Row.Type = PropertyTypeFrom(P.type);
			Row.Default = ConvertValue(P.defaultValue);
			for (const std::string& V : P.values) Row.Values.Add(Ue(V));
			Row.bDurable = P.durable;
			Row.Purpose = Ue(P.purpose);
			Row.Label = Ue(storylets::PropertyLabel(P));
			Scope.Properties.Add(MoveTemp(Row));
		}
		Out.Properties.Add(MoveTemp(Scope));
	}

	// Inert payload, and therefore worth saying out loud: a bundle that silently
	// carried a map would fail the promise this API makes.
	for (const storylets::MapSummary& M : D.maps)
	{
		FStoryletMapSummary Map;
		Map.Box = Ue(M.box);
		Map.Group = Ue(M.group);
		Map.Zones = M.zones;
		Map.Backgrounds = M.backgrounds;
		Map.Sites = M.sites;
		Out.Maps.Add(MoveTemp(Map));
	}
	return Out;
}

bool UStoryletBundle::Rebuild()
{
	Compiled.Reset();
	LoadError.Reset();

	storylets::JsonValue Tree;
	FString ParseError;
	if (!StoryletJsonToTree(SourceJson, Tree, ParseError))
	{
		LoadError = ParseError;
		return false;
	}
	// The schema tag is the bundle boundary rule: refuse a foreign blob
	// before handing it to the loader.
	const std::string Schema = Tree.strOr("schema");
	if (Schema != storylets::BUNDLE_SCHEMA)
	{
		LoadError = FString::Printf(TEXT("not a storylets bundle (expected schema \"%s\")"),
			UTF8_TO_TCHAR(storylets::BUNDLE_SCHEMA));
		return false;
	}
	try
	{
		TPimplPtr<FStoryletCompiledBundle> NewCompiled = MakePimpl<FStoryletCompiledBundle>();
		NewCompiled->Bundle = storylets::ParseBundle(Tree);
		Compiled = MoveTemp(NewCompiled);
		return true;
	}
	catch (const std::exception& Ex)
	{
		LoadError = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

void UStoryletBundle::PostLoad()
{
	Super::PostLoad();
	if (!SourceJson.IsEmpty() && !Rebuild())
	{
		// A broken bundle still loads; the error stays readable on the asset.
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: bundle '%s' failed to compile - %s"),
			*GetName(), *LoadError);
	}
}
