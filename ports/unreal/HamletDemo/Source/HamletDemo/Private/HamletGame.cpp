#include "HamletGame.h"
#include "PatterBundle.h"
#include "Storylets/JsonParse.h"
#include "Storylets/Bundle.h"
#include "Storylets/Save.h"
#include "Patter/Save.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonReader.h"

using namespace storylets;

static std::string S(const FString& In) { return std::string(TCHAR_TO_UTF8(*In)); }
static FString F(const std::string& In) { return FString(UTF8_TO_TCHAR(In.c_str())); }

// --- the world ---------------------------------------------------------------

void FHamletWorld::Write(const std::string& Name, const StoryletValue& Value)
{
	for (const auto& ro : ReadOnly)
	{
		if (ro == Name) throw StoryletError("@world." + Name + " is the game's alone: a story tried to set it");
	}
	Values[Name] = Value;
}

WorldResolver FHamletWorld::ForStorylets()
{
	WorldResolver r;
	r.get = [this](const std::string& n) -> std::optional<StoryletValue> {
		auto it = Values.find(n); if (it == Values.end()) return std::nullopt; return it->second; };
	r.set = [this](const std::string& n, const StoryletValue& v) { Write(n, v); };
	return r;
}

// The two value types are one shared source under two names, so a value crosses
// by kind. Patter's get hands back a pointer that must stay valid until the next
// call on this scope, so the answer lives in a member slot.
patter::HostScope FHamletWorld::ForPatter()
{
	patter::HostScope s;
	s.get = [this](const std::string& n) -> const patter::PatterValue* {
		auto it = Values.find(n); if (it == Values.end()) return nullptr;
		const StoryletValue& v = it->second;
		if (v.isBool()) Slot = patter::PatterValue::Bool(v.asBool());
		else if (v.isNumber()) Slot = patter::PatterValue::Num(v.asNumber());
		else if (v.isString()) Slot = patter::PatterValue::Str(v.asString());
		else return nullptr;
		return &Slot; };
	s.set = [this](const std::string& n, const patter::PatterValue& v) {
		if (v.isBool()) Write(n, StoryletValue::Bool(v.asBool()));
		else if (v.isNumber()) Write(n, StoryletValue::Num(v.asNumber()));
		else if (v.isString()) Write(n, StoryletValue::Str(v.asString())); };
	return s;
}

FString FHamletWorld::Line() const
{
	TArray<FString> Parts;
	for (const auto& kv : Values)
	{
		if (kv.second.isBool()) { if (kv.second.asBool()) Parts.Add(F(kv.first)); }
		else Parts.Add(F(kv.second.toDisplayString()));
	}
	return FString::Join(Parts, TEXT(" · "));
}

// --- setup ------------------------------------------------------------------

bool FHamletGame::Setup(const FString& StoryletJson, const FString& PatterJson, FString& OutError)
{
	World.Values = { {"time_of_day", StoryletValue::Str("day")}, {"knows_road", StoryletValue::Bool(false)} };
	World.ReadOnly = { "time_of_day" };   // time is the game's alone; both projects say so too
	try
	{
		BundlePtr sb = ParseBundle(JsonParser(S(StoryletJson)).parse());
		EngineOptions so; so.seed = Seed; so.world = World.ForStorylets();
		Storylets = std::make_unique<Engine>(sb, so);

		UPatterBundle* pbWrapper = UPatterBundle::LoadFromString(PatterJson);
		if (!pbWrapper || !pbWrapper->Raw()) { OutError = TEXT("Patter's bundle did not load"); return false; }
		PatterBundle = std::make_shared<patter::Bundle>(*pbWrapper->Raw());   // a plain struct: copy it out of the wrapper, and own it
		patter::EngineOptions po; po.hasSeed = true; po.seed = Seed;   // hasSeed, or the seed is ignored and the hosts diverge
		// ONE world, both engines. Patter's core takes host scopes under their token,
		// at construction only, which is why this code builds the engine itself.
		po.hostScopes["world"] = World.ForPatter();
		Patter = std::make_unique<patter::Engine>(*PatterBundle, po);

		Story = Storylets->openFlow(FlowId);
		Places.Empty();
		for (const auto& h : sb->boxes[0].hands) Places.Add(TPair<FString, FString>(F(h.gameId), F(h.title.empty() ? h.gameId : h.title)));
		Story->dealMany();
		return true;
	}
	catch (const std::exception& ex) { OutError = F(ex.what()); return false; }
}

// --- the loop -----------------------------------------------------------------

void FHamletGame::Go(const FString& Place) { At = Place; Playing.Reset(); if (!Place.IsEmpty()) Story->deal(S(Place)); }
std::vector<DealtCard> FHamletGame::Hand() { return At.IsEmpty() ? std::vector<DealtCard>{} : Story->deal(S(At)); }

void FHamletGame::Start(const DealtCard& Card)
{
	auto p = MakeUnique<FPerforming>(); p->Card = Card;
	p->Flow = Patter->openFlow(PerformanceId, Card.gameId);   // the scene is found BY NAME
	Playing = MoveTemp(p);
	Run();
}

void FHamletGame::Choose(const FString& OptionId) { if (!Playing) return; Playing->Flow->choose(S(OptionId)); Playing->Choices.Empty(); Run(); }

