#include "HamletGame.h"
#include "StoryletSave.h"
#include "PatterSave.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonReader.h"

using namespace storylets;

static std::string S(const FString& In) { return std::string(TCHAR_TO_UTF8(*In)); }
static FString F(const std::string& In) { return FString(UTF8_TO_TCHAR(In.c_str())); }

// --- the world ---------------------------------------------------------------

void FHamletWorld::Create()
{
	Store.Reset(NewObject<UStoryletWorld>(GetTransientPackage()));
	Mirror.Reset(NewObject<UPatterWorld>(GetTransientPackage()));
	Sync.Reset(NewObject<UHamletWorldSync>(GetTransientPackage()));
	Sync->Bind(Store.Get(), Mirror.Get());
	Store->SetString(TEXT("time_of_day"), TEXT("day"));   // mirrored into Patter's container by the sync
	Store->SetBool(TEXT("knows_road"), false);
	// Nothing read-only: both projects let a scene or a card move time. SetReadOnly on
	// both containers is where the game would say otherwise.
}

FString FHamletWorld::Line() const
{
	TArray<FString> Parts;
	for (const FString& Name : Store->Names())
	{
		FStoryletValue v; Store->GetValue(Name, v);
		if (v.Kind == EStoryletValueKind::Boolean) { if (v.bBool) Parts.Add(Name); }
		else Parts.Add(v.Display);
	}
	return FString::Join(Parts, TEXT(" · "));
}

// --- setup ------------------------------------------------------------------

bool FHamletGame::Setup(const FString& StoryletJson, const FString& PatterJson, FString& OutError)
{
	World.Create();
	try
	{
		FString BundleError;
		StoryletBundle.Reset(UStoryletBundle::LoadFromJsonString(StoryletJson, BundleError));
		if (!StoryletBundle) { OutError = TEXT("the storylets bundle did not load: ") + BundleError; return false; }
		// ONE world, both engines: ours takes it at Create, through the plugin's own seam.
		Storylets.Reset(UStoryletEngine::Create(StoryletBundle.Get(), static_cast<int32>(Seed), false, World.Store.Get()));
		if (!Storylets) { OutError = TEXT("the storylet engine did not start"); return false; }

		PatterBundle.Reset(UPatterBundle::LoadFromString(PatterJson));
		if (!PatterBundle || !PatterBundle->Raw()) { OutError = TEXT("Patter's bundle did not load"); return false; }
		// ONE world, both engines: Patter's wrapper takes its container at Create too (0.11.0).
		Patter.Reset(UPatterEngine::Create(PatterBundle.Get(), World.Mirror.Get()));
		if (!Patter) { OutError = TEXT("Patter's engine did not start"); return false; }

		Story.Reset(Storylets->OpenFlow(FlowId));
		Performance.Reset(Patter->OpenFlow(BoxFlowId, TEXT("")));   // once; every card is a Goto on it
		if (!Performance) { OutError = TEXT("Patter's flow did not open"); return false; }
		Places.Empty(); HandRefs.Empty();
		const FStoryletBundleDescription Described = StoryletBundle->DescribeBundle();
		for (const FStoryletHandSummary& h : Described.Hands)
		{
			if (Described.Boxes.Num() && h.Box != Described.Boxes[0].GameId) continue;
			Places.Add(TPair<FString, FString>(h.GameId, h.Title.IsEmpty() ? h.GameId : h.Title));
			HandRefs.Add(h.GameId);
		}
		Story->DealMany(HandRefs);
		// Open where there is something to do: the first hand that deals a card. The project
		// does not order its hands for this (the demo opens with one card, at the gate).
		for (const auto& p : Places) if (Story->Deal(p.Key).Num() > 0) { At = p.Key; break; }
		return true;
	}
	catch (const std::exception& ex) { OutError = F(ex.what()); return false; }
}

// --- the loop -----------------------------------------------------------------

void FHamletGame::Go(const FString& Place) { At = Place; Playing.Reset(); if (!Place.IsEmpty()) Story->Deal(Place); }
TArray<FStoryletDealtCard> FHamletGame::Hand() { return At.IsEmpty() ? TArray<FStoryletDealtCard>{} : Story->Deal(At); }

