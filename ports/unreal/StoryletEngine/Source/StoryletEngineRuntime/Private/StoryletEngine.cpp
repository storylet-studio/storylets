#include "StoryletEngine.h"
#include "StoryletLog.h"
#include "StoryletWorld.h"

#include "StoryletBundle.h"
#include "StoryletCompiledBundle.h"
#include "StoryletDebug.h"
#include "StoryletSaveJson.h"
#include "StoryletValueConvert.h"

#include "Storylets/Engine.h"
#include "Storylets/Save.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

/** The engine's Pimpl: the std engine plus the shared compiled bundle, so the
 *  model outlives the asset for as long as this engine does. */
struct FStoryletEngineImpl
{
	storylets::BundlePtr Bundle;
	std::unique_ptr<storylets::Engine> Engine;
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

using StoryletConvert::Std;
using StoryletConvert::Ue;

namespace
{
	TArray<FStoryletFieldEntry> ConvertFields(const storylets::OrderedMap<std::string, storylets::StoryletValue>& Fields)
	{
		TArray<FStoryletFieldEntry> Out;
		Out.Reserve(static_cast<int32>(Fields.size()));
		for (const auto& Pair : Fields)
		{
			FStoryletFieldEntry Entry;
			Entry.Name = Ue(Pair.first);
			Entry.Value = StoryletValueToUe(Pair.second);
			Out.Add(MoveTemp(Entry));
		}
		return Out;
	}

	FStoryletDealtCard ConvertCard(const storylets::DealtCard& C)
	{
		FStoryletDealtCard Out;
		Out.Id = Ue(C.id);
		Out.GameId = Ue(C.gameId);
		Out.Title = Ue(C.title);
		Out.Purpose = Ue(C.purpose);
		Out.Fields = ConvertFields(C.fields);
		Out.Extensions = StoryletExtensionsToUe(C.extensions);
		return Out;
	}

	TArray<FStoryletDealtCard> ConvertCards(const std::vector<storylets::DealtCard>& Cards)
	{
		TArray<FStoryletDealtCard> Out;
		Out.Reserve(static_cast<int32>(Cards.size()));
		for (const storylets::DealtCard& C : Cards) Out.Add(ConvertCard(C));
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
			Contents.Cards = ConvertCards(Pair.second);
			Out.Add(MoveTemp(Contents));
		}
		return Out;
	}

