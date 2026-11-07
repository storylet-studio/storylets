#include "StoryletLiveLink.h"

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"

#include "Storylets/LiveLink.h"   // std-only: included in every configuration so the Pimpl type is complete

#include <optional>
#include <string>

namespace
{
	/** The pushed JSON compiled, or null with OutError. */
	UStoryletBundle* CompilePushed(UStoryletEngine* Engine, const FString& Data, FString& OutError)
	{
		if (!Engine)
		{
			OutError = TEXT("no engine");
			return nullptr;
		}
		return UStoryletBundle::LoadFromJsonString(Data, OutError);
	}
}

bool FStoryletLiveLink::ApplyLiveBundle(UStoryletEngine* Engine, const FString& Data, FString& OutError)
{
	UStoryletBundle* NewBundle = CompilePushed(Engine, Data, OutError);
	return NewBundle && Engine->ApplyLiveBundle(NewBundle, OutError);
}

bool FStoryletLiveLink::ApplyLiveBundle(UStoryletEngine* Engine, const FString& Data, FString& OutError, FStoryletLoadReport& OutReport)
{
	OutReport = FStoryletLoadReport();
	UStoryletBundle* NewBundle = CompilePushed(Engine, Data, OutError);
	return NewBundle && Engine->ApplyLiveBundleWithLoadReport(NewBundle, OutError, OutReport);
}

#if !UE_BUILD_SHIPPING

#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "StoryletLog.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Modules/ModuleManager.h"

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }

	// How often the retry ticker looks at the clock. Coarse is fine: the waits are whole seconds.
	constexpr float RetryTickInterval = 0.1f;
}

TSharedRef<FStoryletLiveLink> FStoryletLiveLink::Create(const FString& Build, const FString& Project, const FString& Url)
{
	TSharedRef<FStoryletLiveLink> Link = MakeShareable(new FStoryletLiveLink(Build, Project, Url));
	Link->Connect();
	return Link;
}

FStoryletLiveLink::FStoryletLiveLink(const FString& InBuild, const FString& InProject, const FString& InUrl)
	: BuildId(InBuild), Project(InProject), Url(InUrl)
{
}

FStoryletLiveLink::~FStoryletLiveLink()
{
	Close();
}

void FStoryletLiveLink::Connect()
{
	// The sink is the socket, guarded: the editor may have gone between the
	// frame being built and sent, and that must never reach the game.
	TWeakPtr<FStoryletLiveLink> Weak = AsShared();
	std::optional<std::string> ProjectName;
	if (!Project.IsEmpty()) ProjectName = Std(Project);
	Client = MakePimpl<storylets::LiveLinkClient>(Std(BuildId), ProjectName, [Weak](const std::string& Frame)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (!Self.IsValid()) return;
		const FString Text(UTF8_TO_TCHAR(Frame.c_str()));
		if (Self->SentForTest)
		{
			Self->SentForTest->Add(Text);
		}
		else if (Self->Socket.IsValid() && Self->Socket->IsConnected())
		{
			Self->Socket->Send(Text);
		}
	});
	// The client says when the link is lost, back or replaced; nothing per
	// attempt. Display, so a developer sees it in the Output Log and the console
	// as the JS client's console.info is seen.
	Client->setLog(Std(Url), [](const std::string& Line)
	{
		UE_LOG(LogStoryletEngine, Display, TEXT("Storylet Engine: %s"), UTF8_TO_TCHAR(Line.c_str()));
	});
	Dial();
}

// Dial the editor on a fresh socket (the last one is dropped first, outside its
// own callbacks). Each callback checks it is still this link's socket, so a
// late event from one already dropped changes nothing.
void FStoryletLiveLink::Dial()
{
	if (!Client.IsValid() || Client->isClosed()) return;
	if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
	{
		FModuleManager::Get().LoadModule("WebSockets");
	}
	DropSocket();
	Socket = FWebSocketsModule::Get().CreateWebSocket(Url, TEXT(""));
	if (!Socket.IsValid())
	{
		Client->close();   // no WebSockets here at all: nothing to retry
		return;
	}
	Client->beginAttempt();

	TWeakPtr<FStoryletLiveLink> Weak = AsShared();
	const IWebSocket* Mine = Socket.Get();
	Socket->OnConnected().AddLambda([Weak, Mine]()
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleConnected();
	});
	// Live refresh: the editor pushes {t:"bundle", build, data}. The shape is
	// checked here so the host's OnBundle never sees a malformed payload;
	// anything else the editor might send is ignored.
	Socket->OnMessage().AddLambda([Weak, Mine](const FString& Message)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Socket.Get() != Mine || !Self->OnBundle) return;
		TSharedPtr<FJsonObject> Msg;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Message);
		if (!FJsonSerializer::Deserialize(Reader, Msg) || !Msg.IsValid()) return;
		FString Type, Build, Data;
		if (Msg->TryGetStringField(TEXT("t"), Type) && Type == TEXT("bundle")
			&& Msg->TryGetStringField(TEXT("build"), Build)
			&& Msg->TryGetStringField(TEXT("data"), Data))
		{
			Self->OnBundle(Build, Data);
		}
	});
	// The editor is not listening: try again later (HandleGone).
	Socket->OnConnectionError().AddLambda([Weak, Mine](const FString&)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleGone(-1);
	});
	Socket->OnClosed().AddLambda([Weak, Mine](int32 StatusCode, const FString&, bool)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleGone(StatusCode);
	});
	Socket->Connect();
}

