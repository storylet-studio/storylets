// One registry per game (patterkit design/one-registry-handover.md), from the
// GAME's side: what is in the registry, what the game saves, and that loading
// works in either order and from a version 1 envelope. The C++ port of the
// JS reference's packages/runtime/test/one-registry.test.ts, case for case,
// over the same bundle (expanded from the same fixture by the conformance
// scaffold and pasted here as JSON), plus what only a native engine has: the
// registry is released when the engine is destroyed, and the live swap's
// hand-over (UStoryletEngine::ApplyLiveBundle) keeps every value.
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
#include "Storylets/Expr/ScopeRegistry.h"
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

        tests.emplace_back("the live swap's hand-over keeps every value, and a failed swap puts them back", [](Check& c)
        {
            Game g = MakeGame(MakeBundle());
            Heist(*g.engine->openFlow("f"));
            const SaveEnvelope snapshot = g.engine->saveGame();
            // A failed swap: released, then restored.
            g.engine->releaseRegistrations(true);
            c.yes("released: story is gone", !g.registry->has("story"));
            g.engine->restoreRegistrations();
            c.eq("restored story.gold", Show(g.engine->getProperty("story.gold")), "1");
            c.eq("restored deck.main.drawn", Show(g.engine->getFlow("f")->getProperty("deck.main.drawn")), "1");
            // The swap itself: the replacement claims what the old engine left.
            g.engine->releaseRegistrations(true);
            EngineOptions opts;
            opts.registry = g.registry;
            opts.seed = 1;
            auto next = std::make_unique<Engine>(MakeBundle(), opts);
            next->loadGame(snapshot);
            g.engine = std::move(next);   // the old engine goes, and takes nothing with it
            c.eq("story.gold", Show(g.engine->getProperty("story.gold")), "1");
            c.eq("f story.steps", Show(g.engine->getFlow("f")->getProperty("story.steps")), "1");
            c.eq("f deck.main.drawn", Show(g.engine->getFlow("f")->getProperty("deck.main.drawn")), "1");
            c.yes("story is registered", g.registry->has("story"));
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
}