	/** The examiner rows, the engine's and a flow's alike. */
	TArray<FStoryletPropertyView> ConvertRows(const std::vector<storylets::PropertyRow>& Rows)
	{
		TArray<FStoryletPropertyView> Out;
		Out.Reserve(static_cast<int32>(Rows.size()));
		for (const storylets::PropertyRow& R : Rows)
		{
			FStoryletPropertyView Row;
			Row.Path = Ue(R.path);
			Row.Name = Ue(R.name);
			Row.Type = StoryletConvert::PropertyTypeFrom(R.type);
			Row.Value = StoryletValueDisplay(R.value);
			Row.Default = StoryletValueDisplay(R.defaultValue);
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

	/** A refusal at the Blueprint boundary, with the core's own message. A
	 *  read (a getter, a turn) logs at Warning and a verb at Error, as each
	 *  always has: an unexpected one fails an automation test either way. */
	void LogRefusal(const TCHAR* Where, const FString& Message, bool bRead)
	{
		if (bRead)
		{
			UE_LOG(LogStoryletEngine, Warning, TEXT("Storylet Engine: %s - %s"), Where, *Message);
		}
		else
		{
			UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: %s - %s"), Where, *Message);
		}
	}

	/** One core call at the Blueprint boundary: whatever it throws is logged
	 *  and `Fallback` comes back, so no C++ exception ever reaches a Blueprint
	 *  graph (a host @world resolver may throw anything, so not only
	 *  std::exception). */
	template <typename TResult, typename TBody>
	TResult Guard(const TCHAR* Where, bool bRead, TResult Fallback, TBody&& Body)
	{
		try
		{
			return Body();
		}
		catch (const std::exception& Ex)
		{
			LogRefusal(Where, Ue(Ex.what()), bRead);
		}
		catch (...)
		{
			LogRefusal(Where, TEXT("an unknown exception"), bRead);
		}
		return Fallback;
	}

	/** One refusing call at the Blueprint boundary (the convention at the top
	 *  of StoryletEngine.h): LastError cleared, the core call made, and on a
	 *  throw its message kept in LastError and logged, with `Fallback` handed
	 *  back. */
	template <typename TResult, typename TBody>
	TResult Refusing(FString& LastError, const TCHAR* Where, TResult Fallback, TBody&& Body)
	{
		LastError.Reset();
		try
		{
			return Body();
		}
		catch (const std::exception& Ex)
		{
			LastError = Ue(Ex.what());
		}
		catch (...)
		{
			LastError = TEXT("an unknown exception");
		}
		LogRefusal(Where, LastError, false);
		return Fallback;
	}

	/** A refusing setter: "" when Body landed, else its refusal, kept in
	 *  LastError and logged as Refusing does. */
	template <typename TBody>
	FString Refusal(FString& LastError, const TCHAR* Where, TBody&& Body)
	{
		Refusing(LastError, Where, 0, [&] { Body(); return 0; });
		return LastError;
	}

	/** One property read for either target, the engine (shared and @world
	 *  paths) or a flow (its merged view): neither shares a base, and the
	 *  four typed getters on each were the same code eight times. Unset when
	 *  the core refused, having logged why. */
	template <typename TTarget>
	TOptional<storylets::StoryletValue> ReadProperty(const TTarget& Target, const FString& Path, const TCHAR* Where)
	{
		return Guard(Where, true, TOptional<storylets::StoryletValue>(), [&]
		{
			return TOptional<storylets::StoryletValue>(Target.getProperty(Std(Path)));
		});
	}

	double AsNumber(const TOptional<storylets::StoryletValue>& V) { return V && V->isNumber() ? V->asNumber() : 0; }
	bool AsBool(const TOptional<storylets::StoryletValue>& V) { return V && V->isBool() ? V->asBool() : false; }
	FString AsDisplay(const TOptional<storylets::StoryletValue>& V) { return V ? StoryletValueDisplay(*V) : FString(); }
	TArray<FString> AsFlags(const TOptional<storylets::StoryletValue>& V)
	{
		TArray<FString> Out;
		if (V && V->isFlags())
		{
			for (const std::string& F : V->asFlags()) Out.Add(Ue(F));
		}
		return Out;
	}

	storylets::StoryletValue FlagsValue(const TArray<FString>& Values)
	{
		std::vector<std::string> Flags;
		Flags.reserve(static_cast<size_t>(Values.Num()));
		for (const FString& V : Values) Flags.push_back(Std(V));
		return storylets::StoryletValue::Flags(std::move(Flags));
	}

	/** One host write, for either target: a host write is silent under the
	 *  firing rule and visible to the audit hook. "" when it landed, else the
	 *  refusal (kept in LastError and logged). Templated because the engine
	 *  and a flow both take setProperty and neither shares a base. */
	template <typename TTarget>
	FString SetPropertyRefusing(TTarget& Target, FString& LastError, const FString& Path,
		const storylets::StoryletValue& Value, const TCHAR* Where)
	{
		return Refusal(LastError, Where, [&] { Target.setProperty(Std(Path), Value); });
	}

	const TCHAR* InvalidEngine = TEXT("the engine is invalid (Create failed)");
}

UStoryletEngine* UStoryletEngine::Create(UStoryletBundle* Bundle, const TMap<FString, UStoryletWorld*>& HostScopes)
{
	return CreateOn(Bundle, nullptr, HostScopes, FStoryletEngineOptions());
}

UStoryletEngine* UStoryletEngine::CreateWithOptions(UStoryletBundle* Bundle, const FStoryletEngineOptions& Options,
	const TMap<FString, UStoryletWorld*>& HostScopes)
{
	return CreateOn(Bundle, nullptr, HostScopes, Options);
}

UStoryletEngine* UStoryletEngine::CreateWithRegistry(UStoryletBundle* Bundle, const std::shared_ptr<storylets::ScopeRegistry>& Registry,
	const TMap<FString, UStoryletWorld*>& HostScopes, const FStoryletEngineOptions& Options)
{
	if (!Registry)
	{
		UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: CreateWithRegistry called with a null registry"));
		return nullptr;
	}
	return CreateOn(Bundle, Registry, HostScopes, Options);
}

std::shared_ptr<storylets::ScopeRegistry> UStoryletEngine::GetRegistry() const
{
	return IsValidEngine() ? Impl->Engine->registry() : nullptr;
}

UStoryletEngine* UStoryletEngine::CreateOn(UStoryletBundle* Bundle, std::shared_ptr<storylets::ScopeRegistry> Registry,
	const TMap<FString, UStoryletWorld*>& HostScopes, const FStoryletEngineOptions& Options)
{
	if (!Bundle || !Bundle->GetCompiled() || !Bundle->GetCompiled()->Bundle)
	{
		UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: Create called with a null/uncompiled bundle"));
		return nullptr;
	}
	UStoryletEngine* E = NewObject<UStoryletEngine>(GetTransientPackage());
	E->BundleRef = Bundle;
	try
	{
		storylets::EngineOptions Opts;
		Opts.seed = static_cast<double>(Options.Seed);
		Opts.log = Options.bLog;
		// Null: the engine makes its own registry and acts as its own game.
		// The core keeps its options, so ApplyLiveBundle's hotSwap lands in the same one.
		Opts.registry = MoveTemp(Registry);
		// Each bound container is an external scope in the registry under its
		// token, read and written through the container. Kept by the core too,
		// so ApplyLiveBundle's hotSwap keeps the bindings. A null container
		// binds nothing (the scope is self-backed, as if it weren't in the map).
		for (const TPair<FString, UStoryletWorld*>& Scope : HostScopes)
		{
			if (!Scope.Value) continue;
			Opts.hostScopes[Std(Scope.Key)] = Scope.Value->MakeHostScope();
			E->HostScopeRefs.Add(Scope.Key, Scope.Value);
		}
		// The core's diagnostic hook, onto the Blueprint delegate. Weak, and kept
		// in the core's options like the rest, so a live swap carries it across.
		TWeakObjectPtr<UStoryletEngine> Weak(E);
		Opts.onReplacedFlow = [Weak](const std::string& FlowId, int Dealt)
		{
			if (UStoryletEngine* Self = Weak.Get()) Self->OnReplacedFlow.Broadcast(Ue(FlowId), static_cast<int32>(Dealt));
		};
		// A condition the core played through: the Blueprint event, or with
		// nothing bound a Warning in the log, so a content bug is never silent.
		// A set-up report is always a Warning, as Patterplay's is; one found
		// while the core is being built comes before a game can bind OnError,
		// so it is held and delivered on the first OpenFlow (as Patterplay's,
		// ruled 2026-10-28). The core has already put it in the retained log.
		Opts.onError = [Weak](const storylets::PlayError& Err)
		{
			UStoryletEngine* Self = Weak.Get();
			const bool bSetup = Err.kind == "setup";
			if (bSetup)
			{
				UE_LOG(LogStoryletEngine, Warning, TEXT("Storylet Engine: %s"), *Ue(Err.message));
			}
			else if (!Self || !Self->OnError.IsBound())
			{
				UE_LOG(LogStoryletEngine, Warning, TEXT("Storylet Engine: the condition on %s in flow '%s' failed, counted as false: %s"),
					*Ue(Err.node), *Ue(Err.flow), *Ue(Err.message));
				return;
			}
			if (!Self) return;
			FStoryletPlayError Out;
			Out.Flow = Ue(Err.flow);
			Out.Kind = Ue(Err.kind);
			Out.Node = Ue(Err.node);
			Out.Source = Ue(Err.source);
			Out.Message = Ue(Err.message);
			if (Self->bBuilding)
			{
				Self->HeldErrors.Add(MoveTemp(Out));
				return;
			}
			Self->OnError.Broadcast(Out);
		};
		TPimplPtr<FStoryletEngineImpl> Impl = MakePimpl<FStoryletEngineImpl>();
		Impl->Bundle = Bundle->GetCompiled()->Bundle;
		E->bBuilding = true;
		Impl->Engine = std::make_unique<storylets::Engine>(Impl->Bundle, Opts);
		E->bBuilding = false;
		E->Impl = MoveTemp(Impl);
		// No flow is opened here: play happens on one you open by name
		// (design/flows.md - there is no default flow).
	}
	catch (const std::exception& Ex)
	{
		UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: %s"), *Ue(Ex.what()));
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

FString UStoryletFlow::ClosedMessage() const
{
	return FString::Printf(TEXT("flow \"%s\" is closed"), *Id);
}

bool UStoryletFlow::RefuseClosed(const TCHAR* Verb, bool bRead) const
{
	if (!IsClosed()) return false;
	LogRefusal(Verb, ClosedMessage(), bRead);
	return true;
}

bool UStoryletFlow::RefuseClosedCall(const TCHAR* Verb) const
{
	LastError.Reset();
	if (!IsClosed()) return false;
	LastError = ClosedMessage();
	LogRefusal(Verb, LastError, false);
	return true;
}

void UStoryletEngine::NoteRefusal(const TCHAR* Verb, const FString& Message) const
{
	LastError = Message;
	LogRefusal(Verb, Message, false);
}

void UStoryletFlow::Close()
{
	LastError.Reset();
	if (IsClosed()) return;
	if (Owner) Owner->CloseFlow(Id);
	else Refusing(LastError, TEXT("Close"), 0, [this] { Impl->Flow->close(); return 0; });
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

void UStoryletEngine::DeliverHeldErrors()
{
	if (HeldErrors.Num() == 0) return;
	// Taken out first, so a handler that opens a flow doesn't hear them twice.
	const TArray<FStoryletPlayError> Held = MoveTemp(HeldErrors);
	HeldErrors.Reset();
	for (const FStoryletPlayError& Err : Held) OnError.Broadcast(Err);
}

UStoryletFlow* UStoryletEngine::OpenFlowWith(const FString& FlowId, const storylets::OpenFlowOptions& Options, const TCHAR* Verb)
{
	if (!IsValidEngine())
	{
		NoteRefusal(Verb, InvalidEngine);
		return nullptr;
	}
	DeliverHeldErrors();   // what the engine reported while it was built, now OnError can have been bound
	return Refusing(LastError, Verb, static_cast<UStoryletFlow*>(nullptr), [&]() -> UStoryletFlow*
	{
		// Re-opening a name REPLACES: the core closes the old flow, so any
		// wrapper still holding it reads as closed from that moment. A restore
		// lands in the fresh flow before the core hands it back.
		const storylets::FlowPtr Core = Impl->Engine->openFlow(Std(FlowId), Options);
		UStoryletFlow* Wrapper = NewObject<UStoryletFlow>(GetTransientPackage());
		Wrapper->Init(this, FlowId, Core);
		// The replaced flow's wrapper leaves the list: kept, the next re-bind
		// by id would point it at this new flow.
		WrappedFlows.RemoveAll([&FlowId](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid() || W->GetFlowId() == FlowId; });
		WrappedFlows.Add(Wrapper);
		return Wrapper;
	});
}

UStoryletFlow* UStoryletEngine::OpenFlow(const FString& FlowId)
{
	return OpenFlowWith(FlowId, storylets::OpenFlowOptions(), TEXT("OpenFlow"));
}

UStoryletFlow* UStoryletEngine::OpenFlowSeeded(const FString& FlowId, int32 Seed)
{
	storylets::OpenFlowOptions Options;
	Options.seed = static_cast<double>(Seed);
	return OpenFlowWith(FlowId, Options, TEXT("OpenFlowSeeded"));
}

FString UStoryletEngine::SaveFlowToJson(const FString& FlowId) const
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SaveFlowToJson"), InvalidEngine);
		return FString();
	}
	return Refusing(LastError, TEXT("SaveFlowToJson"), FString(), [&]
	{
		return Ue(storylets::serializeFlow(Impl->Engine->saveFlow(Std(FlowId))));
	});
}

UStoryletFlow* UStoryletEngine::OpenFlowFromJson(const FString& FlowId, const FString& Json, FString& OutReportJson)
{
	OutReportJson.Reset();
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("OpenFlowFromJson"), InvalidEngine);
		return nullptr;
	}
	storylets::OpenFlowOptions Options;
	const bool bParsed = Refusing(LastError, TEXT("OpenFlowFromJson"), false, [&]
	{
		Options.restore = storylets::deserializeFlow(Std(Json));
		return true;
	});
	if (!bParsed) return nullptr;
	// The restore's report has nowhere else to go, since the call hands back
	// the flow: the core passes it here as the restore lands.
	Options.onRestoreReport = [&OutReportJson](const storylets::LoadReport& Report)
	{
		OutReportJson = Ue(storylets::reportToJson(Report));
	};
	return OpenFlowWith(FlowId, Options, TEXT("OpenFlowFromJson"));
}

FString UStoryletEngine::PreviewFlowRestoreJson(const FString& FlowId, const FString& Json) const
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("PreviewFlowRestoreJson"), InvalidEngine);
		return FString();
	}
	return Refusing(LastError, TEXT("PreviewFlowRestoreJson"), FString(), [&]
	{
		const storylets::FlowSave Saved = storylets::deserializeFlow(Std(Json));
		return Ue(storylets::reportToJson(Impl->Engine->previewFlowRestore(Std(FlowId), Saved)));
	});
}

