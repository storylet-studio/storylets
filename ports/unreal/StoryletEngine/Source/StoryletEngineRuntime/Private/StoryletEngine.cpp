#include "StoryletEngine.h"

#include "StoryletBundle.h"
#include "StoryletCompiledBundle.h"
#include "StoryletDebug.h"
#include "StoryletSaveJson.h"

#include "Storylets/Engine.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

/** The engine's Pimpl: the std engine plus the shared compiled bundle, so the
 *  model outlives the asset for as long as this engine does. */
struct FStoryletEngineImpl
{
	storylets::BundlePtr Bundle;
	std::unique_ptr<storylets::Engine> Engine;
	/** What Create was given; re-applied to the ApplyLiveBundle rebuild. */
	storylets::EngineOptions Options;
	/** Engine-level trace subscribers, held at the WRAPPER so they survive an
	 *  ApplyLiveBundle swap of the core beneath them - the same reason the
	 *  flow's own handlers live on its wrapper. */
	TMap<int32, TFunction<void(const FString&, const storylets::TraceEvent&)>> TraceHandlers;
	int32 NextTraceHandle = 1;
	std::function<void()> UnsubscribeCore;
};

/** A flow wrapper's Pimpl. The flow is held by SHARED pointer: the engine
 *  drops a closed flow from its map, and a raw pointer would dangle in every
 *  handle the game still holds. Shared, the object outlives the close and the
 *  core's own closed flag makes the wrapper inert - the contract every runtime
 *  states. */
struct FStoryletFlowImpl
{
	storylets::FlowPtr Flow;
	/** The wrapper's trace subscribers, and the one core hook feeding them
	 *  (installed while there is at least one; re-installed on a swap). */
	TMap<int32, TFunction<void(const storylets::TraceEvent&)>> TraceHandlers;
	int32 NextTraceHandle = 1;
	std::function<void()> UnsubscribeCore;
};

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
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

	/** The one display rendering shared by rows, field entries and
	 *  GetPropertyString: raw strings (no quotes), "true"/"false", JS-stable
	 *  numbers, flags comma-joined (what the examiner's flags editor parses
	 *  back). */
	FString DisplayString(const storylets::StoryletValue& V)
	{
		switch (V.kind)
		{
			case storylets::StoryletKind::Bool:
				return V.asBool() ? TEXT("true") : TEXT("false");
			case storylets::StoryletKind::Number:
				return Ue(storylets::StoryletValue::JsNumber(V.asNumber()));
			case storylets::StoryletKind::Str:
				return Ue(V.asString());
			default:
			{
				FString Out;
				const std::vector<std::string>& Flags = V.asFlags();
				for (size_t i = 0; i < Flags.size(); ++i)
				{
					if (i > 0) Out += TEXT(", ");
					Out += Ue(Flags[i]);
				}
				return Out;
			}
		}
	}

	FStoryletValue ConvertValue(const storylets::StoryletValue& V)
	{
		FStoryletValue Out;
		switch (V.kind)
		{
			case storylets::StoryletKind::Bool:
				Out.Kind = EStoryletValueKind::Boolean;
				Out.bBool = V.asBool();
				break;
			case storylets::StoryletKind::Number:
				Out.Kind = EStoryletValueKind::Number;
				Out.Number = V.asNumber();
				break;
			case storylets::StoryletKind::Str:
				Out.Kind = EStoryletValueKind::String;
				Out.String = Ue(V.asString());
				break;
			default:
				Out.Kind = EStoryletValueKind::Flags;
				for (const std::string& F : V.asFlags()) Out.Flags.Add(Ue(F));
				break;
		}
		Out.Display = DisplayString(V);
		return Out;
	}

	FStoryletDealtCard ConvertCard(const storylets::DealtCard& C)
	{
		FStoryletDealtCard Out;
		Out.Id = Ue(C.id);
		Out.GameId = Ue(C.gameId);
		Out.Title = Ue(C.title);
		Out.Purpose = Ue(C.purpose);
		for (const auto& Pair : C.fields)
		{
			FStoryletFieldEntry Entry;
			Entry.Name = Ue(Pair.first);
			Entry.Value = ConvertValue(Pair.second);
			Out.Fields.Add(MoveTemp(Entry));
		}
		return Out;
	}

	TArray<FStoryletHandContents> ConvertHands(
		const storylets::OrderedMap<std::string, std::vector<storylets::DealtCard>>& Hands)
	{
		TArray<FStoryletHandContents> Out;
		for (const auto& Pair : Hands)
		{
			FStoryletHandContents Contents;
			Contents.Hand = Ue(Pair.first);
			for (const storylets::DealtCard& C : Pair.second) Contents.Cards.Add(ConvertCard(C));
			Out.Add(MoveTemp(Contents));
		}
		return Out;
	}
}

