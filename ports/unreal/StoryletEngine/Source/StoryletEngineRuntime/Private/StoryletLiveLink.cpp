#include "StoryletLiveLink.h"

#include "StoryletBundle.h"
#include "StoryletEngine.h"

#include "Storylets/LiveLink.h"   // std-only: included in every configuration so the Pimpl type is complete

#include <optional>
#include <string>

bool FStoryletLiveLink::ApplyLiveBundle(UStoryletEngine* Engine, const FString& Data, FString& OutError)
{
	if (!Engine)
	{
		OutError = TEXT("no session");
		return false;
	}
	UStoryletBundle* NewBundle = UStoryletBundle::LoadFromJsonString(Data, OutError);
	if (!NewBundle) return false;
	return Engine->ApplyLiveBundle(NewBundle, OutError);
}

#if !UE_BUILD_SHIPPING

#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Modules/ModuleManager.h"

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
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
		if (Self.IsValid() && Self->Socket.IsValid() && Self->Socket->IsConnected())
		{
			Self->Socket->Send(FString(UTF8_TO_TCHAR(Frame.c_str())));
		}
	});

	if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
	{
		FModuleManager::Get().LoadModule("WebSockets");
	}
	Socket = FWebSocketsModule::Get().CreateWebSocket(Url, TEXT(""));
	if (!Socket.IsValid())
	{
		return;
	}

	Socket->OnConnected().AddLambda([Weak]()
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (!Self.IsValid() || !Self->Client.IsValid()) return;
		// Handshake first, then the queue: the editor honours nothing before hello.
		Self->Client->onOpen();
	});
	// Live refresh: the editor pushes {t:"bundle", build, data}. The shape is
	// checked here so the host's OnBundle never sees a malformed payload;
	// anything else the editor might send is ignored.
	Socket->OnMessage().AddLambda([Weak](const FString& Message)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (!Self.IsValid() || !Self->OnBundle) return;
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
	Socket->OnConnectionError().AddLambda([](const FString&) { /* editor not listening: stay a no-op */ });
	Socket->OnClosed().AddLambda([Weak](int32, const FString&, bool)
	{
		TSharedPtr<FStoryletLiveLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Client.IsValid()) Self->Client->onClose();
	});
	Socket->Connect();
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
	if (Socket.IsValid())
	{
		Socket->Close();
		Socket.Reset();
	}
}

FString FStoryletLiveLink::LinkState() const
{
	if (!Socket.IsValid()) return TEXT("closed");
	return Socket->IsConnected() ? TEXT("connected") : TEXT("connecting");
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
