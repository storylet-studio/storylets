// The Live Link reconnects, at the UE boundary. Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.LiveLink"
//
// The rule itself (the waits, the queue, the hello and boards again, 4000) is
// held in the std-only client by the clang TestHost (TestHost/LiveLinkReconnect.h).
// This holds what only the wrapper does: the retry clock and its ticker, the
// close code reaching the client from the socket's OnClosed, the state it
// reports, the log lines, and Close() stopping it all. Unreal has no WebSocket
// server to test against, so the test plays the socket's part, as Patterplay's
// debug-link test does: it raises the events the socket's handlers would
// (connected, closed with a code, failed to connect), reads the waits rather
// than sleeping through them, and catches what the link sends.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS && !UE_BUILD_SHIPPING

#include "StoryletLiveLink.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// The link's friend: the socket's events, the retry clock, and a sink for what it sends.
struct FStoryletLiveLinkTestAccess
{
	static void CatchSends(FStoryletLiveLink& Link, TArray<FString>* Sent) { Link.SentForTest = Sent; }
	static void Connected(FStoryletLiveLink& Link) { Link.HandleConnected(); }
	static void Gone(FStoryletLiveLink& Link, int32 StatusCode) { Link.HandleGone(StatusCode); }
	/** Seconds until the next attempt is due, measured as the ticker would. */
	static double SecondsToRetry(const FStoryletLiveLink& Link) { return Link.RetryAt > 0.0 ? Link.RetryAt - FPlatformTime::Seconds() : 0.0; }
	static bool Pending(const FStoryletLiveLink& Link) { return Link.RetryAt > 0.0; }
	static bool Ticking(const FStoryletLiveLink& Link) { return Link.RetryTicker.IsValid(); }
	/** Make the next attempt due now and let the ticker's check run, as it would on its next tick. */
	static void RetryNow(FStoryletLiveLink& Link)
	{
		if (Link.RetryAt > 0.0) Link.RetryAt = 1.0;
		Link.RetryTick();
	}
};