UStoryletEngine* UStoryletEngine::Create(UStoryletBundle* Bundle, int32 Seed, bool bRetainLog)
{
	if (!Bundle || !Bundle->GetCompiled() || !Bundle->GetCompiled()->Bundle)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: Create called with a null/uncompiled bundle"));
		return nullptr;
	}
	UStoryletEngine* E = NewObject<UStoryletEngine>(GetTransientPackage());
	E->BundleRef = Bundle;
	try
	{
		storylets::EngineOptions Opts;
		Opts.seed = static_cast<double>(Seed);
		Opts.log = bRetainLog;
		TPimplPtr<FStoryletEngineImpl> Impl = MakePimpl<FStoryletEngineImpl>();
		Impl->Bundle = Bundle->GetCompiled()->Bundle;
		Impl->Options = Opts;
		Impl->Engine = std::make_unique<storylets::Engine>(Impl->Bundle, Opts);
		E->Impl = MoveTemp(Impl);
		// No flow is opened here: play happens on one you open by name
		// (design/flows.md - there is no default flow).
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: %s"), UTF8_TO_TCHAR(Ex.what()));
		return nullptr;
	}
	return E;
}

// --- UStoryletFlow: lifetime -------------------------------------------------

void UStoryletFlow::Init(UStoryletEngine* InOwner, const FString& InId, std::shared_ptr<storylets::Flow> InFlow)
{
	Owner = InOwner;
	Id = InId;
	Impl = MakePimpl<FStoryletFlowImpl>();
	Rebind(std::move(InFlow));
}

void UStoryletFlow::Rebind(std::shared_ptr<storylets::Flow> InFlow)
{
	if (!Impl.IsValid()) Impl = MakePimpl<FStoryletFlowImpl>();
	// The old core hook belonged to the old core; drop it before re-pointing,
	// then re-install against the new flow if anyone is still listening.
	if (Impl->UnsubscribeCore)
	{
		Impl->UnsubscribeCore();
		Impl->UnsubscribeCore = nullptr;
	}
	Impl->Flow = std::move(InFlow);
	SyncCoreTraceHook();
}

bool UStoryletFlow::IsClosed() const
{
	return !Impl.IsValid() || !Impl->Flow || Impl->Flow->isClosed();
}

void UStoryletFlow::Close()
{
	if (IsClosed()) return;
	if (Owner) Owner->CloseFlow(Id);
	else Impl->Flow->close();
}

storylets::Flow* UStoryletFlow::GetCoreFlow() const
{
	return IsClosed() ? nullptr : Impl->Flow.get();
}

void UStoryletFlow::BeginDestroy()
{
	if (Impl.IsValid() && Impl->UnsubscribeCore)
	{
		Impl->UnsubscribeCore();
		Impl->UnsubscribeCore = nullptr;
	}
	Super::BeginDestroy();
}

// --- UStoryletEngine: flows ---------------------------------------------------

UStoryletFlow* UStoryletEngine::OpenFlow(const FString& FlowId)
{
	if (!IsValidEngine())
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: OpenFlow on an invalid engine"));
		return nullptr;
	}
	try
	{
		// Re-opening a name REPLACES: the core closes the old flow, so any
		// wrapper still holding it reads as closed from that moment.
		const storylets::FlowPtr Core = Impl->Engine->openFlow(Std(FlowId));
		UStoryletFlow* Wrapper = NewObject<UStoryletFlow>(GetTransientPackage());
		Wrapper->Init(this, FlowId, Core);
		WrappedFlows.RemoveAll([](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid(); });
		WrappedFlows.Add(Wrapper);
		return Wrapper;
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: OpenFlow - %s"), UTF8_TO_TCHAR(Ex.what()));
		return nullptr;
	}
}

UStoryletFlow* UStoryletEngine::GetFlow(const FString& FlowId) const
{
	if (!IsValidEngine()) return nullptr;
	const storylets::FlowPtr Core = Impl->Engine->getFlow(Std(FlowId));
	if (!Core) return nullptr;
	for (const TWeakObjectPtr<UStoryletFlow>& Weak : WrappedFlows)
	{
		UStoryletFlow* Wrapper = Weak.Get();
		if (Wrapper && Wrapper->GetFlowId() == FlowId && !Wrapper->IsClosed()) return Wrapper;
	}
	return nullptr;
}