void FHamletGame::Start(const FStoryletDealtCard& Card)
{
	auto p = MakeUnique<FPerforming>(); p->Card = Card;
	if (!Performance->Goto(Card.GameId, TEXT(""))) throw StoryletError("no Patter scene \"" + S(Card.GameId) + "\"");   // the scene is found BY NAME
	p->Flow.Reset(Performance.Get());
	Playing = MoveTemp(p);
	Run();
}

void FHamletGame::Choose(const FString& OptionId)
{
	if (!Playing) return;
	// The label rides with the option, so it is taken HERE, while the host still knows
	// which option was clicked. By the end of the branch it is gone.
	for (const FChoice& ch : Playing->Choices) if (ch.Id == OptionId && !ch.Outcome.IsEmpty()) Playing->Labelled = S(ch.Outcome);
	Playing->Flow->Choose(OptionId); Playing->Choices.Empty(); Run();
}

/** The outcome ids the storylet side will accept for this card RIGHT NOW. Read afresh at
 *  every stop: a scene can write @world mid-performance and change what is open under itself. */
TSet<FString> FHamletGame::OpenOutcomes() const
{
	TSet<FString> Open;
	for (const FStoryletOutcomeView& o : Story->Outcomes(Playing->Card.Id, At)) if (o.bAvailable) Open.Add(o.GameId);
	return Open;
}

/** The choices a step offers, with BOTH engines' gates applied. Patter says whether the option
 *  can be offered at all; the Storylet Engine says whether the outcome it leads to is open.
 *  Clickable only when both agree. */
void FHamletGame::ChoicesFrom(const TArray<FPatterOption>& Options)
{
	const TSet<FString> Open = OpenOutcomes();
	for (const FPatterOption& opt : Options)
	{
		FString Outcome;
		for (const FPatterGameDataEntry& e : opt.GameData) if (e.Name == TEXT("outcome")) Outcome = e.Value;
		const bool bShut = !Outcome.IsEmpty() && !Open.Contains(Outcome);
		Playing->Choices.Add({opt.Id, opt.Text.IsEmpty() ? opt.Id : opt.Text, Outcome, opt.bEligible && !bShut,
			!opt.bEligible ? TEXT("not available here") : bShut ? TEXT("requirements not met") : TEXT("")});
	}
}

/** An explicit gameEvent, else the option the player took, else the card's only outcome.
 *  Loud when none of the three answers: guessing would move the world the wrong way, and
 *  the build catches this shape first (scripts/pairing.mjs). */
std::string FHamletGame::ResolveOutcome() const
{
	if (!Playing->Outcome.empty()) return Playing->Outcome;
	if (!Playing->Labelled.empty()) return Playing->Labelled;
	TArray<FString> Declared;
	for (const FStoryletOutcomeView& o : Story->Outcomes(Playing->Card.Id, At)) Declared.Add(o.GameId);
	if (Declared.Num() == 1) return S(Declared[0]);
	throw StoryletError("scene \"" + S(Playing->Card.GameId) + "\" ended without saying which outcome it reached, and its card declares "
		+ std::to_string(Declared.Num()) + " (" + S(FString::Join(Declared, TEXT(", "))) + ")");
}

void FHamletGame::Run()
{
	for (int guard = 0; guard < 500; ++guard)
	{
		const FPatterStep step = Playing->Flow->Advance();
		switch (step.Type)
		{
		case EPatterStepType::Line: Playing->Shown.Add({TEXT("line"), step.CharacterName.IsEmpty() ? step.Character : step.CharacterName, step.Text}); break;
		case EPatterStepType::Text: Playing->Shown.Add({TEXT("text"), TEXT(""), step.Text}); break;
		case EPatterStepType::GameEvent:
			// THE SEAM: the scene saying which of the card's outcomes it reached.
			for (const FPatterGameDataEntry& e : step.GameData) if (e.Name == TEXT("outcome")) Playing->Outcome = S(e.Value);
			break;
		case EPatterStepType::Choice:
			ChoicesFrom(step.Options);
			return;
		default:
			// The scene has ENDED but its outcome is not played yet: its closing lines, and
			// the whole of a scene with no choice, would vanish under the redeal before
			// anyone read them. The player presses Continue.
			Playing->bDone = true;
			return;
		}
	}
}

