// The Live Link fixture replay (packages/conformance/live-link/, the
// contract every runtime's client is held to): drive script.json through the
// std-only client (Storylets/LiveLink.h) against a recording sink standing in
// for the socket, then compare what it sent with frames.json, compacted, in
// order, byte for byte. The first difference is the failure. The UE socket
// wrapper (FStoryletLiveLink) is a thin owner over the same class, so this is
// the port's half of the client contract, as the corpus is the engine's.
#pragma once

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "Storylets/JsonParse.h"
#include "Storylets/Bundle.h"
#include "Storylets/JsonValue.h"
#include "Storylets/LiveLink.h"
#include "Storylets/Engine.h"
#include "Storylets/StoryletValue.h"

namespace livelinkfixture
{
    using namespace storylets;

    /** JSON.stringify(value): compact, document key order, JS number form. */
    inline std::string compactJson(const JsonValue& v)
    {
        switch (v.type)
        {
            case JsonValue::Null: return "null";
            case JsonValue::Bool: return v.b ? "true" : "false";
            case JsonValue::Number: return StoryletValue::JsNumber(v.num);
            case JsonValue::String: return StoryletValue::JsonQuote(v.str);
            case JsonValue::Array:
            {
                std::string out = "[";
                for (size_t i = 0; i < v.arr.size(); ++i)
                {
                    if (i > 0) out += ",";
                    out += compactJson(v.arr[i]);
                }
                return out + "]";
            }
            default:
            {
                std::string out = "{";
                for (size_t i = 0; i < v.obj.size(); ++i)
                {
                    if (i > 0) out += ",";
                    out += StoryletValue::JsonQuote(v.obj[i].first) + ":" + compactJson(v.obj[i].second);
                }
                return out + "}";
            }
        }
    }

    inline std::string readFile(const std::string& path)
    {
        std::ifstream file(path);
        if (!file) throw StoryletError("live-link fixture: cannot read " + path);
        std::stringstream buffer;
        buffer << file.rdbuf();
        return buffer.str();
    }

    /** Replays the fixture. `fixtureDir` holds script.json and frames.json;
     *  `root` is the repo root the script's bundle path is relative to.
     *  Returns the number of frames that matched; appends to `failures`.
     *  `dumpPath`, when set, receives every frame the client sent, one per
     *  line, so a real socket can carry them to a running editor. */
    inline size_t replay(const std::string& fixtureDir, const std::string& root,
        std::vector<std::string>& failures, const std::string& dumpPath = "")
    {
        JsonValue script = JsonParser(readFile(fixtureDir + "/script.json")).parse();
        JsonValue expected = JsonParser(readFile(fixtureDir + "/frames.json")).parse();
        if (script.strOr("schema") != "storylets/live-link-fixture@1")
        {
            failures.push_back("script.json: unexpected schema " + script.strOr("schema"));
            return 0;
        }

        BundlePtr bundle = ParseBundle(JsonParser(readFile(root + "/" + script.strOr("bundle"))).parse());
        if (bundle->content.hash != script.strOr("build"))
        {
            failures.push_back("script.json names build " + script.strOr("build")
                + " but the bundle's hash is " + bundle->content.hash);
        }

        // The recording sink: every string the client put on the wire, in order.
        std::vector<std::string> sent;
        std::optional<std::string> project;
        if (script.has("project")) project = script.strOr("project");
        LiveLinkClient client(script.strOr("build"), project,
            [&sent](const std::string& frame) { sent.push_back(frame); });

        EngineOptions opts;
        opts.seed = script.numOr("seed", 0);
        Engine engine(bundle, opts);
        engine.openFlow("main");
        // The host's subscription, as the UE wrapper keeps one at its own level.
        // ENGINE-level now: one stream over every flow, each event tagged.
        std::function<void()> unsubscribe = engine.subscribeTrace(
            [&client](const std::string& flowId, const TraceEvent& event) { client.onTrace(flowId, event); });

        // `flow` names which participant runs the step; absent means "main", so
        // the single-flow half of the script reads as it always did.
        const auto on = [&engine](const JsonValue& step) -> Flow&
        {
            const std::string id = step.has("flow") ? step.strOr("flow") : std::string("main");
            FlowPtr f = engine.getFlow(id);
            if (!f) throw StoryletError("the script names a closed flow \"" + id + "\"");
            return *f;
        };

        for (const JsonValue& step : script.at("steps").arr)
        {
            const std::string op = step.strOr("op");
            if (op == "attach")
            {
                client.attach([&engine]() { return &engine; });
            }
            else if (op == "open")
            {
                client.onOpen();
            }
            else if (op == "openFlow")
            {
                engine.openFlow(step.strOr("flow"));
            }
            else if (op == "closeFlow")
            {
                engine.closeFlow(step.strOr("flow"));
            }
            else if (op == "dealMany")
            {
                std::optional<std::vector<std::string>> hands;
                if (const JsonValue* list = step.find("hands"))
                {
                    hands = std::vector<std::string>();
                    for (const JsonValue& h : list->arr) hands->push_back(h.str);
                }
                on(step).dealMany(hands);
            }
            else if (op == "deal")
            {
                on(step).deal(step.strOr("hand"));
            }
            else if (op == "play")
            {
                on(step).play(step.strOr("card"), step.strOr("outcome"), step.strOr("hand"));
            }
            else if (op == "advanceTurns")
            {
                on(step).advanceTurns(step.strOr("box"), step.numOr("n", 1));
            }
            else if (op == "peek")
            {
                OrderedMap<std::string, std::string> criteria;
                if (const JsonValue* crit = step.find("criteria"))
                {
                    for (const auto& pair : crit->obj) criteria.set(pair.first, pair.second.str);
                }
                std::optional<int> n;
                if (step.has("n")) n = static_cast<int>(step.numOr("n", 0));
                on(step).peek(step.strOr("box"), criteria, n);
            }
            else
            {
                failures.push_back("script.json: unknown op \"" + op + "\"");
            }
        }
        client.close();
        unsubscribe();

        if (!dumpPath.empty())
        {
            std::ofstream dump(dumpPath);
            for (const std::string& frame : sent) dump << frame << "\n";
        }

        size_t matched = 0;
        const size_t count = expected.arr.size();
        for (size_t i = 0; i < count; ++i)
        {
            const std::string want = compactJson(expected.arr[i]);
            if (i >= sent.size())
            {
                failures.push_back("frame " + std::to_string(i) + ": expected " + want + ", but the client sent nothing more");
                break;
            }
            if (sent[i] != want)
            {
                failures.push_back("frame " + std::to_string(i) + ":\n    expected " + want + "\n    sent     " + sent[i]);
                break;
            }
            ++matched;
        }
        if (matched == count && sent.size() > count)
        {
            failures.push_back("the client sent " + std::to_string(sent.size() - count)
                + " frame(s) beyond the " + std::to_string(count) + " expected; first: " + sent[count]);
        }
        return matched;
    }
}