TArray<UStoryletFlow*> UStoryletEngine::Flows() const
{
	TArray<UStoryletFlow*> Out;
	if (!IsValidEngine()) return Out;
	// Core order (the order they were opened), with the wrapper the game holds.
	for (const storylets::FlowPtr& Core : Impl->Engine->flows())
	{
		if (UStoryletFlow* Wrapper = GetFlow(Ue(Core->id()))) Out.Add(Wrapper);
	}
	return Out;
}

void UStoryletEngine::CloseFlow(const FString& FlowId)
{
	if (!IsValidEngine()) return;
	Impl->Engine->closeFlow(Std(FlowId));
	// The wrappers hold a shared_ptr, so nothing dangles; the core's own
	// closed flag is what makes them inert from here.
}

void UStoryletEngine::Reset()
{
	if (!IsValidEngine()) return;
	Impl->Engine->reset();
}

bool UStoryletEngine::IsValidEngine() const
{
	return Impl.IsValid() && Impl->Engine != nullptr;
}

namespace
{
	/** One guarded host write, for either target: a host write is silent under
	 *  the firing rule and visible to the audit hook. Templated because the
	 *  engine and a flow both take setProperty and neither shares a base. */
	template <typename TTarget>
	void SetPropertyGuarded(TTarget* Target, const FString& Path,
		const storylets::StoryletValue& Value, const TCHAR* Where)
	{
		if (!Target) return;
		try
		{
			Target->setProperty(Std(Path), Value);
		}
		catch (const std::exception& Ex)
		{
			UE_LOG(LogTemp, Error, TEXT("Storylet Engine: %s - %s"), Where, UTF8_TO_TCHAR(Ex.what()));
		}
	}
}


namespace
{
	EStoryletLogKind LogKindFrom(storylets::TraceEvent::Kind K)
	{
		switch (K)
		{
			case storylets::TraceEvent::Kind::Deal:       return EStoryletLogKind::Deal;
			case storylets::TraceEvent::Kind::Peek:       return EStoryletLogKind::Peek;
			case storylets::TraceEvent::Kind::Evict:      return EStoryletLogKind::Evict;
			case storylets::TraceEvent::Kind::Play:       return EStoryletLogKind::Play;
			case storylets::TraceEvent::Kind::Write:      return EStoryletLogKind::Write;
			case storylets::TraceEvent::Kind::Turns:      return EStoryletLogKind::Turns;
			default:                                      return EStoryletLogKind::Diagnostic;
		}
	}

	FString ShowLogValue(const std::optional<storylets::StoryletValue>& V)
	{
		return V.has_value() ? Ue(V->toJsonString()) : FString(TEXT("<unset>"));
	}

	FString DealtIds(const std::vector<storylets::TraceCard>& Cards)
	{
		FString Out;
		for (const storylets::TraceCard& C : Cards)
		{
			if (C.verdict != storylets::TraceVerdict::Dealt) continue;
			if (!Out.IsEmpty()) Out += TEXT(", ");
			Out += Ue(C.id);
		}
		return Out.IsEmpty() ? FString(TEXT("(none)")) : Out;
	}

