// The Live Link reconnect rule (shared with Patter's debug link), held in the
// std-only client (Storylets/LiveLink.h) with no socket: each check plays the
// socket's part through onOpen / onClose / beginAttempt and reads the wait
// onClose hands back, so no check sleeps. The UE wrapper keeps only the clock
// and the 4000 close code from its socket's OnClosed, and its automation test
// (StoryletLiveLinkTest.cpp) holds those.
#pragma once

#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "Storylets/Bundle.h"
#include "Storylets/Engine.h"
#include "Storylets/JsonParse.h"
#include "Storylets/LiveLink.h"

#include "LiveLinkFixture.h"

namespace livelinkreconnect
{
    using namespace storylets;
    using Checks = std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>>;

    constexpr const char* kUrl = "ws://127.0.0.1:4472";

    /** A client over a recording sink and a recording log. */
    struct Rig
    {
        std::vector<std::string> sent;
        std::vector<std::string> logged;
        LiveLinkClient client;

        Rig()
            : client("B1", std::string("Test"), [this](const std::string& f) { sent.push_back(f); })
        {
            client.setLog(kUrl, [this](const std::string& line) { logged.push_back(line); });
        }

        /** The kinds ("hello", "board", "trace", ...) sent from `from` on. */
        std::vector<std::string> kinds(size_t from = 0) const
        {
            std::vector<std::string> out;
            for (size_t i = from; i < sent.size(); ++i)
            {
                const std::string& f = sent[i];
                const size_t start = f.find("\"t\":\"");
                if (start == std::string::npos) { out.push_back("?"); continue; }
                const size_t end = f.find('"', start + 5);
                out.push_back(f.substr(start + 5, end - start - 5));
            }
            return out;
        }
    };

    inline std::string join(const std::vector<std::string>& v)
    {
        std::string out;
        for (size_t i = 0; i < v.size(); ++i) out += (i > 0 ? "," : "") + v[i];
        return out;
    }

    inline std::string wait(const std::optional<double>& w)
    {
        return w.has_value() ? StoryletValue::JsNumber(*w) : std::string("none");
    }