// --- UStoryletEngine: durable state (ruling H) ------------------------------------

FString UStoryletEngine::SaveDurableToJson() const
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SaveDurableToJson"), InvalidEngine);
		return FString();
	}
	return Refusing(LastError, TEXT("SaveDurableToJson"), FString(), [&]
	{
		return Ue(storylets::serializeDurable(Impl->Engine->saveDurable()));
	});
}

bool UStoryletEngine::LoadDurableFromJson(const FString& Json, FString& OutReportJson)
{
	OutReportJson.Reset();
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("LoadDurableFromJson"), InvalidEngine);
		return false;
	}
	// The core refuses a malformed, foreign or unknown half before anything
	// moves, so a false here leaves the engine as it was.
	return Refusing(LastError, TEXT("LoadDurableFromJson"), false, [&]
	{
		const storylets::DurableSave Memory = storylets::deserializeDurable(Std(Json));
		OutReportJson = Ue(storylets::reportToJson(Impl->Engine->loadDurable(Memory)));
		return true;
	});
}

UStoryletFlow* UStoryletEngine::OpenFlowWithDurableJson(const FString& FlowId, const FString& Json, FString& OutReportJson)
{
	return OpenFlowWithDurable(FlowId, Json, TOptional<int32>(), OutReportJson, TEXT("OpenFlowWithDurableJson"));
}