	/** One line per entry, [turn]-stamped where the event has a box context
	 *  (write lines share the state logger's "path: from -> to" reading).
	 *  Number rendering is JS-stable, matching the other examiners. */
	FString FormatLogEntry(const storylets::LogEntry& Entry, const FString& FlowName = FString())
	{
		const FString Stamp = (Entry.turn.has_value()
			? FString::Printf(TEXT("[%s] "), *Ue(storylets::StoryletValue::JsNumber(*Entry.turn)))
			: FString(TEXT("[-] ")))
			+ (FlowName.IsEmpty() ? FString() : FlowName + TEXT(" "));
		const storylets::TraceEvent& E = Entry.event;
		switch (E.kind)
		{
			case storylets::TraceEvent::Kind::Deal:
				return FString::Printf(TEXT("%sdeal %s: %s (%d considered)"),
					*Stamp, *Ue(E.hand), *DealtIds(E.cards), static_cast<int32>(E.cards.size()));
			case storylets::TraceEvent::Kind::Peek:
			{
				FString Crit;
				for (const auto& Pair : E.criteria)
				{
					if (!Crit.IsEmpty()) Crit += TEXT(", ");
					Crit += Ue(Pair.first) + TEXT("=") + Ue(Pair.second);
				}
				const FString Suffix = Crit.IsEmpty() ? FString() : FString::Printf(TEXT(" [%s]"), *Crit);
				return FString::Printf(TEXT("%speek %s%s: %s (%d considered)"),
					*Stamp, *Ue(E.box), *Suffix, *DealtIds(E.cards), static_cast<int32>(E.cards.size()));
			}
			case storylets::TraceEvent::Kind::Evict:
				return FString::Printf(TEXT("%sevict %s from %s (%s)"),
					*Stamp, *Ue(E.card), *Ue(E.hand), *Ue(E.reason));
			case storylets::TraceEvent::Kind::Play:
				return FString::Printf(TEXT("%splay %s -> %s"), *Stamp, *Ue(E.card), *Ue(E.outcome));
			case storylets::TraceEvent::Kind::Write:
				return FString::Printf(TEXT("%swrite %s: %s -> %s"),
					*Stamp, *Ue(E.path), *ShowLogValue(E.prev), *ShowLogValue(E.value));
			case storylets::TraceEvent::Kind::Turns:
				return FString::Printf(TEXT("%sturns %s -> %s"),
					*Stamp, *Ue(E.box), *Ue(storylets::StoryletValue::JsNumber(E.turn)));
			default:
				return FString::Printf(TEXT("%sdiagnostic %s: %s"),
					*Stamp, *Ue(E.where), *Ue(E.message));
		}
	}
}