    inline Checks checks(const std::string& root)
    {
        // The Hamlet the fixture plays: a real bundle, so boards and flows are real.
        const BundlePtr bundle = ParseBundle(JsonParser(
            livelinkfixture::readFile(root + "/packages/play-helpers/demo/the-hamlet.storyletsc")).parse());
        const auto engineWith = [bundle](std::vector<std::string> flows)
        {
            EngineOptions opts;
            opts.seed = 7;
            auto engine = std::make_shared<Engine>(bundle, opts);
            for (const std::string& id : flows) engine->openFlow(id);
            return engine;
        };

        Checks out;
        out.emplace_back("retries a refused link after 1 s, doubling to 10 s, logging nothing while it has never opened", []
        {
            std::vector<std::string> bad;
            Rig r;
            std::vector<std::string> waits;
            for (int i = 0; i < 6; ++i)
            {
                r.client.beginAttempt();
                waits.push_back(wait(r.client.onClose(-1)));
                if (std::string(r.client.state()) != "connecting") bad.push_back(std::string("a refused link reads as ") + r.client.state());
            }
            if (join(waits) != "1,2,4,8,10,10") bad.push_back("the waits were " + join(waits));
            if (!r.logged.empty()) bad.push_back("a link that never opened logged \"" + r.logged.front() + "\"");
            if (!r.sent.empty()) bad.push_back("a link that never opened sent " + r.sent.front());
            return bad;
        });

        out.emplace_back("counts an attempt once when its socket reports both an error and a close", []
        {
            std::vector<std::string> bad;
            Rig r;
            r.client.beginAttempt();
            const std::string first = wait(r.client.onClose(-1));
            const std::string second = wait(r.client.onClose(1006));
            if (first != "1" || second != "none") bad.push_back("the waits were " + first + " then " + second);
            if (r.client.nextWait() != 2) bad.push_back("the next wait is " + StoryletValue::JsNumber(r.client.nextWait()));
            return bad;
        });

        out.emplace_back("retries a dropped link, says hello again with the build and open flows, then each flow's board", [engineWith]
        {
            std::vector<std::string> bad;
            Rig r;
            auto engine = engineWith({"main", "side"});
            r.client.attach([engine]() { return engine.get(); });
            r.client.beginAttempt();
            r.client.onOpen();
            engine->getFlow("main")->dealMany();
            const size_t beforeDrop = r.sent.size();
            const std::string dropWait = wait(r.client.onClose(1001));   // the editor quit
            if (dropWait != "1") bad.push_back("a dropped link waited " + dropWait);
            if (std::string(r.client.state()) != "connecting") bad.push_back(std::string("a dropped link reads as ") + r.client.state());
            r.client.beginAttempt();
            const std::string notBack = wait(r.client.onClose(-1));
            if (notBack != "2") bad.push_back("the second wait was " + notBack);
            r.client.setBuild("B2");   // a pushed bundle took while it was away
            if (r.sent.size() != beforeDrop) bad.push_back("something was sent while the editor was away");
            r.client.beginAttempt();
            const size_t from = r.sent.size();
            r.client.onOpen();
            if (std::string(r.client.state()) != "connected") bad.push_back(std::string("a reconnected link reads as ") + r.client.state());
            if (join(r.kinds(from)) != "hello,board,board")
            {
                bad.push_back("on reconnect it sent " + join(r.kinds(from)));
                return bad;
            }
            const std::string hello = r.sent[from];
            const std::string want = R"({"t":"hello","v":2,"build":"B2","flows":["main","side"],"project":"Test","boxes":["village"]})";
            if (hello != want) bad.push_back("the hello was " + hello);
            if (r.sent[from + 1] != LiveLinkBoardFrame(*engine->getFlow("main"))) bad.push_back("the main board was " + r.sent[from + 1]);
            if (r.sent[from + 2] != LiveLinkBoardFrame(*engine->getFlow("side"))) bad.push_back("the side board was " + r.sent[from + 2]);
            r.client.close();
            return bad;
        });

        out.emplace_back("resets the wait to 1 s once a hello goes, and logs lost and back once each", []
        {
            std::vector<std::string> bad;
            Rig r;
            std::vector<std::string> waits;
            r.client.beginAttempt();
            r.client.onOpen();
            waits.push_back(wait(r.client.onClose(1006)));
            r.client.beginAttempt();
            waits.push_back(wait(r.client.onClose(-1)));
            r.client.beginAttempt();
            waits.push_back(wait(r.client.onClose(-1)));
            r.client.beginAttempt();
            r.client.onOpen();   // the hello puts the wait back to 1 s
            waits.push_back(wait(r.client.onClose(1006)));
            if (join(waits) != "1,2,4,1") bad.push_back("the waits were " + join(waits));
            const std::vector<std::string> want = {
                std::string("Live Link lost (") + kUrl + "); retrying.",
                std::string("Live Link is back (") + kUrl + ").",
                std::string("Live Link lost (") + kUrl + "); retrying.",
            };
            if (r.logged != want) bad.push_back("logged: " + join(r.logged));
            return bad;
        });

        out.emplace_back("queues nothing while a retry connects, so the hello and boards stand in for what was missed", [engineWith]
        {
            std::vector<std::string> bad;
            Rig r;
            auto engine = engineWith({"main"});
            r.client.attach([engine]() { return engine.get(); });
            if (r.client.queued() == 0) bad.push_back("the first socket's board did not queue");
            r.client.beginAttempt();
            r.client.onClose(-1);
            if (r.client.queued() != 0) bad.push_back("the queue survived a failed attempt");
            r.client.beginAttempt();
            engine->getFlow("main")->dealMany();   // the editor is away: nowhere to go
            r.client.onTrace("main", TraceEvent());   // and a forwarded event does not queue either
            if (r.client.queued() != 0) bad.push_back(std::to_string(r.client.queued()) + " frame(s) queued while a retry connects");
            r.client.onOpen();
            if (join(r.kinds()) != "hello,board") bad.push_back("on open it sent " + join(r.kinds()));
            const size_t from = r.sent.size();
            engine->getFlow("main")->advanceTurns("village", 1);
            r.client.onTrace("main", [] { TraceEvent e; e.kind = TraceEvent::Kind::Turns; e.box = "village"; e.turn = 1; return e; }());
            if (join(r.kinds(from)) != "trace,board") bad.push_back("once open it sent " + join(r.kinds(from)));
            r.client.close();
            return bad;
        });

        out.emplace_back("drops the queue when the first socket closes", [engineWith]
        {
            std::vector<std::string> bad;
            Rig r;
            auto engine = engineWith({"main"});
            r.client.attach([engine]() { return engine.get(); });
            r.client.beginAttempt();
            r.client.onClose(1006);
            if (r.client.queued() != 0) bad.push_back(std::to_string(r.client.queued()) + " frame(s) kept after a close");
            return bad;
        });

        out.emplace_back("stops for good when the editor replaced it with another game (code 4000)", []
        {
            std::vector<std::string> bad;
            Rig r;
            r.client.beginAttempt();
            r.client.onOpen();
            const std::string replaced = wait(r.client.onClose(LiveLinkClient::kCloseReplaced));
            if (replaced != "none") bad.push_back("a replaced link scheduled a retry in " + replaced);
            if (std::string(r.client.state()) != "closed") bad.push_back(std::string("a replaced link reads as ") + r.client.state());
            const size_t sent = r.sent.size();
            r.client.onOpen();
            r.client.setBuild("B2");
            if (r.sent.size() != sent) bad.push_back("a replaced link sent " + r.sent.back());
            if (wait(r.client.onClose(1000)) != "none") bad.push_back("a later close revived it");
            const std::vector<std::string> want = { std::string("Live Link: another game took the editor's link (") + kUrl + ")." };
            if (r.logged != want) bad.push_back("logged: " + join(r.logged));
            return bad;
        });

        out.emplace_back("stops retrying once the game closes it", []
        {
            std::vector<std::string> bad;
            Rig r;
            r.client.beginAttempt();
            if (wait(r.client.onClose(-1)) != "1") bad.push_back("a refused link did not retry");
            r.client.close();
            if (std::string(r.client.state()) != "closed") bad.push_back(std::string("a closed link reads as ") + r.client.state());
            r.client.beginAttempt();
            if (wait(r.client.onClose(-1)) != "none") bad.push_back("a closed link retried");
            if (!r.logged.empty()) bad.push_back("logged: " + join(r.logged));
            return bad;
        });
        return out;
    }
}