UStoryletFlow* UStoryletEngine::OpenFlowWithDurableJsonSeeded(const FString& FlowId, const FString& Json, int32 Seed,
	FString& OutReportJson)
{
	return OpenFlowWithDurable(FlowId, Json, Seed, OutReportJson, TEXT("OpenFlowWithDurableJsonSeeded"));
}

UStoryletFlow* UStoryletEngine::OpenFlowWithDurable(const FString& FlowId, const FString& Json, TOptional<int32> Seed,
	FString& OutReportJson, const TCHAR* Verb)
{
	OutReportJson.Reset();
	if (!IsValidEngine())
	{
		NoteRefusal(Verb, InvalidEngine);
		return nullptr;
	}
	storylets::OpenFlowOptions Options;
	if (Seed.IsSet()) Options.seed = static_cast<double>(Seed.GetValue());
	const bool bParsed = Refusing(LastError, Verb, false, [&]
	{
		Options.durable = storylets::deserializeDurable(Std(Json));
		return true;
	});
	if (!bParsed) return nullptr;
	// The pocket's report, handed over as it lands, as OpenFlowFromJson's is.
	// A refusal (an unknown schema, another project's pocket) comes before the
	// name is touched, so the flow open under it stays as it was.
	Options.onRestoreReport = [&OutReportJson](const storylets::LoadReport& Report)
	{
		OutReportJson = Ue(storylets::reportToJson(Report));
	};
	return OpenFlowWith(FlowId, Options, Verb);
}

UStoryletFlow* UStoryletEngine::GetFlow(const FString& FlowId) const
{
	if (!IsValidEngine()) return nullptr;
	const storylets::FlowPtr Core = Impl->Engine->getFlow(Std(FlowId));
	if (!Core) return nullptr;
	// The wrapper already made for THIS flow, matched by the flow it holds.
	for (const TWeakObjectPtr<UStoryletFlow>& Weak : WrappedFlows)
	{
		UStoryletFlow* Wrapper = Weak.Get();
		if (Wrapper && Wrapper->GetCoreFlow() == Core.get()) return Wrapper;
	}
	// None: a flow a load restored into an engine that never opened it (the
	// JS getFlow answers with every restored flow). Wrap it now, once, and
	// keep it with the others so the next load or swap re-binds it.
	UStoryletFlow* Wrapper = NewObject<UStoryletFlow>(GetTransientPackage());
	Wrapper->Init(const_cast<UStoryletEngine*>(this), FlowId, Core);
	WrappedFlows.RemoveAll([](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid(); });
	WrappedFlows.Add(Wrapper);
	return Wrapper;
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
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("CloseFlow"), InvalidEngine);
		return;
	}
	Refusing(LastError, TEXT("CloseFlow"), 0, [&] { Impl->Engine->closeFlow(Std(FlowId)); return 0; });
	// The wrappers hold a shared_ptr, so nothing dangles; the core's own
	// closed flag is what makes them inert from here. The wrapper leaves the
	// list, so a later load's re-bind cannot revive it.
	WrappedFlows.RemoveAll([&FlowId](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid() || W->GetFlowId() == FlowId; });
}

void UStoryletEngine::Reset()
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("Reset"), InvalidEngine);
		return;
	}
	Refusing(LastError, TEXT("Reset"), 0, [this] { Impl->Engine->reset(); return 0; });
	WrappedFlows.Reset(); // every flow went with it, closed for good
}