void FStoryletLiveLink::HandleConnected()
{
	// Handshake first, then the queue: the editor honours nothing before hello.
	// On a reconnect the same hello, with the build and the flows open now, then
	// every flow's board.
	if (Client.IsValid()) Client->onOpen();
}

// The socket closed, or never opened. The client decides (retry or not, and the
// wait); this keeps the clock.
void FStoryletLiveLink::HandleGone(int32 StatusCode)
{
	if (!Client.IsValid()) return;
	const std::optional<double> Wait = Client->onClose(StatusCode);
	if (!Wait.has_value()) return;
	RetryAt = FPlatformTime::Seconds() + *Wait;
	if (!RetryTicker.IsValid())
	{
		// One ticker for the link's life, made the first time it is needed: it
		// looks at the clock and dials when an attempt is due, so a retry
		// allocates nothing but its socket.
		TWeakPtr<FStoryletLiveLink> Weak = AsShared();
		RetryTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Weak](float)
		{
			TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
			if (!Self.IsValid()) return false;
			Self->RetryTick();
			return true;
		}), RetryTickInterval);
	}
}

void FStoryletLiveLink::RetryTick()
{
	if (RetryAt <= 0.0 || FPlatformTime::Seconds() < RetryAt) return;
	RetryAt = 0.0;
	Dial();
}

// Let go of the socket, unbinding it first so nothing it reports later reaches this link.
void FStoryletLiveLink::DropSocket()
{
	if (!Socket.IsValid()) return;
	Socket->OnConnected().Clear();
	Socket->OnMessage().Clear();
	Socket->OnConnectionError().Clear();
	Socket->OnClosed().Clear();
	Socket.Reset();
}

void FStoryletLiveLink::Attach(UStoryletEngine* InEngine)
{
	Detach();
	if (!Client.IsValid() || !InEngine || !InEngine->IsValidEngine()) return;
	Engine = InEngine;
	TWeakPtr<FStoryletLiveLink> Weak = AsShared();
	// The subscription lives on the wrapper, which survives a live-bundle
	// swap; the provider reads the core fresh each time for the same reason.
	TraceHandle = InEngine->SubscribeTrace(
		[Weak](const FString& FlowId, const storylets::TraceEvent& Event)
		{
			TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
			if (Self.IsValid() && Self->Client.IsValid()) Self->Client->onTrace(Std(FlowId), Event);
		});
	Client->attach([Weak]() -> storylets::Engine*
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (!Self.IsValid()) return nullptr;
		UStoryletEngine* Current = Self->Engine.Get();
		return Current ? Current->GetCoreEngine() : nullptr;
	});
}

void FStoryletLiveLink::Detach()
{
	if (UStoryletEngine* Current = Engine.Get())
	{
		Current->UnsubscribeTrace(TraceHandle);
	}
	TraceHandle = 0;
	Engine.Reset();
	if (Client.IsValid()) Client->detach();
}

void FStoryletLiveLink::SetBuild(const FString& Build)
{
	BuildId = Build;
	if (Client.IsValid()) Client->setBuild(Std(Build));
}

void FStoryletLiveLink::Close()
{
	Detach();
	if (Client.IsValid()) Client->close();
	RetryAt = 0.0;
	if (RetryTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(RetryTicker);
		RetryTicker.Reset();
	}
	if (Socket.IsValid())
	{
		Socket->Close();
	}
	DropSocket();
}

FString FStoryletLiveLink::LinkState() const
{
	// While it waits to try again the link is still "connecting": "closed" is
	// only Close(), replaced (4000), or no WebSocket at all.
	if (!Client.IsValid()) return TEXT("closed");
	return UTF8_TO_TCHAR(Client->state());
}

#else // UE_BUILD_SHIPPING - the link compiles to nothing.

TSharedRef<FStoryletLiveLink> FStoryletLiveLink::Create(const FString& Build, const FString& Project, const FString& Url)
{
	return MakeShareable(new FStoryletLiveLink(Build, Project, Url));
}

FStoryletLiveLink::FStoryletLiveLink(const FString& InBuild, const FString& InProject, const FString& InUrl)
	: BuildId(InBuild), Project(InProject), Url(InUrl)
{
}

FStoryletLiveLink::~FStoryletLiveLink() {}
void FStoryletLiveLink::Connect() {}
void FStoryletLiveLink::Attach(UStoryletEngine*) {}
void FStoryletLiveLink::Detach() {}
void FStoryletLiveLink::SetBuild(const FString&) {}
void FStoryletLiveLink::Close() {}
// Shipping has no socket, so the link is closed by construction.
FString FStoryletLiveLink::LinkState() const { return TEXT("closed"); }

#endif