void FHamletGame::Finish()
{
	const FStoryletDealtCard card = Playing->Card; const std::string outcome = ResolveOutcome();
	FString PlayError;
	if (!Story->Play(card.Id, F(outcome), At, PlayError)) throw StoryletError(S(PlayError));   // the wrapper reports; this demo throws, as the JS client does
	Log.Insert((card.Title.IsEmpty() ? card.GameId : card.Title) + TEXT(": ") + F(outcome), 0);
	Playing.Reset();
	Story->DealMany(HandRefs);   // re-prime everywhere; a still-eligible card keeps its seat (the survivor rule)
}

void FHamletGame::Wait()
{
	const bool day = World.Store->GetString(TEXT("time_of_day")) == TEXT("day");
	World.Host("time_of_day", StoryletValue::Str(day ? "night" : "day"));
	Story->AdvanceTurns(Story->ListBoxes()[0].GameId, 1);
	Story->DealMany(HandRefs);
}

// --- one envelope --------------------------------------------------------------

FString FHamletGame::Save() const
{
	TSharedPtr<FJsonObject> env = MakeShared<FJsonObject>();
	env->SetStringField(TEXT("storylets"), UStoryletSave::SaveStateToJson(Storylets.Get()));   // our .storyletsave text, @world beside the envelope
	env->SetStringField(TEXT("patter"), UPatterSave::SaveStateToJson(Patter.Get()));   // Patter's patter/save@0 text
	TSharedPtr<FJsonObject> w = MakeShared<FJsonObject>();
	for (const FString& Name : World.Store->Names())
	{
		FStoryletValue v; World.Store->GetValue(Name, v);
		if (v.Kind == EStoryletValueKind::Boolean) w->SetBoolField(Name, v.bBool);
		else if (v.Kind == EStoryletValueKind::Number) w->SetNumberField(Name, v.Number);
		else w->SetStringField(Name, v.String);
	}
	env->SetObjectField(TEXT("world"), w);
	env->SetStringField(TEXT("at"), At);
	if (Playing)
	{
		TSharedPtr<FJsonObject> p = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> c = MakeShared<FJsonObject>();
		c->SetStringField(TEXT("id"), Playing->Card.Id); c->SetStringField(TEXT("gameId"), Playing->Card.GameId); c->SetStringField(TEXT("title"), Playing->Card.Title);
		p->SetObjectField(TEXT("card"), c);
		TArray<TSharedPtr<FJsonValue>> shown;
		for (const auto& s : Playing->Shown) { auto o = MakeShared<FJsonObject>(); o->SetStringField(TEXT("kind"), s.Kind); o->SetStringField(TEXT("character"), s.Character); o->SetStringField(TEXT("text"), s.Text); shown.Add(MakeShared<FJsonValueObject>(o)); }
		p->SetArrayField(TEXT("shown"), shown);
		p->SetStringField(TEXT("outcome"), F(Playing->Outcome));
		p->SetStringField(TEXT("labelled"), F(Playing->Labelled));
		p->SetBoolField(TEXT("done"), Playing->bDone);
		env->SetObjectField(TEXT("performing"), p);
	}
	else env->SetField(TEXT("performing"), MakeShared<FJsonValueNull>());
	FString out; auto writer = TJsonWriterFactory<>::Create(&out); FJsonSerializer::Serialize(env.ToSharedRef(), writer);
	return out;
}