bool UStoryletEngine::IsValidEngine() const
{
	return Impl.IsValid() && Impl->Engine != nullptr;
}

// --- the logs -----------------------------------------------------------------

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
			case storylets::TraceEvent::Kind::Discard:    return EStoryletLogKind::Discard;
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
	FString FormatLogEntry(const storylets::TraceEvent& E, const std::optional<double>& Turn, const FString& FlowName)
	{
		const FString Stamp = (Turn.has_value()
			? FString::Printf(TEXT("[%s] "), *Ue(storylets::StoryletValue::JsNumber(*Turn)))
			: FString(TEXT("[-] ")))
			+ (FlowName.IsEmpty() ? FString() : FlowName + TEXT(" "));
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
				// A card with no outcomes is played with none: "play <card>".
				if (E.outcome.empty()) return FString::Printf(TEXT("%splay %s"), *Stamp, *Ue(E.card));
				return FString::Printf(TEXT("%splay %s -> %s"), *Stamp, *Ue(E.card), *Ue(E.outcome));
			case storylets::TraceEvent::Kind::Write:
				return FString::Printf(TEXT("%swrite %s: %s -> %s"),
					*Stamp, *Ue(E.path), *ShowLogValue(E.prev), *ShowLogValue(E.value));
			case storylets::TraceEvent::Kind::Turns:
				return FString::Printf(TEXT("%sturns %s -> %s"),
					*Stamp, *Ue(E.box), *Ue(storylets::StoryletValue::JsNumber(E.turn)));
			case storylets::TraceEvent::Kind::Discard:
				// A card the game took out of its hand unplayed.
				return FString::Printf(TEXT("%sdiscard %s from %s"), *Stamp, *Ue(E.card), *Ue(E.hand));
			default:
				return FString::Printf(TEXT("%sdiagnostic %s: %s"),
					*Stamp, *Ue(E.where), *Ue(E.message));
		}
	}

	/** One retained entry, a flow's or the run's. The run's log names the flow
	 *  that acted, on the entry and in its Summary; a flow's own log does not,
	 *  because its section heading already says whose it is. */
	FStoryletLogEntry ConvertLogEntry(const storylets::TraceEvent& Event, int64 Seq,
		const std::optional<double>& Turn, const FString& FlowName)
	{
		FStoryletLogEntry E;
		E.Flow = FlowName;
		E.Kind = LogKindFrom(Event.kind);
		E.Seq = Seq;
		E.bHasTurn = Turn.has_value();
		E.Turn = Turn.value_or(0);
		E.Summary = FormatLogEntry(Event, Turn, FlowName);
		// The event itself, every field copied: the core leaves the ones its
		// kind does not name empty, so the entry does too.
		E.Hand = Ue(Event.hand);
		E.Box = Ue(Event.box);
		E.Card = Ue(Event.card);
		E.Outcome = Ue(Event.outcome);
		E.Reason = Ue(Event.reason);
		E.Target = Ue(Event.target);
		E.Path = Ue(Event.path);
		if (Event.value.has_value()) E.ValueJson = Ue(Event.value->toJsonString());
		if (Event.prev.has_value()) E.PrevJson = Ue(Event.prev->toJsonString());
		E.Where = Ue(Event.where);
		E.Message = Ue(Event.message);
		for (const auto& Pair : Event.criteria)
		{
			E.Criteria.Add(Ue(Pair.first), Ue(Pair.second));
		}
		E.Cards.Reserve(static_cast<int32>(Event.cards.size()));
		for (const storylets::TraceCard& C : Event.cards)
		{
			FStoryletTraceCard& Out = E.Cards.AddDefaulted_GetRef();
			Out.GameId = Ue(C.id);
			Out.Verdict = Ue(storylets::VerdictWire(C.verdict));
			Out.bHasPriority = C.priority.has_value();
			Out.Priority = C.priority.value_or(0);
			Out.bHasSpecificity = C.specificity.has_value();
			Out.Specificity = C.specificity.value_or(0);
		}
		return E;
	}
}

// --- UStoryletFlow: the host surface --------------------------------------------

TArray<FStoryletDealtCard> UStoryletFlow::Deal(const FString& HandRef)
{
	if (RefuseClosedCall(TEXT("Deal"))) return {};
	return Refusing(LastError, TEXT("Deal"), TArray<FStoryletDealtCard>(), [&]
	{
		return ConvertCards(GetCoreFlow()->deal(Std(HandRef)));
	});
}

TArray<FStoryletHandContents> UStoryletFlow::DealMany(const TArray<FString>& HandRefs)
{
	if (RefuseClosedCall(TEXT("DealMany"))) return {};
	return Refusing(LastError, TEXT("DealMany"), TArray<FStoryletHandContents>(), [&]
	{
		std::vector<std::string> Refs;
		Refs.reserve(static_cast<size_t>(HandRefs.Num()));
		for (const FString& R : HandRefs) Refs.push_back(Std(R));
		return ConvertHands(GetCoreFlow()->dealMany(Refs));
	});
}

TArray<FStoryletHandContents> UStoryletFlow::DealAllHands()
{
	if (RefuseClosedCall(TEXT("DealAllHands"))) return {};
	return Refusing(LastError, TEXT("DealAllHands"), TArray<FStoryletHandContents>(), [&]
	{
		return ConvertHands(GetCoreFlow()->dealMany());
	});
}

