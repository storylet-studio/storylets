// One registry per game (patterkit design/one-registry-handover.md), from the
// GAME's side: what is in the registry, what the game saves, and that loading
// works in either order and from a version 1 envelope. The C++ port of the
// JS reference's packages/runtime/test/one-registry.test.ts, case for case,
// over the same bundles (expanded from the same fixtures by the conformance
// scaffold and pasted here as JSON), hotSwap on the game's registry among them,
// plus what only a native engine has: the registry is released when the engine
// is destroyed, and an engine a hot swap spent takes nothing with it when it
// goes. Beside them, the runtime half of the compiler test's "other engines'
// scopes" (a card naming @patter), over the bundle that test compiles.
#pragma once

#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "Storylets/Bundle.h"
#include "Storylets/Engine.h"
#include "Storylets/Kernel.h"
#include "Storylets/JsonParse.h"
#include "Storylets/JsonValue.h"
#include "Storylets/Save.h"
#include "Storylets/StoryletValue.h"

namespace oneregistry
{
    using namespace storylets;
    using Blob = ScopeRegistry::SaveBlob;

    /** The JS test's bundle: @world.alarm, a shared @story.gold and a per-flow
     *  @story.steps, a deck k_main with a per-flow `drawn`, one card whose
     *  outcome bumps all four, one hand h_q, and the scaffold's tag v_docks,
     *  which declares a per-flow `danger`. */
    inline const char* BundleJson()
    {
        return R"JSON({"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[{"name":"alarm","type":"number","default":0}]},"story":{"properties":[{"name":"gold","type":"number","default":0},{"name":"steps","type":"number","default":0,"shared":false}]},"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],"decks":[{"id":"k_main","gameId":"main","properties":[{"name":"drawn","type":"number","default":0}],"cards":[{"id":"c_heist","gameId":"heist","priority":0,"redraw":"always","outcomes":[{"id":"o_go","gameId":"go","changes":{"@deck.drawn":{"src":"@deck.drawn + 1","ast":["bin","+",["sv","deck","drawn"],["n",1]]},"@story.gold":{"src":"@story.gold + 1","ast":["bin","+",["sv","story","gold"],["n",1]]},"@story.steps":{"src":"@story.steps + 1","ast":["bin","+",["sv","story","steps"],["n",1]]},"@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]}]}],"handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]})JSON";
    }

    inline BundlePtr MakeBundle(const std::string& json = BundleJson())
    {
        return ParseBundle(JsonParser(json).parse());
    }

    /** The same bundle, with the card's outcome reading another engine's
     *  scope: `@story.gold` becomes `@patter.gold + 1`. */
    inline BundlePtr ReadingPatterBundle()
    {
        std::string json = BundleJson();
        const std::string from = R"("@story.gold":{"src":"@story.gold + 1","ast":["bin","+",["sv","story","gold"],["n",1]]})";
        const std::string to = R"("@story.gold":{"src":"@patter.gold + 1","ast":["bin","+",["sv","patter","gold"],["n",1]]})";
        json.replace(json.find(from), from.size(), to);
        return MakeBundle(json);
    }

    /** One value as JSON. */
    inline std::string Show(const StoryletValue& v) { return v.toJsonString(); }

    /** A registry blob as canonical text: keys sorted at both levels, so two
     *  blobs compare as the JS test's toEqual compares objects. */
    inline std::string Show(const Blob& blob)
    {
        std::map<std::string, std::map<std::string, std::string>> sorted;
        for (const auto& section : blob)
        {
            auto& out = sorted[section.first];
            for (const auto& value : section.second) out[value.first] = Show(value.second);
        }
        std::string text = "{";
        bool firstSection = true;
        for (const auto& section : sorted)
        {
            if (!firstSection) text += ", ";
            firstSection = false;
            text += StoryletValue::JsonQuote(section.first) + ": {";
            bool first = true;
            for (const auto& value : section.second)
            {
                if (!first) text += ", ";
                first = false;
                text += StoryletValue::JsonQuote(value.first) + ": " + value.second;
            }
            text += "}";
        }
        return text + "}";
    }

    /** Build a blob from (key, name, number) triples. */
    inline Blob MakeBlob(const std::vector<std::tuple<std::string, std::string, double>>& rows)
    {
        Blob blob;
        for (const auto& row : rows)
        {
            if (!blob.contains(std::get<0>(row))) blob.set(std::get<0>(row), OrderedMap<std::string, StoryletValue>());
            blob.get(std::get<0>(row))->set(std::get<1>(row), StoryletValue::Num(std::get<2>(row)));
        }
        return blob;
    }

    /** A game that owns its registry and registers @world itself, as a
     *  property the registry stores. */
    struct Game
    {
        std::shared_ptr<ScopeRegistry> registry;
        std::unique_ptr<Engine> engine;
    };

    /** The game's registry, @world registered in it by the game. */
    inline std::shared_ptr<ScopeRegistry> GameRegistry()
    {
        auto registry = std::make_shared<ScopeRegistry>();
        ScopeDeclaration alarm;
        alarm.name = "alarm";
        alarm.type = PropertyTypes::Number;
        alarm.defaultValue = StoryletValue::Num(0);
        OwnedScopeOptions options;
        options.owner = std::string("Game");
        registry->defineOwned("world", std::vector<ScopeDeclaration>{alarm}, options);
        return registry;
    }

    inline Game MakeGame(const BundlePtr& bundle)
    {
        Game g;
        g.registry = GameRegistry();
        EngineOptions opts;
        opts.registry = g.registry;
        opts.seed = 1;
        g.engine = std::make_unique<Engine>(bundle, opts);
        return g;
    }

    inline void Heist(Flow& flow)
    {
        const std::vector<DealtCard> dealt = flow.deal("q");
        if (dealt.empty()) throw StoryletError("the heist was not dealt");
        flow.play(dealt[0].gameId, "go", "q");
    }

    /** An envelope through the text boundary and back: the JS test's
     *  JSON.parse(JSON.stringify(...)), and the writer and reader with it. */
    inline SaveEnvelope RoundTrip(const SaveEnvelope& envelope)
    {
        // serializeState takes an engine; the envelope writer is the same code,
        // reached through the file shape it writes.
        const std::string text = savedetail::EnvelopeToJson(envelope, {});
        const JsonValue tree = JsonParser(text).parse();
        return savedetail::EnvelopeFromTree(*tree.find("engine"));
    }



    struct Check
    {
        std::vector<std::string>& failures;
        std::string test;
        void eq(const std::string& what, const std::string& got, const std::string& want)
        {
            if (got != want) failures.push_back(test + ": " + what + " is " + got + ", expected " + want);
        }
        void yes(const std::string& what, bool ok)
        {
            if (!ok) failures.push_back(test + ": " + what);
        }
        void throws(const std::string& what, const std::function<void()>& fn, const std::string& message)
        {
            try
            {
                fn();
                failures.push_back(test + ": " + what + " did not throw");
            }
            catch (const std::exception& e)
            {
                if (std::string(e.what()).find(message) == std::string::npos)
                {
                    failures.push_back(test + ": " + what + " threw \"" + e.what() + "\", expected \"" + message + "\"");
                }
            }
        }
    };

    inline std::string Num(double n) { return StoryletValue::JsNumber(n); }

    inline bool AnyKeyStartsWith(const Blob& blob, const std::string& prefix)
    {
        for (const auto& section : blob) if (section.first.compare(0, prefix.size(), prefix) == 0) return true;
        return false;
    }

    /** The hotSwap tests' edit (one-registry.test.ts's `edited`): @story gains
     *  `rumours`, the per-flow `steps` is gone, and the box gains a SHARED
     *  property (a bag, and a key, the old engine never had). */
    inline std::string EditedJson()
    {
        return R"JSON({"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[{"name":"alarm","type":"number","default":0}]},"story":{"properties":[{"name":"gold","type":"number","default":0},{"name":"rumours","type":"number","default":0}]},"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[{"name":"heat","type":"number","default":0,"shared":true}],"tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],"decks":[{"id":"k_main","gameId":"main","properties":[{"name":"drawn","type":"number","default":0}],"cards":[{"id":"c_heist","gameId":"heist","priority":0,"redraw":"always","outcomes":[{"id":"o_go","gameId":"go","changes":{"@deck.drawn":{"src":"@deck.drawn + 1","ast":["bin","+",["sv","deck","drawn"],["n",1]]},"@story.gold":{"src":"@story.gold + 1","ast":["bin","+",["sv","story","gold"],["n",1]]},"@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]}]}],"handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]})JSON";
    }

    /** The compiler test's card naming another engine's scope, as the compiler
     *  writes it: `@patter.visits >= 1` gates it, and its outcome changes
     *  `@patter.gold` to `@patter.gold - 1`. The bundle records `patter` in
     *  `externalScopes`. */
    inline std::string PatronJson()
    {
        return R"JSON({"schema":"storylets/bundle@0","content":{"project":"p","version":"0.0.1","hash":"16f2jt4"},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[]},"story":{"properties":[]},"boxes":[{"id":"b_1","gameId":"b1","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[{"id":"d_1","gameId":"d1","tags":[{"id":"v_1","gameId":"v1"}]}],"decks":[{"id":"k_1","gameId":"main","properties":[],"cards":[{"id":"c_1","gameId":"c1","condition":{"src":"@patter.visits >= 1","ast":["bin",">=",["sv","patter","visits"],["n",1]]},"priority":0,"redraw":"always","outcomes":[{"id":"o_1","gameId":"go","changes":{"@patter.gold":{"src":"@patter.gold - 1","ast":["bin","-",["sv","patter","gold"],["n",1]]}}}]}]}],"handTemplates":[],"hands":[{"id":"h_1","gameId":"h1","rule":{"slots":1}}]}],"externalScopes":["patter"]})JSON";
    }

    /** One JSON fragment replaced; throws when the fixture has no such fragment. */
    inline std::string Swapped(std::string json, const std::string& from, const std::string& to)
    {
        const size_t at = json.find(from);
        if (at == std::string::npos) throw StoryletError("the fixture has no " + from);
        return json.replace(at, from.size(), to);
    }

    /** Another engine's game-wide scope, registered as that engine would: owned, under its label. */
    inline void RegisterPatter(ScopeRegistry& registry, const std::vector<std::pair<std::string, double>>& values, bool goldWritable = true)
    {
        std::vector<ScopeDeclaration> decls;
        for (const auto& v : values)
        {
            ScopeDeclaration d;
            d.name = v.first;
            d.type = PropertyTypes::Number;
            d.defaultValue = StoryletValue::Num(v.second);
            if (v.first == "gold" && !goldWritable) d.writable = false;
            decls.push_back(d);
        }
        OwnedScopeOptions options;
        options.owner = std::string("Patter");
        registry.defineOwned("patter", decls, options);
    }

    /** A game mid-run, as the hotSwap tests start it: Patter registered beside the
     *  engine, a heist played on flow f, and values the game loaded that wait for
     *  a flow of this engine (z) and for another engine entirely. */
    inline Game Playing()
    {
        Game g = MakeGame(MakeBundle());
        RegisterPatter(*g.registry, {{"visits", 4}});
        Heist(*g.engine->openFlow("f"));
        g.registry->load(MakeBlob({{"storylets/flow/z/story", "steps", 5}, {"other/deck/inn", "drawn", 2}}), /*keepParked=*/true);
        return g;
    }

    inline std::string Joined(const std::vector<std::string>& v)
    {
        std::string out;
        for (const auto& s : v) out += "[" + s + "]";
        return out;
    }

    /** Every test: a name and a body that records failures. */
    inline std::vector<std::pair<std::string, std::function<void(Check&)>>> Tests()
    {
        std::vector<std::pair<std::string, std::function<void(Check&)>>> tests;

        tests.emplace_back("registers every bag that declares something, under the engine's keys and owner label", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            Heist(*g.engine->openFlow("f"));
            c.eq("the registry's save", Show(g.registry->save()), Show(MakeBlob({
                {"world", "alarm", 1}, {"story", "gold", 1},
                {"storylets/flow/f/story", "steps", 1},
                {"storylets/flow/f/deck/k_main", "drawn", 1},
                {"storylets/flow/f/value/v_docks", "danger", 0},   // the scaffold's tag declares one
            })));
            std::string rows;
            for (const ScopePropertyRow& r : g.registry->listProperties())
            {
                if (r.owner.value_or("") != "Storylet Engine") continue;
                rows += "[" + r.scope + " " + r.path + " " + Show(r.value) + "]";
            }
            c.eq("the engine's rows", rows,
                "[story story.gold 1][storylets/flow/f/story story.steps 1]"
                "[storylets/flow/f/deck/k_main deck.main.drawn 1][storylets/flow/f/value/v_docks value.docks.danger 0]");
        });

        tests.emplace_back("leaves the values out of saveGame when the game passed the registry", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            Heist(*g.engine->openFlow("f"));
            const SaveEnvelope save = RoundTrip(g.engine->saveGame());
            c.eq("schema", save.schema, "storylets/save@2");
            c.yes("the envelope carries no registry", !save.registry.has_value());
            c.yes("the shared half carries no props", !save.shared.props.has_value());
            c.yes("the shared half's spent is empty", save.shared.spent.empty());
            c.yes("the flow carries no props", !save.flows.get("f")->props.has_value());
        });

        tests.emplace_back("does not self-back @world in the game's registry: that token is the game's", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            EngineOptions opts;
            opts.registry = registry;
            Engine engine(MakeBundle(), opts);
            c.yes("story is registered", registry->has("story"));
            c.yes("world is not", !registry->has("world"));
        });

        tests.emplace_back("a standalone engine self-backs @world as a stored property, and a save round-trips exactly", [](Check& c)
        {
            EngineOptions opts;
            opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            Heist(*engine.openFlow("f"));
            const std::string text = serializeState(engine);
            const SaveEnvelope save = savedetail::EnvelopeFromTree(*JsonParser(text).parse().find("engine"));
            c.yes("the envelope carries the registry", save.registry.has_value());
            if (save.registry.has_value())
            {
                c.eq("its registry", Show(*save.registry), Show(MakeBlob({
                    {"story", "gold", 1}, {"world", "alarm", 1},
                    {"storylets/flow/f/story", "steps", 1},
                    {"storylets/flow/f/deck/k_main", "drawn", 1},
                    {"storylets/flow/f/value/v_docks", "danger", 0},
                })));
            }
            Engine restored(MakeBundle(), opts);
            const LoadReport report = restored.loadGame(save);
            c.yes("the report is exact", report.exact);
            c.eq("world.alarm", Show(restored.getProperty("world.alarm")), "1");
            c.eq("deck.main.drawn", Show(restored.getFlow("f")->getProperty("deck.main.drawn")), "1");
            c.eq("the second save", serializeState(restored), text);
        });

        // --- one save for the game, loaded in either order --------------------
        // The game's half of the save goes through the registry's text door.
        struct GameSave { std::string registry; SaveEnvelope storylets; };
        auto session1 = []() -> GameSave
        {
            Game g = MakeGame(MakeBundle());
            Heist(*g.engine->openFlow("f"));
            g.engine->openFlow("g");
            return GameSave{saveRegistry(*g.registry), RoundTrip(g.engine->saveGame())};
        };
        auto check = [](Check& c, Game& g)
        {
            c.eq("story.gold", Show(g.engine->getProperty("story.gold")), "1");
            c.eq("world.alarm", Show(g.engine->getProperty("world.alarm")), "1");
            c.eq("f story.steps", Show(g.engine->getFlow("f")->getProperty("story.steps")), "1");
            c.eq("f deck.main.drawn", Show(g.engine->getFlow("f")->getProperty("deck.main.drawn")), "1");
            c.eq("g story.steps", Show(g.engine->getFlow("g")->getProperty("story.steps")), "0");
            Heist(*g.engine->getFlow("g"));
            c.eq("the registry's gold after g plays", Show(*g.registry->get("story", "gold")), "2");
        };

        tests.emplace_back("one save for the game: registry first, then the engine", [session1, check](Check& c)
        {
            const GameSave save = session1();
            Game g = MakeGame(MakeBundle());
            loadRegistry(*g.registry, save.registry);
            g.engine->loadGame(save.storylets);
            check(c, g);
        });

        tests.emplace_back("one save for the game: the engine first, then the registry", [session1, check](Check& c)
        {
            const GameSave save = session1();
            Game g = MakeGame(MakeBundle());
            g.engine->loadGame(save.storylets);
            loadRegistry(*g.registry, save.registry);
            check(c, g);
        });

        tests.emplace_back("one save for the game: into a game already playing, flows the save lacks leave nothing behind", [session1, check](Check& c)
        {
            const GameSave save = session1();
            Game g = MakeGame(MakeBundle());
            FlowPtr live = g.engine->openFlow("f");
            Heist(*live);
            Heist(*live);                                 // live values the save's must replace
            Heist(*g.engine->openFlow("stray"));          // not in the save: its bags must not survive
            loadRegistry(*g.registry, save.registry);
            g.engine->loadGame(save.storylets);
            check(c, g);
            c.yes("nothing of the stray flow is left", !AnyKeyStartsWith(g.registry->save(), "storylets/flow/stray/"));
        });

        // --- a version 1 envelope, from before the registry held the properties -
        // Read through the text boundary, so Save.h's version 1 reader is on the path.
        auto v1Text = [](const Engine& engine, const std::string& sharedStory) -> std::string
        {
            const BundleContent content = engine.saveGame().content;
            return std::string("{\"schema\": \"storylets/savefile@1\", \"engine\": {")
                + "\"schema\": \"storylets/save@1\", "
                + "\"content\": {\"project\": " + StoryletValue::JsonQuote(content.project)
                + ", \"version\": " + StoryletValue::JsonQuote(content.version)
                + ", \"hash\": " + StoryletValue::JsonQuote(content.hash) + "}, "
                + "\"shared\": {\"props\": {\"story\": " + sharedStory + ", \"box\": {}, \"deck\": {}, \"hand\": {}, \"value\": {}}, \"spent\": []}, "
                + "\"flows\": {\"f\": {"
                + "\"props\": {\"story\": {\"steps\": 2}, \"box\": {}, \"deck\": {\"k_main\": {\"drawn\": 3}}, \"hand\": {}, \"value\": {\"v_docks\": {\"danger\": 1}}}, "
                + "\"turns\": {\"b_x\": 0}, \"prng\": 1, \"cooldowns\": {}, \"board\": {\"h_q\": []}, \"playLog\": []}}"
                + "}, \"world\": {}}";
        };
        auto v1 = [v1Text](const Engine& engine, const std::string& sharedStory = "{\"gold\": 4}") -> SaveEnvelope
        {
            return savedetail::EnvelopeFromTree(*JsonParser(v1Text(engine, sharedStory)).parse().find("engine"));
        };

        tests.emplace_back("a version 1 envelope still loads, its values moving into the registry", [v1, v1Text](Check& c)
        {
            EngineOptions opts;
            opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            c.yes("the report is exact", engine.loadGame(v1(engine)).exact);
            c.eq("story.gold", Show(engine.getProperty("story.gold")), "4");
            c.eq("deck.main.drawn", Show(engine.getFlow("f")->getProperty("deck.main.drawn")), "3");
            const SaveEnvelope after = engine.saveGame();
            c.eq("the registry", after.registry.has_value() ? Show(*after.registry) : "<none>", Show(MakeBlob({
                {"story", "gold", 4}, {"world", "alarm", 0},
                {"storylets/flow/f/story", "steps", 2},
                {"storylets/flow/f/deck/k_main", "drawn", 3},
                {"storylets/flow/f/value/v_docks", "danger", 1},
            })));
            // And the file door takes it too, as loadState / deserializeState.
            Engine viaFile(MakeBundle(), opts);
            deserializeState(viaFile, v1Text(viaFile, "{\"gold\": 4}"));
            c.eq("story.gold through the file", Show(viaFile.getProperty("story.gold")), "4");
        });

        tests.emplace_back("a version 1 envelope loads into the game's registry beside values the game already loaded", [v1](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            registry->load(MakeBlob({{"another-engine/flow/x/scene/s", "mood", 2}}));
            EngineOptions opts;
            opts.registry = registry;
            opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            engine.loadGame(v1(engine));
            c.eq("the registry", Show(registry->save()), Show(MakeBlob({
                {"story", "gold", 4},
                {"storylets/flow/f/story", "steps", 2},
                {"storylets/flow/f/deck/k_main", "drawn", 3},
                {"storylets/flow/f/value/v_docks", "danger", 1},
                {"another-engine/flow/x/scene/s", "mood", 2},
            })));
        });

        tests.emplace_back("a version 1 envelope still reports drift in the values it moves", [v1](Check& c)
        {
            EngineOptions opts;
            opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            const LoadReport report = engine.loadGame(v1(engine, "{\"gold\": \"lots\", \"retired\": 1}"));
            std::string retyped, dropped;
            for (const auto& p : report.retypedProperties) retyped += "[" + p.flow + "|" + p.path + "]";
            for (const auto& p : report.droppedProperties) dropped += "[" + p.flow + "|" + p.path + "]";
            c.eq("retyped", retyped, "[|story.gold]");
            c.eq("dropped", dropped, "[|story.retired]");
            c.eq("story.gold keeps the default", Show(engine.getProperty("story.gold")), "0");
        });

        tests.emplace_back("saveFlow parks a flow whole, properties included, and a resume puts them back", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            Heist(*g.engine->openFlow("f"));
            // Through the string boundary, the only door Blueprint has.
            const FlowSave parked = deserializeFlow(serializeFlow(g.engine->saveFlow("f")));
            c.yes("the parked blob carries props", parked.props.has_value());
            if (parked.props.has_value())
            {
                const auto* drawn = parked.props->deck.get("k_main");
                c.eq("its deck", drawn && drawn->get("drawn") ? Show(*drawn->get("drawn")) : "<none>", "1");
            }
            g.engine->closeFlow("f");
            c.yes("the closed flow's bags left the registry", !AnyKeyStartsWith(g.registry->save(), "storylets/flow/f/"));
            OpenFlowOptions resume;
            resume.restore = parked;
            FlowPtr back = g.engine->openFlow("f", resume);
            c.eq("deck.main.drawn after the resume", Show(back->getProperty("deck.main.drawn")), "1");
        });

        tests.emplace_back("a fresh flow never claims values a load left for its name", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            g.registry->load(MakeBlob({{"storylets/flow/f/deck/k_main", "drawn", 9}}));
            c.eq("deck.main.drawn", Show(g.engine->openFlow("f")->getProperty("deck.main.drawn")), "0");
        });

        tests.emplace_back("reset drops this engine's waiting values and no other engine's", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            Blob blob = g.registry->save();
            blob.set("storylets/flow/z/story", MakeBlob({{"x", "steps", 5}}).at("x"));
            blob.set("other/deck/inn", MakeBlob({{"x", "drawn", 1}}).at("x"));
            g.registry->load(blob);
            g.engine->reset();
            const Blob after = g.registry->save();
            c.yes("the engine's waiting values are gone", !after.contains("storylets/flow/z/story"));
            c.yes("another engine's stay", after.contains("other/deck/inn")
                && after.get("other/deck/inn")->get("drawn") && Show(*after.get("other/deck/inn")->get("drawn")) == "1");
        });

        tests.emplace_back("refuses a token another engine holds, naming it, and leaves the registry as it was", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            EngineOptions opts;
            opts.registry = registry;
            Engine first(MakeBundle(), opts);
            c.throws("a second engine on the same registry", [&]() { Engine second(MakeBundle(), opts); },
                "scope '@story' is already registered by Storylet Engine");

            auto withWorld = std::make_shared<ScopeRegistry>();
            OwnedScopeOptions game;
            game.owner = std::string("Game");
            withWorld->defineOwned("world", std::vector<ScopeDeclaration>{}, game);
            EngineOptions bound;
            bound.registry = withWorld;
            WorldResolver resolver;
            resolver.get = [](const std::string&) -> std::optional<StoryletValue> { return StoryletValue::Num(0); };
            bound.world = resolver;
            c.throws("an engine binding @world the game registered", [&]() { Engine clash(MakeBundle(), bound); },
                "scope '@world' is already registered by Game");
            c.yes("story is not left registered", !withWorld->has("story"));
        });

        tests.emplace_back("reads and writes another engine's game-wide scope by path", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            ScopeDeclaration gold;
            gold.name = "gold";
            gold.type = PropertyTypes::Number;
            gold.defaultValue = StoryletValue::Num(3);
            OwnedScopeOptions patter;
            patter.owner = std::string("Patter");
            registry->defineOwned("patter", std::vector<ScopeDeclaration>{gold}, patter);
            EngineOptions opts;
            opts.registry = registry;
            Engine engine(MakeBundle(), opts);
            c.eq("engine read", Show(engine.getProperty("patter.gold")), "3");
            engine.openFlow("f")->setProperty("patter.gold", StoryletValue::Num(5));
            c.eq("the registry after a flow's write", Show(*registry->get("patter", "gold")), "5");
            engine.setProperty("patter.gold", StoryletValue::Num(6));
            c.eq("the registry after the engine's write", Show(*registry->get("patter", "gold")), "6");
        });

        // --- what only a native engine has --------------------------------------

        tests.emplace_back("an expression reads another engine's scope, and a scope registered later too", [](Check& c)
        {
            auto registry = GameRegistry();
            EngineOptions opts;
            opts.registry = registry;
            Engine engine(ReadingPatterBundle(), opts);
            FlowPtr flow = engine.openFlow("f");
            // The deal evaluates, so the engine's view of the other scopes is
            // built and cached here, before `patter` exists.
            const std::vector<DealtCard> dealt = flow->deal("q");
            c.yes("the heist is dealt", !dealt.empty());
            if (dealt.empty()) return;
            // Registered after that: the cached view rebuilds when the
            // registry's revision moves.
            ScopeDeclaration gold;
            gold.name = "gold";
            gold.type = PropertyTypes::Number;
            gold.defaultValue = StoryletValue::Num(7);
            OwnedScopeOptions patter;
            patter.owner = std::string("Patter");
            registry->defineOwned("patter", std::vector<ScopeDeclaration>{gold}, patter);
            flow->play(dealt[0].gameId, "go", "q");
            c.eq("story.gold = @patter.gold + 1", Show(engine.getProperty("story.gold")), "8");
        });

        tests.emplace_back("an engine that goes away takes its bags out of the game's registry", [](Check& c)
        {
            auto registry = GameRegistry();
            EngineOptions opts;
            opts.registry = registry;
            FlowPtr held;
            {
                Engine engine(MakeBundle(), opts);
                held = engine.openFlow("f");
                Heist(*held);
            }
            c.yes("story is gone", !registry->has("story"));
            c.yes("the flow's bags are gone", !AnyKeyStartsWith(registry->save(), "storylets/"));
            c.yes("a handle held past the engine reads as closed", held->isClosed());
            Engine again(MakeBundle(), opts);
            c.yes("a new engine registers on the same registry", registry->has("story"));
        });

        // --- hotSwap on the game's registry ---------------------------------------
        // A live bundle refresh that hands this engine's keys to its replacement,
        // reports property drift as a load does, and touches nothing else in the
        // registry.

        tests.emplace_back("hotSwap carries the run across, reports the dropped property, and really drops it", [](Check& c)
        {
            Game g = Playing();
            Engine::HotSwapResult swap = g.engine->hotSwap(MakeBundle(EditedJson()));
            Engine& next = *swap.engine;
            c.eq("story.gold", Show(next.getProperty("story.gold")), "1");
            c.eq("story.rumours", Show(next.getProperty("story.rumours")), "0");
            c.eq("f deck.main.drawn", Show(next.getFlow("f")->getProperty("deck.main.drawn")), "1");
            std::string dropped;
            for (const auto& p : swap.report.droppedProperties) dropped += "[" + p.flow + "|" + p.path + "]";
            c.eq("dropped", dropped, "[f|story.steps]");
            c.yes("the dropped property is gone, not a stray", !g.registry->save().contains("storylets/flow/f/story"));
            Heist(*next.getFlow("f"));
            c.eq("the registry's gold after the replacement plays", Show(*g.registry->get("story", "gold")), "2");
            // The spent engine goes, and takes nothing of the replacement's with it.
            g.engine.reset();
            c.yes("story is still registered", g.registry->has("story"));
            c.yes("the box's new shared bag is still registered", g.registry->has("storylets/box/b_x"));
            c.yes("f's deck bag is still registered", g.registry->has("storylets/flow/f/deck/k_main"));
            c.eq("gold after the old engine went", Show(next.getProperty("story.gold")), "2");
        });

        tests.emplace_back("hotSwap touches nothing that is not this engine's, and waiting values wait on", [](Check& c)
        {
            Game g = Playing();
            Engine::HotSwapResult swap = g.engine->hotSwap(MakeBundle(EditedJson()));
            const Blob saved = g.registry->save();
            auto one = [&saved](const std::string& key) -> std::string
            {
                const auto* section = saved.get(key);
                if (!section) return "<none>";
                Blob just;
                just.set(key, *section);
                return Show(just);
            };
            c.eq("patter", one("patter"), Show(MakeBlob({{"patter", "visits", 4}})));
            c.eq("other/deck/inn", one("other/deck/inn"), Show(MakeBlob({{"other/deck/inn", "drawn", 2}})));
            c.eq("storylets/flow/z/story", one("storylets/flow/z/story"), Show(MakeBlob({{"storylets/flow/z/story", "steps", 5}})));
            c.eq("world", one("world"), Show(MakeBlob({{"world", "alarm", 1}})));
        });

        tests.emplace_back("hotSwap refuses another project before anything moves", [](Check& c)
        {
            Game g = Playing();
            const std::string before = saveRegistry(*g.registry);   // in order: nothing re-registered
            const std::string other = Swapped(EditedJson(), R"("project":"conf")", R"("project":"somebody-else")");
            c.throws("the swap", [&] { g.engine->hotSwap(MakeBundle(other)); }, "somebody-else");
            c.eq("the registry", saveRegistry(*g.registry), before);
            Heist(*g.engine->getFlow("f"));                         // the old engine still plays
            c.eq("the registry's gold", Show(*g.registry->get("story", "gold")), "2");
        });

        tests.emplace_back("hotSwap that fails part way leaves this engine and the registry exactly as they were", [](Check& c)
        {
            Game g = Playing();
            const std::string before = Show(g.registry->save());
            // The replacement is asked to bind @world, which the game already
            // registered: it clashes mid-build.
            WorldResolver resolver;
            resolver.get = [](const std::string&) -> std::optional<StoryletValue> { return StoryletValue::Num(0); };
            std::string type, message;
            try { g.engine->hotSwap(MakeBundle(EditedJson()), [&resolver](EngineOptions& o) { o.world = resolver; }); }
            catch (const StoryletError& e) { type = "StoryletError"; message = e.what(); }
            catch (const std::exception& e) { type = "another type"; message = e.what(); }
            c.eq("the refusal", type + ": " + message, "StoryletError: scope '@world' is already registered by Game (wanted by Storylet Engine)");
            // Every key and value as before (the order of keys may differ: registering again appends).
            c.eq("the registry", Show(g.registry->save()), before);
            Heist(*g.engine->getFlow("f"));
            c.eq("the registry's gold", Show(*g.registry->get("story", "gold")), "2");
            c.eq("f story.steps", Show(g.engine->getFlow("f")->getProperty("story.steps")), "2");
        });

        tests.emplace_back("a standalone engine's hotSwap is a save and a load, and leaves the engine untouched", [](Check& c)
        {
            EngineOptions opts;
            opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            Heist(*engine.openFlow("f"));
            Engine::HotSwapResult swap = engine.hotSwap(MakeBundle(EditedJson()));
            c.yes("the replacement made a registry of its own", swap.engine->registry() != engine.registry() && swap.engine->ownsRegistry());
            std::string dropped;
            for (const auto& p : swap.report.droppedProperties) dropped += "[" + p.flow + "|" + p.path + "]";
            c.eq("dropped", dropped, "[f|story.steps]");
            c.eq("the replacement's gold", Show(swap.engine->getProperty("story.gold")), "1");
            FlowPtr old = engine.getFlow("f");
            c.yes("the old engine's flow is still open", old != nullptr && !old->isClosed());
            if (!old || old->isClosed()) return;
            c.eq("the old engine's steps", Show(old->getProperty("story.steps")), "1");
            Heist(*old);
            c.eq("the old engine still plays", Show(engine.getProperty("story.gold")), "2");
            c.eq("and the replacement never noticed", Show(swap.engine->getProperty("story.gold")), "1");
        });

        tests.emplace_back("hotSwap changes only what the callback changes, and keeps the rest of the options", [](Check& c)
        {
            // Built with a seed and a @world the game keeps; the swap turns the log on and nothing else.
            auto alarm = std::make_shared<double>(3);
            WorldResolver resolver;
            resolver.get = [alarm](const std::string& name) -> std::optional<StoryletValue>
            {
                if (name == "alarm") return StoryletValue::Num(*alarm);
                return std::nullopt;
            };
            resolver.set = [alarm](const std::string& name, const StoryletValue& value)
            {
                if (name == "alarm") *alarm = value.n;
            };
            EngineOptions opts;
            opts.seed = 7;
            opts.world = resolver;
            Engine engine(MakeBundle(), opts);
            Engine::HotSwapResult swap = engine.hotSwap(MakeBundle(EditedJson()), [](EngineOptions& o) { o.log = true; });
            Engine& next = *swap.engine;
            c.eq("world.alarm, through the resolver it was built with", Show(next.getProperty("world.alarm")), "3");
            // A new flow's PRNG starts from the engine's seed: the same as a fresh engine seeded 7, not 0.
            auto prngOf = [](Engine& e) -> std::string
            {
                e.openFlow("n");
                const SaveEnvelope save = e.saveGame();
                const FlowSave* flow = save.flows.get("n");
                return flow ? std::to_string(flow->prng) : "<none>";
            };
            EngineOptions seven;
            seven.seed = 7;
            Engine sevenRef(MakeBundle(EditedJson()), seven);
            Engine zeroRef(MakeBundle(EditedJson()));
            const std::string got = prngOf(next);
            c.eq("the seed it was built with", got, prngOf(sevenRef));
            c.yes("a seed of 7 starts where a seed of 0 does not", got != prngOf(zeroRef));
            // What the callback changed: the replacement keeps a log, where the engine it replaced did not.
            Heist(*next.openFlow("f2"));
            Heist(*engine.openFlow("f2"));
            c.yes("the replacement keeps a log", !next.log().empty());
            c.yes("the engine it replaced kept none", engine.log().empty());
            // And a later swap of the replacement starts from ITS options: the log stays on.
            Engine::HotSwapResult again = next.hotSwap(MakeBundle(EditedJson()));
            Heist(*again.engine->openFlow("f3"));
            c.yes("a second swap keeps the first one's change", !again.engine->log().empty());
            c.yes("the heists wrote the game's alarm", *alarm > 3);
            c.eq("and the resolver", Show(again.engine->getProperty("world.alarm")), Num(*alarm));
        });

        // --- other engines' scopes ---------------------------------------------
        // A card may name `@patter.x` with no project setting: the compiler records
        // the token in the bundle (`externalScopes`), and the engine reads and
        // writes it through the game's registry, and refuses to open a flow (or
        // load a save) where nobody registered it, before anything changes.

        tests.emplace_back("reads externalScopes from the bundle", [](Check& c)
        {
            c.eq("externalScopes", Joined(MakeBundle(PatronJson())->externalScopes), "[patter]");
            c.eq("a bundle naming no other engine", Joined(MakeBundle()->externalScopes), "");
        });

        tests.emplace_back("the engine reads and writes it through the game's registry", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            RegisterPatter(*registry, {{"gold", 3}, {"visits", 1}});
            EngineOptions opts;
            opts.registry = registry;
            Engine engine(MakeBundle(PatronJson()), opts);
            std::string writes;
            engine.subscribeTrace([&writes](const std::string&, const TraceEvent& e)
            {
                if (e.kind == TraceEvent::Kind::Write) writes += "[" + e.path + " " + (e.prev ? Show(*e.prev) : "-") + "]";
            });
            FlowPtr flow = engine.openFlow("main");
            std::vector<std::string> dealt;
            for (const auto& card : flow->deal("h1")) dealt.push_back(card.gameId);
            c.eq("dealt", Joined(dealt), "[c1]");
            flow->play("c1", "go", "h1");
            c.eq("the registry's patter.gold", Show(*registry->get("patter", "gold")), "2");
            c.eq("the write on the trace", writes, "[patter.gold 3]");
        });

        tests.emplace_back("refuses to open a flow, or load a save, where nobody registered the scope, before anything changes", [](Check& c)
        {
            const std::string refusal =
                "this content names @patter, which no engine on this registry registered: give every engine the game's one registry";
            // The engine's own error, carrying exactly the message every runtime gives.
            auto refused = [&c, &refusal](const std::string& what, const std::function<void()>& fn)
            {
                try { fn(); c.yes(what + " did not throw", false); }
                catch (const StoryletError& e) { c.eq(what, e.what(), refusal); }
                catch (const std::exception& e) { c.yes(what + " threw another type: " + e.what(), false); }
            };
            Engine alone(MakeBundle(PatronJson()));
            refused("the open", [&] { alone.openFlow("main"); });
            c.yes("the refused open left no flow", alone.getFlow("main") == nullptr);

            // A save made where Patter was present, loaded where it is not: refused whole.
            auto registry = std::make_shared<ScopeRegistry>();
            RegisterPatter(*registry, {{"gold", 3}, {"visits", 1}});
            EngineOptions opts;
            opts.registry = registry;
            Engine game(MakeBundle(PatronJson()), opts);
            game.openFlow("main")->deal("h1");
            const SaveEnvelope save = game.saveGame();
            auto elsewhere = std::make_shared<ScopeRegistry>();
            RegisterPatter(*elsewhere, {{"gold", 3}, {"visits", 1}});
            EngineOptions otherOpts;
            otherOpts.registry = elsewhere;
            Engine other(MakeBundle(PatronJson()), otherOpts);
            FlowPtr keep = other.openFlow("keep");
            elsewhere->remove("patter");
            refused("the load", [&] { other.loadGame(save); });
            std::vector<std::string> ids;
            for (const auto& flow : other.flows()) ids.push_back(flow->id());
            c.eq("the load changed nothing", Joined(ids), "[keep]");
            c.yes("the flow it had is still open", !keep->isClosed());

            // The engine that took the scope away mid-game: a write names it.
            const std::string always = Swapped(Swapped(PatronJson(), R"(["bin",">=",["sv","patter","visits"],["n",1]])", R"(["b",true])"),
                R"(["bin","-",["sv","patter","gold"],["n",1]])", R"(["n",1])");
            auto shared = std::make_shared<ScopeRegistry>();
            RegisterPatter(*shared, {{"gold", 3}});
            EngineOptions sharedOpts;
            sharedOpts.registry = shared;
            Engine payingEngine(MakeBundle(always), sharedOpts);
            FlowPtr paying = payingEngine.openFlow("main");
            paying->deal("h1");
            shared->remove("patter");
            c.throws("the play", [&] { paying->play("c1", "go", "h1"); },
                "@patter.gold cannot be written: no engine on this registry registered @patter");
            // A token the bundle does not name is not another engine's: still a bad target.
            const std::string unnamed = Swapped(always, R"(,"externalScopes":["patter"])", "");
            Engine plain(MakeBundle(unnamed));
            FlowPtr unlisted = plain.openFlow("main");
            unlisted->deal("h1");
            c.throws("the play without externalScopes", [&] { unlisted->play("c1", "go", "h1"); }, "bad change target scope \"@patter\"");
        });

        tests.emplace_back("opens once the game has registered it, whatever order it built its engines in", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            EngineOptions opts;
            opts.registry = registry;
            Engine engine(MakeBundle(PatronJson()), opts);
            // After the engine, before any flow.
            RegisterPatter(*registry, {{"gold", 3}, {"visits", 1}});
            FlowPtr flow = engine.openFlow("main");
            c.eq("dealt", std::to_string(flow->deal("h1").size()), "1");
        });

        return tests;
    }

    struct Result
    {
        int passed = 0;
        int total = 0;
        std::vector<std::string> failures;
    };

    inline Result Run()
    {
        Result result;
        for (const auto& test : Tests())
        {
            ++result.total;
            std::vector<std::string> failures;
            Check check{failures, test.first};
            try
            {
                test.second(check);
            }
            catch (const std::exception& e)
            {
                failures.push_back(test.first + ": threw " + e.what());
            }
            if (failures.empty()) ++result.passed;
            for (auto& f : failures) result.failures.push_back(std::move(f));
        }
        return result;
    }
    // ----- kernel errors --------------------------------------------------------
    //
    // The kernel (wildwinter::expr, shared with Patterplay since 2026-09-24)
    // throws its own ExprError and RegistryError, never the engine's. Every place
    // the engine calls it for something that can refuse catches them and rethrows
    // the engine's own type with the kernel's message, as it threw before the
    // kernel was shared: an ExprError as EvalError, a RegistryError as
    // StoryletError. So a host's catch keeps working and no kernel exception
    // crosses the plugin's API. One case per rethrow site in the core, each of
    // which fails (the kernel's own type arrives instead) when that site's
    // kernelCall is removed.

    /** The exact type a refusal arrived as: EvalError is tested before its base,
     *  StoryletError, and the kernel's two are named for what they are. */
    inline std::string ThrownType(const std::function<void()>& fn, std::string& message)
    {
        try { fn(); }
        catch (const EvalError& e) { message = e.what(); return "EvalError"; }
        catch (const StoryletError& e) { message = e.what(); return "StoryletError"; }
        catch (const ExprError& e) { message = e.what(); return "the kernel's ExprError"; }
        catch (const RegistryError& e) { message = e.what(); return "the kernel's RegistryError"; }
        catch (const std::exception& e) { message = e.what(); return "some other std::exception"; }
        return "";
    }

    /** fn must throw exactly `type` (the engine's own), carrying `contains`. */
    inline void ThrowsExactly(Check& c, const std::string& what, const std::function<void()>& fn,
                              const std::string& type, const std::string& contains)
    {
        std::string message;
        const std::string got = ThrownType(fn, message);
        if (got.empty()) c.failures.push_back(c.test + ": " + what + " did not throw");
        else if (got != type) c.failures.push_back(c.test + ": " + what + " threw " + got + " (\"" + message + "\"), expected " + type);
        else if (message.find(contains) == std::string::npos)
            c.failures.push_back(c.test + ": " + what + " threw \"" + message + "\", expected \"" + contains + "\"");
    }

    /** BundleJson with one fragment replaced; a fixture that did not change is a failure. */
    inline std::string Patched(Check& c, const std::string& from, const std::string& to)
    {
        std::string json = BundleJson();
        const size_t at = json.find(from);
        if (at == std::string::npos) { c.failures.push_back(c.test + ": the fixture has no " + from); return json; }
        return json.replace(at, from.size(), to);
    }

    /** A scope another engine lends with no way to write it. */
    struct NoSetScope : IScopeResolver
    {
        std::optional<StoryletValue> get(const std::string&) const override { return StoryletValue::Num(0); }
        bool canSet() const override { return false; }
        void set(const std::string&, const StoryletValue&) override {}
    };

    inline std::vector<std::pair<std::string, std::function<void(Check&)>>> KernelErrorTests()
    {
        std::vector<std::pair<std::string, std::function<void(Check&)>>> tests;

        tests.emplace_back("a story write the game's @world refuses is a StoryletError (Engine::worldSet)", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            ScopeDeclaration alarm;
            alarm.name = "alarm"; alarm.type = PropertyTypes::Number; alarm.defaultValue = StoryletValue::Num(0); alarm.writable = false;
            OwnedScopeOptions options; options.owner = std::string("Game");
            registry->defineOwned("world", std::vector<ScopeDeclaration>{alarm}, options);
            EngineOptions opts; opts.registry = registry; opts.seed = 1;
            Engine engine(MakeBundle(), opts);
            ThrowsExactly(c, "the outcome's @world write", [&] { Heist(*engine.openFlow("f")); }, "StoryletError", "'@world.alarm' is read-only");
        });

        tests.emplace_back("a story write to a read-only @story property is a StoryletError (Flow::landIn)", [](Check& c)
        {
            // `writable: false` on @story.gold, read from the BUNDLE, as the JS reference and C#
            // read it. PropertyDecl once re-declared `writable`, hiding the kernel's
            // ScopeDeclaration::writable: the reader filled the copy, the bag read the other, and
            // a read-only declaration refused nothing. The game's own write still lands: the flag
            // is the story's promise, not a lock on the host.
            const std::string json = Patched(c, R"({"name":"gold","type":"number","default":0})",
                R"({"name":"gold","type":"number","default":0,"writable":false})");
            EngineOptions opts; opts.seed = 1;
            Engine engine(MakeBundle(json), opts);
            ThrowsExactly(c, "the outcome's @story write", [&] { Heist(*engine.openFlow("f")); }, "StoryletError", "'gold' is read-only");
            try { engine.setProperty("story.gold", StoryletValue::Num(7)); }
            catch (const std::exception& ex) { c.failures.push_back(c.test + ": the host's write was refused: " + ex.what()); }
            c.eq("the host's write landed", Show(engine.getProperty("story.gold")), "7");
        });

        tests.emplace_back("a malformed expression in a bundle is an EvalError (DeserialiseAst)", [](Check& c)
        {
            const std::string json = Patched(c, R"(["n",1])", R"(["zz",1])");
            ThrowsExactly(c, "loading the bundle", [&] { MakeBundle(json); }, "EvalError", "unknown ast tag: zz");
        });

        tests.emplace_back("a flow's bag clashing with a key the game holds is a StoryletError (Flow::registerBags)", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            OwnedScopeOptions options; options.owner = std::string("Game");
            g.registry->defineOwned("storylets/flow/f/story", {}, options);
            ThrowsExactly(c, "opening the flow", [&] { g.engine->openFlow("f"); }, "StoryletError",
                "scope '@storylets/flow/f/story' is already registered by Game");
        });

        tests.emplace_back("a token clash as the engine registers is a StoryletError (Engine::registerShared)", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            OwnedScopeOptions options; options.owner = std::string("Game");
            registry->defineOwned("story", {}, options);
            EngineOptions opts; opts.registry = registry;
            ThrowsExactly(c, "building the engine", [&] { Engine engine(MakeBundle(), opts); }, "StoryletError",
                "scope '@story' is already registered by Game (wanted by Storylet Engine)");
        });

        tests.emplace_back("an expression the kernel refuses is an EvalError (Flow::eval)", [](Check& c)
        {
            const std::string json = Patched(c, R"(["bin","+",["sv","story","gold"],["n",1]])", R"(["bin","/",["n",1],["n",0]])");
            EngineOptions opts; opts.seed = 1;
            Engine engine(MakeBundle(json), opts);
            ThrowsExactly(c, "the outcome's @story change", [&] { Heist(*engine.openFlow("f")); }, "EvalError", "division by zero");
        });

        tests.emplace_back("an outcome's write another engine's scope refuses is a StoryletError (Flow::applyWrite)", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            RegisterPatter(*registry, {{"gold", 3}, {"visits", 1}}, /*goldWritable=*/false);
            EngineOptions opts; opts.registry = registry;
            Engine engine(MakeBundle(PatronJson()), opts);
            FlowPtr flow = engine.openFlow("main");
            flow->deal("h1");
            ThrowsExactly(c, "the outcome's @patter write", [&] { flow->play("c1", "go", "h1"); }, "StoryletError", "'@patter.gold' is read-only");
        });

        tests.emplace_back("the game's write to another engine's scope with no setter is a StoryletError (Engine::setProperty)", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            ForeignScopeOptions options; options.owner = std::string("Patter");
            registry->defineForeign("patter", std::make_shared<NoSetScope>(), nullptr, options);
            EngineOptions opts; opts.registry = registry;
            Engine engine(MakeBundle(), opts);
            ThrowsExactly(c, "the engine's setProperty", [&] { engine.setProperty("patter.gold", StoryletValue::Num(5)); },
                "StoryletError", "'@patter.gold' is read-only");
        });

        tests.emplace_back("the game's write to another engine's scope with no setter is a StoryletError (Flow::setProperty)", [](Check& c)
        {
            auto registry = std::make_shared<ScopeRegistry>();
            ForeignScopeOptions options; options.owner = std::string("Patter");
            registry->defineForeign("patter", std::make_shared<NoSetScope>(), nullptr, options);
            EngineOptions opts; opts.registry = registry;
            Engine engine(MakeBundle(), opts);
            ThrowsExactly(c, "a flow's setProperty", [&] { engine.openFlow("f")->setProperty("patter.gold", StoryletValue::Num(5)); },
                "StoryletError", "'@patter.gold' is read-only");
        });

        return tests;
    }

    inline Result RunKernelErrors()
    {
        Result result;
        for (const auto& test : KernelErrorTests())
        {
            ++result.total;
            std::vector<std::string> failures;
            Check check{failures, test.first};
            try
            {
                test.second(check);
            }
            catch (const std::exception& e)
            {
                failures.push_back(test.first + ": threw " + e.what());
            }
            if (failures.empty()) ++result.passed;
            for (auto& f : failures) result.failures.push_back(std::move(f));
        }
        return result;
    }
}