void FHamletGame::Run()
{
	for (int guard = 0; guard < 500; ++guard)
	{
		patter::StepResult step = Playing->Flow->advance();
		switch (step.type)
		{
		case patter::StepType::Line: Playing->Shown.Add({TEXT("line"), F(step.characterName.empty() ? step.character : step.characterName), F(step.text)}); break;
		case patter::StepType::Text: Playing->Shown.Add({TEXT("text"), TEXT(""), F(step.text)}); break;
		case patter::StepType::GameEvent:
			// THE SEAM: the scene saying which of the card's outcomes it reached.
			if (step.gameData) { auto it = step.gameData->find("outcome"); if (it != step.gameData->end() && it->second.isString()) Playing->Outcome = it->second.asString(); }
			break;
		case patter::StepType::Choice:
			for (const auto& opt : step.options) if (opt.eligible) Playing->Choices.Add({F(opt.id), F(opt.prompt ? opt.prompt->text : opt.id)});
			return;
		default: Finish(); return;
		}
	}
}

void FHamletGame::Finish()
{
	const DealtCard card = Playing->Card; const std::string outcome = Playing->Outcome;
	if (outcome.empty()) throw StoryletError("scene \"" + card.gameId + "\" ended without reporting an outcome");
	Story->play(card.id, outcome, S(At));
	Log.Insert(F((card.title.empty() ? card.gameId : card.title) + ": " + outcome), 0);
	Playing.Reset();
	Story->dealMany();   // re-prime everywhere; a still-eligible card keeps its seat (the survivor rule)
}

void FHamletGame::Wait()
{
	const bool day = World.Values["time_of_day"].asString() == "day";
	World.Host("time_of_day", StoryletValue::Str(day ? "night" : "day"));
	Story->advanceTurns(Story->listBoxes()[0].gameId, 1);
	Story->dealMany();
}

// --- one envelope --------------------------------------------------------------

FString FHamletGame::Save() const
{
	TSharedPtr<FJsonObject> env = MakeShared<FJsonObject>();
	env->SetStringField(TEXT("storylets"), F(serializeState(*Storylets)));       // our .storyletsave text
	env->SetStringField(TEXT("patter"), F(patter::serializeState(*Patter)));      // Patter's patter/save@0 text
	TSharedPtr<FJsonObject> w = MakeShared<FJsonObject>();
	for (const auto& kv : World.Values)
	{
		if (kv.second.isBool()) w->SetBoolField(F(kv.first), kv.second.asBool());
		else if (kv.second.isNumber()) w->SetNumberField(F(kv.first), kv.second.asNumber());
		else w->SetStringField(F(kv.first), F(kv.second.asString()));
	}
	env->SetObjectField(TEXT("world"), w);
	env->SetStringField(TEXT("at"), At);
	if (Playing)
	{
		TSharedPtr<FJsonObject> p = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> c = MakeShared<FJsonObject>();
		c->SetStringField(TEXT("id"), F(Playing->Card.id)); c->SetStringField(TEXT("gameId"), F(Playing->Card.gameId)); c->SetStringField(TEXT("title"), F(Playing->Card.title));
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
				if (kv.Value->Type == EJson::Boolean) World.Values[S(kv.Key)] = StoryletValue::Bool(kv.Value->AsBool());
				else if (kv.Value->Type == EJson::Number) World.Values[S(kv.Key)] = StoryletValue::Num(kv.Value->AsNumber());
				else World.Values[S(kv.Key)] = StoryletValue::Str(S(kv.Value->AsString()));
			}
		deserializeState(*Storylets, S(env->GetStringField(TEXT("storylets"))));
		patter::deserializeState(*Patter, S(env->GetStringField(TEXT("patter"))));
		// A load rebuilds the flows, and openFlow on an existing id REPLACES it, hand and all: getFlow.
		Story = Storylets->getFlow(FlowId);
		if (!Story) { OutError = TEXT("the save has no main flow"); return false; }
		At = env->GetStringField(TEXT("at"));
		Playing.Reset();
		const TSharedPtr<FJsonObject>* perf;
		if (env->TryGetObjectField(TEXT("performing"), perf) && perf->IsValid())
		{
			auto flow = Patter->getFlow(PerformanceId);
			if (!flow) { OutError = TEXT("the envelope says a scene was in flight, and Patter's half did not restore it"); return false; }
			auto p = MakeUnique<FPerforming>(); p->Flow = flow;
			const TSharedPtr<FJsonObject>& c = (*perf)->GetObjectField(TEXT("card"));
			p->Card.id = S(c->GetStringField(TEXT("id"))); p->Card.gameId = S(c->GetStringField(TEXT("gameId"))); p->Card.title = S(c->GetStringField(TEXT("title")));
			for (const auto& s : (*perf)->GetArrayField(TEXT("shown")))
			{
				auto o = s->AsObject(); FString kind, character, text;   // optional fields: a text beat has no character, an unreported outcome is null
				o->TryGetStringField(TEXT("kind"), kind); o->TryGetStringField(TEXT("character"), character); o->TryGetStringField(TEXT("text"), text);
				p->Shown.Add({kind, character, text});
			}
			FString outcome; (*perf)->TryGetStringField(TEXT("outcome"), outcome); p->Outcome = S(outcome);
			for (const auto& opt : flow->getChoices()) if (opt.eligible) p->Choices.Add({F(opt.id), F(opt.prompt ? opt.prompt->text : opt.id)});
			Playing = MoveTemp(p);
		}
		return true;
	}
	catch (const std::exception& ex) { OutError = F(ex.what()); return false; }
}