namespace
{
	/** Peek and PeekAll: the core's peek, where an absent count is every card
	 *  and any count below one is none. */
	TArray<FStoryletDealtCard> PeekOn(storylets::Flow& Flow, const FString& BoxRef,
		const TMap<FString, FString>& Criteria, std::optional<int> N)
	{
		storylets::OrderedMap<std::string, std::string> Crit;
		for (const auto& KV : Criteria) Crit.set(Std(KV.Key), Std(KV.Value));
		return ConvertCards(Flow.peek(Std(BoxRef), Crit, N).cards);
	}
}

TArray<FStoryletDealtCard> UStoryletFlow::Peek(
	const FString& BoxRef, const TMap<FString, FString>& Criteria, int32 MaxCards)
{
	if (RefuseClosedCall(TEXT("Peek"))) return {};
	return Refusing(LastError, TEXT("Peek"), TArray<FStoryletDealtCard>(), [&]
	{
		return PeekOn(*GetCoreFlow(), BoxRef, Criteria, std::optional<int>(MaxCards));
	});
}

TArray<FStoryletDealtCard> UStoryletFlow::PeekAll(const FString& BoxRef, const TMap<FString, FString>& Criteria)
{
	if (RefuseClosedCall(TEXT("PeekAll"))) return {};
	return Refusing(LastError, TEXT("PeekAll"), TArray<FStoryletDealtCard>(), [&]
	{
		return PeekOn(*GetCoreFlow(), BoxRef, Criteria, std::nullopt);
	});
}

TArray<FStoryletHandContents> UStoryletFlow::Board() const
{
	if (RefuseClosed(TEXT("Board"))) return {};
	return Guard(TEXT("Board"), false, TArray<FStoryletHandContents>(), [&]
	{
		return ConvertHands(GetCoreFlow()->board());
	});
}

TArray<FStoryletHandContents> UStoryletFlow::BoardForBox(const FString& BoxRef) const
{
	if (RefuseClosed(TEXT("BoardForBox"))) return {};
	return Guard(TEXT("BoardForBox"), false, TArray<FStoryletHandContents>(), [&]
	{
		return ConvertHands(GetCoreFlow()->board(Std(BoxRef)));
	});
}

TArray<FStoryletOutcomeView> UStoryletFlow::Outcomes(const FString& CardRef, const FString& FromHand)
{
	if (RefuseClosedCall(TEXT("Outcomes"))) return {};
	return Refusing(LastError, TEXT("Outcomes"), TArray<FStoryletOutcomeView>(), [&]
	{
		TArray<FStoryletOutcomeView> Out;
		for (const storylets::OutcomeView& O : GetCoreFlow()->outcomes(Std(CardRef), Std(FromHand)))
		{
			FStoryletOutcomeView V;
			V.Id = Ue(O.id);
			V.GameId = Ue(O.gameId);
			V.Title = Ue(O.title);
			V.Purpose = Ue(O.purpose);
			V.bAvailable = O.available;
			V.Fields = ConvertFields(O.fields);
			V.Extensions = StoryletExtensionsToUe(O.extensions);
			Out.Add(MoveTemp(V));
		}
		return Out;
	});
}

namespace
{
	/** Play and PlayAdvancing: the refusal in OutError, as it always was, and
	 *  in LastError and the log, as every refusal is. */
	bool PlayOn(storylets::Flow& Flow, FString& LastError, const TCHAR* Verb, const FString& CardRef,
		const FString& OutcomeGameId, const FString& FromHand, const storylets::PlayOptions& Options, FString& OutError)
	{
		const bool bPlayed = Refusing(LastError, Verb, false, [&]
		{
			Flow.play(Std(CardRef), Std(OutcomeGameId), Std(FromHand), Options);
			return true;
		});
		OutError = LastError;
		return bPlayed;
	}
}

bool UStoryletFlow::Play(
	const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand, FString& OutError)
{
	if (RefuseClosedCall(TEXT("Play")))
	{
		OutError = LastError;
		return false;
	}
	return PlayOn(*GetCoreFlow(), LastError, TEXT("Play"), CardRef, OutcomeGameId, FromHand, storylets::PlayOptions(), OutError);
}

bool UStoryletFlow::PlayAdvancing(
	const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand,
	double AdvanceTurns, FString& OutError)
{
	if (RefuseClosedCall(TEXT("PlayAdvancing")))
	{
		OutError = LastError;
		return false;
	}
	storylets::PlayOptions Options;
	Options.advanceTurns = AdvanceTurns;
	return PlayOn(*GetCoreFlow(), LastError, TEXT("PlayAdvancing"), CardRef, OutcomeGameId, FromHand, Options, OutError);
}

bool UStoryletFlow::Discard(const FString& CardRef, const FString& FromHand, FString& OutError)
{
	if (RefuseClosedCall(TEXT("Discard")))
	{
		OutError = LastError;
		return false;
	}
	const bool bDiscarded = Refusing(LastError, TEXT("Discard"), false, [&]
	{
		GetCoreFlow()->discard(Std(CardRef), Std(FromHand));
		return true;
	});
	OutError = LastError;
	return bDiscarded;
}

FString UStoryletFlow::AdvanceTurns(const FString& BoxRef, double Turns)
{
	if (RefuseClosedCall(TEXT("AdvanceTurns"))) return LastError;
	return Refusal(LastError, TEXT("AdvanceTurns"), [&] { GetCoreFlow()->advanceTurns(Std(BoxRef), Turns); });
}

double UStoryletFlow::GetTurn(const FString& BoxRef) const
{
	if (RefuseClosed(TEXT("GetTurn"), /*bRead=*/true)) return 0;
	return Guard(TEXT("GetTurn"), true, 0.0, [&] { return GetCoreFlow()->turn(Std(BoxRef)); });
}