namespace
{
	TSharedPtr<FJsonObject> ParseJson(const FString& Text)
	{
		TSharedPtr<FJsonObject> Obj;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Text);
		FJsonSerializer::Deserialize(Reader, Obj);
		return Obj;
	}

	FString Field(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Name)
	{
		FString Out;
		if (Obj.IsValid()) Obj->TryGetStringField(Name, Out);
		return Out;
	}

	/** The wait to the nearest whole second (the clock moves while the test runs). */
	int32 Whole(double Seconds) { return FMath::RoundToInt(Seconds); }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletLiveLinkTest,
	"StoryletEngine.LiveLink",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletLiveLinkTest::RunTest(const FString& Parameters)
{
	using A = FStoryletLiveLinkTestAccess;
	// One line when the open link is lost and one when it is back (twice each in
	// this test), one when it is replaced; none per attempt.
	AddExpectedMessage(TEXT("Storylet Engine: Live Link lost"), ELogVerbosity::Display, EAutomationExpectedMessageFlags::Contains, 2);
	AddExpectedMessage(TEXT("Storylet Engine: Live Link is back"), ELogVerbosity::Display, EAutomationExpectedMessageFlags::Contains, 2);
	AddExpectedMessage(TEXT("another game took the editor's link"), ELogVerbosity::Display, EAutomationExpectedMessageFlags::Contains, 1);

	// Nothing listens on port 1, so the real socket never gets anywhere; the test raises its events.
	TSharedRef<FStoryletLiveLink> Link = FStoryletLiveLink::Create(TEXT("h1"), TEXT("Smoke"), TEXT("ws://127.0.0.1:1"));
	TArray<FString> Sent;
	A::CatchSends(*Link, &Sent);
	TestEqual(TEXT("a new link is connecting"), Link->LinkState(), FString(TEXT("connecting")));

	// A refused first connect is "connecting", not "closed", and is retried: 1, 2, 4, 8, 10, 10.
	TArray<int32> Waits;
	for (int32 i = 0; i < 6; ++i)
	{
		A::Gone(*Link, -1);   // OnConnectionError
		TestTrue(TEXT("a refused attempt schedules a retry"), A::Pending(*Link));
		TestEqual(TEXT("and reads as connecting"), Link->LinkState(), FString(TEXT("connecting")));
		Waits.Add(Whole(A::SecondsToRetry(*Link)));
		A::Gone(*Link, 1006);   // the same socket's close after its error: counted once
		A::RetryNow(*Link);
		TestFalse(TEXT("an attempt is under way"), A::Pending(*Link));
	}
	TestTrue(FString::Printf(TEXT("the waits double to 10 s (got %s)"),
		*FString::JoinBy(Waits, TEXT(","), [](int32 W) { return FString::FromInt(W); })),
		Waits == TArray<int32>({ 1, 2, 4, 8, 10, 10 }));
	TestTrue(TEXT("the retry ticker is running"), A::Ticking(*Link));
	TestEqual(TEXT("nothing was sent while the editor was away"), Sent.Num(), 0);

	// The editor is there: the hello carries the build as SetBuild last left it, and the wait goes back to 1 s.
	Link->SetBuild(TEXT("h2"));
	A::Connected(*Link);
	TestEqual(TEXT("it reads as connected"), Link->LinkState(), FString(TEXT("connected")));
	if (TestEqual(TEXT("on open: one hello"), Sent.Num(), 1))
	{
		const TSharedPtr<FJsonObject> Hello = ParseJson(Sent[0]);
		TestEqual(TEXT("the hello"), Field(Hello, TEXT("t")), FString(TEXT("hello")));
		TestEqual(TEXT("with the current build"), Field(Hello, TEXT("build")), FString(TEXT("h2")));
		TestEqual(TEXT("and the project"), Field(Hello, TEXT("project")), FString(TEXT("Smoke")));
	}

	// The editor quit (any close but 4000): retried after 1 s, since the hello reset the wait.
	A::Gone(*Link, 1000);
	TestEqual(TEXT("a lost link reads as connecting"), Link->LinkState(), FString(TEXT("connecting")));
	TestEqual(TEXT("and retries 1 s away"), Whole(A::SecondsToRetry(*Link)), 1);
	A::RetryNow(*Link);
	A::Connected(*Link);
	TestEqual(TEXT("back: the hello again"), Field(ParseJson(Sent.Last()), TEXT("t")), FString(TEXT("hello")));
	TestEqual(TEXT("with the build"), Field(ParseJson(Sent.Last()), TEXT("build")), FString(TEXT("h2")));

	// Lost again, then replaced by another game while retrying: the close code from OnClosed stops it.
	A::Gone(*Link, 1001);
	A::RetryNow(*Link);
	A::Connected(*Link);
	const int32 BeforeReplace = Sent.Num();
	A::Gone(*Link, 4000);
	TestEqual(TEXT("a replaced link reads as closed"), Link->LinkState(), FString(TEXT("closed")));
	TestFalse(TEXT("and schedules no retry"), A::Pending(*Link));
	A::Gone(*Link, 1000);
	A::RetryNow(*Link);
	TestFalse(TEXT("a later close does not revive it"), A::Pending(*Link));
	Link->SetBuild(TEXT("h3"));
	A::Connected(*Link);
	TestEqual(TEXT("and it sends nothing"), Sent.Num(), BeforeReplace);
	Link->Close();
	TestFalse(TEXT("Close() takes the ticker away"), A::Ticking(*Link));

	// Switched off by the game while retrying: Close() stops it.
	TSharedRef<FStoryletLiveLink> Off = FStoryletLiveLink::Create(TEXT("h1"), TEXT("Smoke"), TEXT("ws://127.0.0.1:1"));
	TArray<FString> OffSent;
	A::CatchSends(*Off, &OffSent);
	A::Gone(*Off, -1);
	TestTrue(TEXT("a link that never opened retries"), A::Pending(*Off));
	Off->Close();
	TestEqual(TEXT("Close() closes it"), Off->LinkState(), FString(TEXT("closed")));
	TestFalse(TEXT("with no retry pending"), A::Pending(*Off));
	TestFalse(TEXT("and no ticker left"), A::Ticking(*Off));
	A::Gone(*Off, 1000);
	TestFalse(TEXT("and a late close does not start one"), A::Pending(*Off));
	TestEqual(TEXT("it sent nothing"), OffSent.Num(), 0);

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS && !UE_BUILD_SHIPPING
