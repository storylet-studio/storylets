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

void FHamletGame::Choose(const FString& OptionId) { if (!Playing) return; Playing->Flow->Choose(OptionId); Playing->Choices.Empty(); Run(); }

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
			for (const FPatterOption& opt : step.Options) if (opt.bEligible) Playing->Choices.Add({opt.Id, opt.Text.IsEmpty() ? opt.Id : opt.Text});
			return;
		default: Finish(); return;
		}
	}
}

void FHamletGame::Finish()
{
	const FStoryletDealtCard card = Playing->Card; const std::string outcome = Playing->Outcome;
	if (outcome.empty()) throw StoryletError("scene \"" + S(card.GameId) + "\" ended without reporting an outcome");
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
			FString outcome; (*perf)->TryGetStringField(TEXT("outcome"), outcome); p->Outcome = S(outcome);
			// The pending choice, read from the core flow: the wrapper has no choice listing, and Advance() is the next step.
			if (const patter::Flow* core = Patter->Raw() ? Patter->Raw()->getFlow(S(BoxFlowId)) : nullptr)
				for (const auto& opt : core->getChoices()) if (opt.eligible) p->Choices.Add({F(opt.id), F(opt.prompt ? opt.prompt->text : opt.id)});
			Playing = MoveTemp(p);
		}
		return true;
	}
	catch (const std::exception& ex) { OutError = F(ex.what()); return false; }
}