TArray<FStoryletBoxView> UStoryletFlow::ListBoxes() const
{
	if (RefuseClosed(TEXT("ListBoxes"))) return {};
	return Guard(TEXT("ListBoxes"), false, TArray<FStoryletBoxView>(), [&]
	{
		TArray<FStoryletBoxView> Out;
		for (const storylets::BoxView& B : GetCoreFlow()->listBoxes())
		{
			FStoryletBoxView V;
			V.Id = Ue(B.id);
			V.GameId = Ue(B.gameId);
			V.Title = Ue(B.title);
			V.Turn = B.turn;
			V.Extensions = StoryletExtensionsToUe(B.extensions);
			Out.Add(MoveTemp(V));
		}
		return Out;
	});
}

// --- UStoryletFlow: durable state (ruling H) --------------------------------------

FString UStoryletFlow::SaveDurableToJson() const
{
	if (RefuseClosedCall(TEXT("SaveDurableToJson"))) return FString();
	return Refusing(LastError, TEXT("SaveDurableToJson"), FString(), [&]
	{
		return Ue(storylets::serializeDurable(GetCoreFlow()->saveDurable()));
	});
}

// --- UStoryletFlow: state, as this flow sees it ---------------------------------

TArray<FStoryletPropertyView> UStoryletFlow::ListProperties() const
{
	if (RefuseClosed(TEXT("ListProperties"))) return {};
	return Guard(TEXT("ListProperties"), false, TArray<FStoryletPropertyView>(), [&]
	{
		return ConvertRows(GetCoreFlow()->listProperties());
	});
}

double UStoryletFlow::GetPropertyNumber(const FString& Path) const
{
	if (RefuseClosed(TEXT("GetPropertyNumber"), true)) return 0;
	return AsNumber(ReadProperty(*GetCoreFlow(), Path, TEXT("GetPropertyNumber")));
}

FString UStoryletFlow::GetPropertyString(const FString& Path) const
{
	if (RefuseClosed(TEXT("GetPropertyString"), true)) return FString();
	return AsDisplay(ReadProperty(*GetCoreFlow(), Path, TEXT("GetPropertyString")));
}

bool UStoryletFlow::GetPropertyBool(const FString& Path) const
{
	if (RefuseClosed(TEXT("GetPropertyBool"), true)) return false;
	return AsBool(ReadProperty(*GetCoreFlow(), Path, TEXT("GetPropertyBool")));
}

TArray<FString> UStoryletFlow::GetPropertyFlags(const FString& Path) const
{
	if (RefuseClosed(TEXT("GetPropertyFlags"), true)) return {};
	return AsFlags(ReadProperty(*GetCoreFlow(), Path, TEXT("GetPropertyFlags")));
}

FString UStoryletFlow::SetPropertyNumber(const FString& Path, double Value)
{
	if (RefuseClosedCall(TEXT("SetPropertyNumber"))) return LastError;
	return SetPropertyRefusing(*GetCoreFlow(), LastError, Path, storylets::StoryletValue::Num(Value), TEXT("SetPropertyNumber"));
}

FString UStoryletFlow::SetPropertyBool(const FString& Path, bool bValue)
{
	if (RefuseClosedCall(TEXT("SetPropertyBool"))) return LastError;
	return SetPropertyRefusing(*GetCoreFlow(), LastError, Path, storylets::StoryletValue::Bool(bValue), TEXT("SetPropertyBool"));
}

FString UStoryletFlow::SetPropertyString(const FString& Path, const FString& Value)
{
	if (RefuseClosedCall(TEXT("SetPropertyString"))) return LastError;
	return SetPropertyRefusing(*GetCoreFlow(), LastError, Path, storylets::StoryletValue::Str(Std(Value)), TEXT("SetPropertyString"));
}

FString UStoryletFlow::SetPropertyFlags(const FString& Path, const TArray<FString>& Values)
{
	if (RefuseClosedCall(TEXT("SetPropertyFlags"))) return LastError;
	return SetPropertyRefusing(*GetCoreFlow(), LastError, Path, FlagsValue(Values), TEXT("SetPropertyFlags"));
}

// --- UStoryletFlow: the log and the trace ------------------------------------------

TArray<FStoryletLogEntry> UStoryletFlow::Log() const
{
	if (RefuseClosed(TEXT("Log"))) return {};
	return Guard(TEXT("Log"), false, TArray<FStoryletLogEntry>(), [&]
	{
		TArray<FStoryletLogEntry> Out;
		for (const storylets::LogEntry& Entry : GetCoreFlow()->log())
		{
			Out.Add(ConvertLogEntry(Entry.event, Entry.seq, Entry.turn, FString()));
		}
		return Out;
	});
}

void UStoryletFlow::ClearLog()
{
	if (RefuseClosedCall(TEXT("ClearLog"))) return;
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
	if (!Handler || RefuseClosed(TEXT("SubscribeTrace"))) return 0;
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

// --- UStoryletEngine: the run's trace and log ---------------------------------------

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
	if (!IsValidEngine()) return {};
	return Guard(TEXT("GetRunLog"), false, TArray<FStoryletLogEntry>(), [&]
	{
		TArray<FStoryletLogEntry> Out;
		for (const storylets::EngineLogEntry& Entry : Impl->Engine->log())
		{
			Out.Add(ConvertLogEntry(Entry.event, Entry.seq, Entry.turn, Ue(Entry.flow)));
		}
		return Out;
	});
}

void UStoryletEngine::ClearRunLog()
{
	if (IsValidEngine()) Impl->Engine->clearLog();
}