bool FHamletGame::Load(const FString& Json, FString& OutError)
{
	TSharedPtr<FJsonObject> env; auto reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(reader, env) || !env) { OutError = TEXT("not a JSON envelope"); return false; }
	try
	{
		const TSharedPtr<FJsonObject>* w;
		if (env->TryGetObjectField(TEXT("world"), w))
			for (const auto& kv : (*w)->Values)
			{
				if (kv.Value->Type == EJson::Boolean) World.Host(S(kv.Key), StoryletValue::Bool(kv.Value->AsBool()));
				else if (kv.Value->Type == EJson::Number) World.Host(S(kv.Key), StoryletValue::Num(kv.Value->AsNumber()));
				else World.Host(S(kv.Key), StoryletValue::Str(S(kv.Value->AsString())));
			}
		// The wrapper's load restores the file's @world into the bound container too (the same values).
		if (!UStoryletSave::LoadStateFromJson(Storylets.Get(), env->GetStringField(TEXT("storylets")))) { OutError = TEXT("the storylets half did not load"); return false; }
		if (!UPatterSave::LoadStateFromJson(Patter.Get(), env->GetStringField(TEXT("patter")))) { OutError = TEXT("Patter's half did not load"); return false; }
		// A load rebuilds the flows, and OpenFlow on an existing id REPLACES it, hand and all: GetFlow.
		Story.Reset(Storylets->GetFlow(FlowId));
		if (!Story) { OutError = TEXT("the save has no main flow"); return false; }
		Performance.Reset(Patter->GetFlow(BoxFlowId));
		if (!Performance) { OutError = TEXT("the save has no Patter flow for the box"); return false; }
		At = env->GetStringField(TEXT("at"));
		Playing.Reset();
		const TSharedPtr<FJsonObject>* perf;
		if (env->TryGetObjectField(TEXT("performing"), perf) && perf->IsValid())
		{
			auto p = MakeUnique<FPerforming>(); p->Flow.Reset(Performance.Get());
			const TSharedPtr<FJsonObject>& c = (*perf)->GetObjectField(TEXT("card"));
			p->Card.Id = c->GetStringField(TEXT("id")); p->Card.GameId = c->GetStringField(TEXT("gameId")); p->Card.Title = c->GetStringField(TEXT("title"));
			for (const auto& s : (*perf)->GetArrayField(TEXT("shown")))
			{
				auto o = s->AsObject(); FString kind, character, text;   // optional fields: a text beat has no character, an unreported outcome is null
				o->TryGetStringField(TEXT("kind"), kind); o->TryGetStringField(TEXT("character"), character); o->TryGetStringField(TEXT("text"), text);
				p->Shown.Add({kind, character, text});
			}
			FString outcome, labelled;
			(*perf)->TryGetStringField(TEXT("outcome"), outcome); p->Outcome = S(outcome);
			(*perf)->TryGetStringField(TEXT("labelled"), labelled); p->Labelled = S(labelled);
			(*perf)->TryGetBoolField(TEXT("done"), p->bDone);
			const bool bWasDone = p->bDone;
			Playing = MoveTemp(p);   // ChoicesFrom reads Playing->Card for the card's outcomes
			// A scene that had ended and not been continued needs nothing from Patter: the
			// transcript and the outcome are the envelope's, and Continue is waiting.
			// The pending choice, read from the core flow: the wrapper has no choice listing, and Advance() is the next step.
			const patter::Flow* core = bWasDone ? nullptr : (Patter->Raw() ? Patter->Raw()->getFlow(S(BoxFlowId)) : nullptr);
			if (core)
			{
				TArray<FPatterOption> Pending;
				for (const auto& opt : core->getChoices())
				{
					FPatterOption o; o.Id = F(opt.id); o.Text = F(opt.prompt ? opt.prompt->text : opt.id); o.bEligible = opt.eligible;
					// gameData is a shared_ptr to the map, and a value knows how to show itself.
					if (opt.gameData)
						for (const auto& g : *opt.gameData)
						{
							FPatterGameDataEntry E; E.Name = F(g.first); E.Value = F(g.second.toDisplayString());
							o.GameData.Add(MoveTemp(E));
						}
					Pending.Add(MoveTemp(o));
				}
				ChoicesFrom(Pending);
			}
		}
		return true;
	}
	catch (const std::exception& ex) { OutError = F(ex.what()); return false; }
}