TArray<FStoryletDealtCard> UStoryletFlow::Deal(const FString& HandRef)
{
	TArray<FStoryletDealtCard> Out;
	if (IsClosed()) return Out;
	try
	{
		for (const storylets::DealtCard& C : GetCoreFlow()->deal(Std(HandRef))) Out.Add(ConvertCard(C));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: Deal - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
	return Out;
}

TArray<FStoryletHandContents> UStoryletFlow::DealMany(const TArray<FString>& HandRefs)
{
	if (IsClosed()) return {};
	try
	{
		std::vector<std::string> Refs;
		Refs.reserve(static_cast<size_t>(HandRefs.Num()));
		for (const FString& R : HandRefs) Refs.push_back(Std(R));
		return ConvertHands(GetCoreFlow()->dealMany(Refs));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: DealMany - %s"), UTF8_TO_TCHAR(Ex.what()));
		return {};
	}
}

TArray<FStoryletHandContents> UStoryletFlow::DealAllHands()
{
	if (IsClosed()) return {};
	try
	{
		return ConvertHands(GetCoreFlow()->dealMany());
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: DealAllHands - %s"), UTF8_TO_TCHAR(Ex.what()));
		return {};
	}
}

TArray<FStoryletDealtCard> UStoryletFlow::Peek(
	const FString& BoxRef, const TMap<FString, FString>& Criteria, int32 MaxCards)
{
	TArray<FStoryletDealtCard> Out;
	if (IsClosed()) return Out;
	try
	{
		storylets::OrderedMap<std::string, std::string> Crit;
		for (const auto& KV : Criteria) Crit.set(Std(KV.Key), Std(KV.Value));
		std::optional<int> N;
		if (MaxCards >= 0) N = MaxCards;
		const storylets::RankedList List = GetCoreFlow()->peek(Std(BoxRef), Crit, N);
		for (const storylets::DealtCard& C : List.cards) Out.Add(ConvertCard(C));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: Peek - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
	return Out;
}

TArray<FStoryletHandContents> UStoryletFlow::Board() const
{
	if (IsClosed()) return {};
	return ConvertHands(GetCoreFlow()->board());
}

TArray<FStoryletHandContents> UStoryletFlow::BoardForBox(const FString& BoxRef) const
{
	if (IsClosed()) return {};
	try
	{
		return ConvertHands(GetCoreFlow()->board(Std(BoxRef)));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: BoardForBox - %s"), UTF8_TO_TCHAR(Ex.what()));
		return {};
	}
}

TArray<FStoryletOutcomeView> UStoryletFlow::Outcomes(const FString& CardRef, const FString& FromHand)
{
	TArray<FStoryletOutcomeView> Out;
	if (IsClosed()) return Out;
	try
	{
		for (const storylets::OutcomeView& O : GetCoreFlow()->outcomes(Std(CardRef), Std(FromHand)))
		{
			FStoryletOutcomeView V;
			V.Id = Ue(O.id);
			V.GameId = Ue(O.gameId);
			V.Title = Ue(O.title);
			V.Purpose = Ue(O.purpose);
			V.bAvailable = O.available;
			Out.Add(MoveTemp(V));
		}
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: Outcomes - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
	return Out;
}

bool UStoryletFlow::Play(
	const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand, FString& OutError)
{
	if (IsClosed())
	{
		OutError = TEXT("this flow is closed");
		return false;
	}
	try
	{
		GetCoreFlow()->play(Std(CardRef), Std(OutcomeGameId), Std(FromHand));
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

bool UStoryletFlow::PlayAdvancing(
	const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand,
	double AdvanceTurns, FString& OutError)
{
	if (IsClosed())
	{
		OutError = TEXT("this flow is closed");
		return false;
	}
	try
	{
		storylets::PlayOptions Opts;
		Opts.advanceTurns = AdvanceTurns;
		GetCoreFlow()->play(Std(CardRef), Std(OutcomeGameId), Std(FromHand), Opts);
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

void UStoryletFlow::AdvanceTurns(const FString& BoxRef, double Turns)
{
	if (IsClosed()) return;
	try
	{
		GetCoreFlow()->advanceTurns(Std(BoxRef), Turns);
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: AdvanceTurns - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
}

double UStoryletFlow::GetTurn(const FString& BoxRef) const
{
	if (IsClosed()) return 0;
	try
	{
		return GetCoreFlow()->turn(Std(BoxRef));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetTurn - %s"), UTF8_TO_TCHAR(Ex.what()));
		return 0;
	}
}

TArray<FStoryletBoxView> UStoryletFlow::ListBoxes() const
{
	TArray<FStoryletBoxView> Out;
	if (IsClosed()) return Out;
	for (const storylets::BoxView& B : GetCoreFlow()->listBoxes())
	{
		FStoryletBoxView V;
		V.Id = Ue(B.id);
		V.GameId = Ue(B.gameId);
		V.Title = Ue(B.title);
		V.Turn = B.turn;
		Out.Add(MoveTemp(V));
	}
	return Out;
}

TArray<FStoryletPropertyView> UStoryletFlow::ListProperties() const
{
	TArray<FStoryletPropertyView> Out;
	if (IsClosed()) return Out;
	for (const storylets::PropertyRow& R : GetCoreFlow()->listProperties())
	{
		FStoryletPropertyView Row;
		Row.Path = Ue(R.path);
		Row.Name = Ue(R.name);
		Row.Type = PropertyTypeFrom(R.type);
		Row.Value = DisplayString(R.value);
		Row.Default = DisplayString(R.defaultValue);
		if (R.values.has_value())
		{
			for (const std::string& V : *R.values) Row.Values.Add(Ue(V));
		}
		if (R.stages.has_value())
		{
			for (const std::string& V : *R.stages) Row.Stages.Add(Ue(V));
		}
		Row.bWritable = R.writable;
		Row.bIsDefault = R.value.valueEquals(R.defaultValue);
		Out.Add(MoveTemp(Row));
	}
	return Out;
}

double UStoryletFlow::GetPropertyNumber(const FString& Path) const
{
	if (IsClosed()) return 0;
	try
	{
		const storylets::StoryletValue V = GetCoreFlow()->getProperty(Std(Path));
		return V.isNumber() ? V.asNumber() : 0;
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyNumber - %s"), UTF8_TO_TCHAR(Ex.what()));
		return 0;
	}
}

FString UStoryletFlow::GetPropertyString(const FString& Path) const
{
	if (IsClosed()) return FString();
	try
	{
		return DisplayString(GetCoreFlow()->getProperty(Std(Path)));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyString - %s"), UTF8_TO_TCHAR(Ex.what()));
		return FString();
	}
}

bool UStoryletFlow::GetPropertyBool(const FString& Path) const
{
	if (IsClosed()) return false;
	try
	{
		const storylets::StoryletValue V = GetCoreFlow()->getProperty(Std(Path));
		return V.isBool() ? V.asBool() : false;
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyBool - %s"), UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

TArray<FString> UStoryletFlow::GetPropertyFlags(const FString& Path) const
{
	TArray<FString> Out;
	if (IsClosed()) return Out;
	try
	{
		const storylets::StoryletValue V = GetCoreFlow()->getProperty(Std(Path));
		if (V.isFlags())
		{
			for (const std::string& F : V.asFlags()) Out.Add(Ue(F));
		}
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyFlags - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
	return Out;
}

void UStoryletFlow::SetPropertyNumber(const FString& Path, double Value)
{
	SetPropertyGuarded(GetCoreFlow(), Path, storylets::StoryletValue::Num(Value), TEXT("SetPropertyNumber"));
}

void UStoryletFlow::SetPropertyBool(const FString& Path, bool bValue)
{
	SetPropertyGuarded(GetCoreFlow(), Path, storylets::StoryletValue::Bool(bValue), TEXT("SetPropertyBool"));
}

void UStoryletFlow::SetPropertyString(const FString& Path, const FString& Value)
{
	SetPropertyGuarded(GetCoreFlow(), Path, storylets::StoryletValue::Str(Std(Value)), TEXT("SetPropertyString"));
}

void UStoryletFlow::SetPropertyFlags(const FString& Path, const TArray<FString>& Values)
{
	std::vector<std::string> Flags;
	Flags.reserve(static_cast<size_t>(Values.Num()));
	for (const FString& V : Values) Flags.push_back(Std(V));
	SetPropertyGuarded(GetCoreFlow(), Path, storylets::StoryletValue::Flags(std::move(Flags)), TEXT("SetPropertyFlags"));
}

int32 UStoryletEngine::SubscribeTrace(TFunction<void(const FString&, const storylets::TraceEvent&)> Handler)
{
	if (!IsValidEngine() || !Handler) return 0;
	const int32 Handle = Impl->NextTraceHandle++;
	Impl->TraceHandlers.Add(Handle, MoveTemp(Handler));
	SyncCoreTraceHook();
	return Handle;
}

void UStoryletEngine::UnsubscribeTrace(int32 Handle)
{
	if (!Impl.IsValid() || Handle == 0) return;
	Impl->TraceHandlers.Remove(Handle);
	SyncCoreTraceHook();
}

/** One core subscription behind however many wrapper handlers there are, taken
 *  and dropped with the first and last of them, and re-taken after a swap. */
void UStoryletEngine::SyncCoreTraceHook()
{
	if (!Impl.IsValid()) return;
	const bool bWant = Impl->TraceHandlers.Num() > 0 && IsValidEngine();
	if (bWant == static_cast<bool>(Impl->UnsubscribeCore)) return;
	if (!bWant)
	{
		Impl->UnsubscribeCore();
		Impl->UnsubscribeCore = nullptr;
		return;
	}
	TWeakObjectPtr<UStoryletEngine> Weak(this);
	Impl->UnsubscribeCore = Impl->Engine->subscribeTrace(
		[Weak](const std::string& FlowId, const storylets::TraceEvent& Event)
		{
			UStoryletEngine* Self = Weak.Get();
			if (!Self || !Self->Impl.IsValid()) return;
			const FString Id = Ue(FlowId);
			// A copy: a handler may unsubscribe from inside its own call.
			TArray<TFunction<void(const FString&, const storylets::TraceEvent&)>> Handlers;
			for (const auto& Pair : Self->Impl->TraceHandlers) Handlers.Add(Pair.Value);
			for (const auto& H : Handlers) H(Id, Event);
		});
}

TArray<FStoryletLogEntry> UStoryletEngine::GetRunLog() const
{
	TArray<FStoryletLogEntry> Out;
	if (!IsValidEngine()) return Out;
	for (const storylets::EngineLogEntry& Entry : Impl->Engine->log())
	{
		FStoryletLogEntry E;
		E.Flow = Ue(Entry.flow);
		E.Kind = LogKindFrom(Entry.event.kind);
		E.Seq = Entry.seq;
		E.bHasTurn = Entry.turn.has_value();
		E.Turn = Entry.turn.value_or(0);
		// The run's log names the flow that acted; a flow's own log does not,
		// because its section heading already says whose it is.
		E.Summary = FormatLogEntry(storylets::LogEntry{ Entry.event, Entry.seq, Entry.turn }, Ue(Entry.flow));
		Out.Add(MoveTemp(E));
	}
	return Out;
}

void UStoryletEngine::ClearRunLog()
{
	if (IsValidEngine()) Impl->Engine->clearLog();
}

TArray<FStoryletLogEntry> UStoryletFlow::Log() const
{
	TArray<FStoryletLogEntry> Out;
	if (IsClosed()) return Out;
	for (const storylets::LogEntry& Entry : GetCoreFlow()->log())
	{
		FStoryletLogEntry E;
		E.Kind = LogKindFrom(Entry.event.kind);
		E.Seq = Entry.seq;
		E.bHasTurn = Entry.turn.has_value();
		E.Turn = Entry.turn.value_or(0);
		E.Summary = FormatLogEntry(Entry);
		Out.Add(MoveTemp(E));
	}
	return Out;
}

void UStoryletFlow::ClearLog()
{
	if (IsClosed()) return;
	GetCoreFlow()->clearLog();
}

void UStoryletFlow::SyncCoreTraceHook()
{
	if (IsClosed()) return;
	const bool bWanted = Impl->TraceHandlers.Num() > 0;
	const bool bInstalled = static_cast<bool>(Impl->UnsubscribeCore);
	if (bWanted == bInstalled) return;
	if (!bWanted)
	{
		Impl->UnsubscribeCore();
		Impl->UnsubscribeCore = nullptr;
		return;
	}
	FStoryletFlowImpl* Raw = Impl.Get();
	Impl->UnsubscribeCore = GetCoreFlow()->subscribeTrace([Raw](const storylets::TraceEvent& Event)
	{
		// Copied first: a handler may unsubscribe from inside the call.
		TArray<TFunction<void(const storylets::TraceEvent&)>> Handlers;
		Raw->TraceHandlers.GenerateValueArray(Handlers);
		for (const TFunction<void(const storylets::TraceEvent&)>& Handler : Handlers)
		{
			Handler(Event);
		}
	});
}

int32 UStoryletFlow::SubscribeTrace(TFunction<void(const storylets::TraceEvent&)> Handler)
{
	if (IsClosed() || !Handler) return 0;
	const int32 Handle = Impl->NextTraceHandle++;
	Impl->TraceHandlers.Add(Handle, MoveTemp(Handler));
	SyncCoreTraceHook();
	return Handle;
}

void UStoryletFlow::UnsubscribeTrace(int32 Handle)
{
	if (!Impl.IsValid() || Handle == 0) return;
	Impl->TraceHandlers.Remove(Handle);
	SyncCoreTraceHook();
}

TArray<FStoryletPropertyView> UStoryletEngine::ListProperties() const
{
	TArray<FStoryletPropertyView> Out;
	if (!IsValidEngine()) return Out;
	for (const storylets::PropertyRow& R : Impl->Engine->listProperties())
	{
		FStoryletPropertyView Row;
		Row.Path = Ue(R.path);
		Row.Name = Ue(R.name);
		Row.Type = PropertyTypeFrom(R.type);
		Row.Value = DisplayString(R.value);
		Row.Default = DisplayString(R.defaultValue);
		if (R.values.has_value())
		{
			for (const std::string& V : *R.values) Row.Values.Add(Ue(V));
		}
		if (R.stages.has_value())
		{
			for (const std::string& V : *R.stages) Row.Stages.Add(Ue(V));
		}
		Row.bWritable = R.writable;
		Row.bIsDefault = R.value.valueEquals(R.defaultValue);
		Out.Add(MoveTemp(Row));
	}
	return Out;
}

double UStoryletEngine::GetPropertyNumber(const FString& Path) const
{
	if (!IsValidEngine()) return 0;
	try
	{
		const storylets::StoryletValue V = Impl->Engine->getProperty(Std(Path));
		return V.isNumber() ? V.asNumber() : 0;
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyNumber - %s"), UTF8_TO_TCHAR(Ex.what()));
		return 0;
	}
}

FString UStoryletEngine::GetPropertyString(const FString& Path) const
{
	if (!IsValidEngine()) return FString();
	try
	{
		return DisplayString(Impl->Engine->getProperty(Std(Path)));
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyString - %s"), UTF8_TO_TCHAR(Ex.what()));
		return FString();
	}
}

bool UStoryletEngine::GetPropertyBool(const FString& Path) const
{
	if (!IsValidEngine()) return false;
	try
	{
		const storylets::StoryletValue V = Impl->Engine->getProperty(Std(Path));
		return V.isBool() ? V.asBool() : false;
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyBool - %s"), UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

TArray<FString> UStoryletEngine::GetPropertyFlags(const FString& Path) const
{
	TArray<FString> Out;
	if (!IsValidEngine()) return Out;
	try
	{
		const storylets::StoryletValue V = Impl->Engine->getProperty(Std(Path));
		if (V.isFlags())
		{
			for (const std::string& F : V.asFlags()) Out.Add(Ue(F));
		}
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogTemp, Warning, TEXT("Storylet Engine: GetPropertyFlags - %s"), UTF8_TO_TCHAR(Ex.what()));
	}
	return Out;
}

void UStoryletEngine::SetPropertyNumber(const FString& Path, double Value)
{
	SetPropertyGuarded(GetCoreEngine(), Path, storylets::StoryletValue::Num(Value), TEXT("SetPropertyNumber"));
}

void UStoryletEngine::SetPropertyBool(const FString& Path, bool bValue)
{
	SetPropertyGuarded(GetCoreEngine(), Path, storylets::StoryletValue::Bool(bValue), TEXT("SetPropertyBool"));
}

void UStoryletEngine::SetPropertyString(const FString& Path, const FString& Value)
{
	SetPropertyGuarded(GetCoreEngine(), Path, storylets::StoryletValue::Str(Std(Value)), TEXT("SetPropertyString"));
}

void UStoryletEngine::SetPropertyFlags(const FString& Path, const TArray<FString>& Values)
{
	std::vector<std::string> Flags;
	Flags.reserve(static_cast<size_t>(Values.Num()));
	for (const FString& V : Values) Flags.push_back(Std(V));
	SetPropertyGuarded(GetCoreEngine(), Path, storylets::StoryletValue::Flags(std::move(Flags)), TEXT("SetPropertyFlags"));
}

bool UStoryletEngine::ApplyLiveBundle(UStoryletBundle* NewBundle, FString& OutError)
{
	if (!IsValidEngine())
	{
		OutError = TEXT("invalid engine");
		return false;
	}
	if (!NewBundle || !NewBundle->GetCompiled() || !NewBundle->GetCompiled()->Bundle)
	{
		OutError = TEXT("null or uncompiled bundle");
		return false;
	}
	try
	{
		// The new core is built and loaded BEFORE anything is swapped, so a
		// refused save (another project) leaves this engine exactly as it was.
		const storylets::SaveEnvelope Snapshot = Impl->Engine->saveGame();
		storylets::BundlePtr NextBundle = NewBundle->GetCompiled()->Bundle;
		std::unique_ptr<storylets::Engine> Next = std::make_unique<storylets::Engine>(NextBundle, Impl->Options);
		Next->loadGame(Snapshot);
		// The old core is about to go, and the hook we took on it with it. Drop
		// it first so SyncCoreTraceHook below re-takes one on the NEW core:
		// without this the engine's subscribers (Live Link among them) go quiet
		// after a live refresh, which the smoke test caught.
		if (Impl->UnsubscribeCore)
		{
			Impl->UnsubscribeCore();
			Impl->UnsubscribeCore = nullptr;
		}
		Impl->Engine = std::move(Next);
		Impl->Bundle = NextBundle;
		BundleRef = NewBundle;
		SyncCoreTraceHook();
		// Applied IN PLACE: this UObject and every wrapper handed out stay
		// valid, each re-bound to the flow of the same id inside the new core
		// (null when that flow did not survive, which reads as closed). The
		// Patterplay precedent - a Blueprint variable holding a flow keeps
		// working across a live refresh.
		RebindFlowsAfterLoad();
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = FString(UTF8_TO_TCHAR(Ex.what()));
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: ApplyLiveBundle - %s"), *OutError);
		return false;
	}
}

storylets::Engine* UStoryletEngine::GetCoreEngine() const
{
	return Impl.IsValid() ? Impl->Engine.get() : nullptr;
}

void UStoryletEngine::RegisterForDebug(const FString& Label)
{
	FStoryletDebug::Register(this, Label.IsEmpty() ? GetName() : Label);
}

void UStoryletEngine::UnregisterForDebug()
{
	FStoryletDebug::Unregister(this);
}

void UStoryletEngine::RebindFlowsAfterLoad()
{
	if (!IsValidEngine()) return;
	WrappedFlows.RemoveAll([](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid(); });
	for (const TWeakObjectPtr<UStoryletFlow>& Weak : WrappedFlows)
	{
		if (UStoryletFlow* Wrapper = Weak.Get())
		{
			Wrapper->Rebind(Impl->Engine->getFlow(Std(Wrapper->GetFlowId())));
		}
	}
}

void UStoryletEngine::BeginDestroy()
{
	FStoryletDebug::Unregister(this);
	Super::BeginDestroy();
}