// --- UStoryletEngine: shared + @world state -------------------------------------

TArray<FStoryletPropertyView> UStoryletEngine::ListProperties() const
{
	if (!IsValidEngine()) return {};
	return Guard(TEXT("ListProperties"), false, TArray<FStoryletPropertyView>(), [&]
	{
		return ConvertRows(Impl->Engine->listProperties());
	});
}

double UStoryletEngine::GetPropertyNumber(const FString& Path) const
{
	if (!IsValidEngine()) return 0;
	return AsNumber(ReadProperty(*Impl->Engine, Path, TEXT("GetPropertyNumber")));
}

FString UStoryletEngine::GetPropertyString(const FString& Path) const
{
	if (!IsValidEngine()) return FString();
	return AsDisplay(ReadProperty(*Impl->Engine, Path, TEXT("GetPropertyString")));
}

bool UStoryletEngine::GetPropertyBool(const FString& Path) const
{
	if (!IsValidEngine()) return false;
	return AsBool(ReadProperty(*Impl->Engine, Path, TEXT("GetPropertyBool")));
}

TArray<FString> UStoryletEngine::GetPropertyFlags(const FString& Path) const
{
	if (!IsValidEngine()) return {};
	return AsFlags(ReadProperty(*Impl->Engine, Path, TEXT("GetPropertyFlags")));
}

FString UStoryletEngine::SetPropertyNumber(const FString& Path, double Value)
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SetPropertyNumber"), InvalidEngine);
		return LastError;
	}
	return SetPropertyRefusing(*Impl->Engine, LastError, Path, storylets::StoryletValue::Num(Value), TEXT("SetPropertyNumber"));
}

FString UStoryletEngine::SetPropertyBool(const FString& Path, bool bValue)
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SetPropertyBool"), InvalidEngine);
		return LastError;
	}
	return SetPropertyRefusing(*Impl->Engine, LastError, Path, storylets::StoryletValue::Bool(bValue), TEXT("SetPropertyBool"));
}

FString UStoryletEngine::SetPropertyString(const FString& Path, const FString& Value)
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SetPropertyString"), InvalidEngine);
		return LastError;
	}
	return SetPropertyRefusing(*Impl->Engine, LastError, Path, storylets::StoryletValue::Str(Std(Value)), TEXT("SetPropertyString"));
}

FString UStoryletEngine::SetPropertyFlags(const FString& Path, const TArray<FString>& Values)
{
	if (!IsValidEngine())
	{
		NoteRefusal(TEXT("SetPropertyFlags"), InvalidEngine);
		return LastError;
	}
	return SetPropertyRefusing(*Impl->Engine, LastError, Path, FlagsValue(Values), TEXT("SetPropertyFlags"));
}

bool UStoryletEngine::ApplyLiveBundle(UStoryletBundle* NewBundle, FString& OutError)
{
	FString Report;
	return ApplyLiveBundleWithReport(NewBundle, OutError, Report);
}

bool UStoryletEngine::ApplyLiveBundleWithReport(UStoryletBundle* NewBundle, FString& OutError, FString& OutReportJson)
{
	OutReportJson.Reset();
	LastError.Reset();
	if (!IsValidEngine())
	{
		OutError = TEXT("invalid engine");
		NoteRefusal(TEXT("ApplyLiveBundle"), OutError);
		return false;
	}
	if (!NewBundle || !NewBundle->GetCompiled() || !NewBundle->GetCompiled()->Bundle)
	{
		OutError = TEXT("null or uncompiled bundle");
		NoteRefusal(TEXT("ApplyLiveBundle"), OutError);
		return false;
	}
	try
	{
		// The core's own hotSwap, with the options this core was built with (the
		// same registry, @world binding, seed and log). Standalone it is a save
		// and a load into a new core, the old one untouched. On the game's
		// registry the old core carries its own values into the snapshot and
		// steps out, and the new one loads them as a standalone save loads, so
		// the load's report covers the properties the edit dropped, defaulted or
		// retyped, and a dropped one is really dropped. A save for another
		// project is refused before anything moves, and a rebuild that fails
		// puts the old core back exactly as it was: either way this engine is
		// untouched when this returns false.
		storylets::BundlePtr NextBundle = NewBundle->GetCompiled()->Bundle;
		storylets::Engine::HotSwapResult Swap = Impl->Engine->hotSwap(NextBundle);
		std::unique_ptr<storylets::Engine> Next = std::move(Swap.engine);
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
		OutReportJson = Ue(storylets::reportToJson(Swap.report));
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = Ue(Ex.what());
	}
	catch (...)
	{
		OutError = TEXT("an unknown exception");
	}
	NoteRefusal(TEXT("ApplyLiveBundle"), OutError);
	return false;
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
	// A wrapper whose flow did not survive is closed for good: it leaves the
	// list, so a later re-bind cannot revive it.
	WrappedFlows.RemoveAll([](const TWeakObjectPtr<UStoryletFlow>& W) { return !W.IsValid() || W->IsClosed(); });
}

UStoryletWorld* UStoryletEngine::GetHostScope(const FString& Token) const
{
	// Matched case-sensitively, as the engine matches a token: an FString map's
	// own Find ignores case.
	for (const TPair<FString, TObjectPtr<UStoryletWorld>>& Scope : HostScopeRefs)
	{
		if (Scope.Key.Equals(Token, ESearchCase::CaseSensitive)) return Scope.Value.Get();
	}
	return nullptr;
}

void UStoryletEngine::BeginDestroy()
{
	FStoryletDebug::Unregister(this);
	Super::BeginDestroy();
}
