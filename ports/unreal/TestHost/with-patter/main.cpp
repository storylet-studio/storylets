// The combined proof on Unreal's C++: a Patter engine and a Storylet Engine in
// one game, on ONE ScopeRegistry, with one save (patterkit
// design/one-registry-handover.md). A port of the JS runtime's
// packages/runtime/test/with-patter/combined-game.test.ts, case for case, with
// the same content and the same expectations.
//
// This translation unit includes BOTH plugins' std C++ cores: the Storylet
// Engine's from this repo, Patterplay's from a sibling ../patter checkout
// (build.sh beside this; it skips, saying so, when there is none). Each plugin
// carries its own vendored copy of the shared kernel (Storylets/Expr/ and
// Patter/Expr/, byte-identical, from expr/ports/unreal); the kernel's include
// guards carry its id, so the second copy's every class body is skipped, and
// patter::ScopeRegistry and storylets::ScopeRegistry are one type. That is
// checked at compile time below, and the cases then hand one registry object
// to both engines, which before the shared kernel no C++ game could.
//
// The game owns the registry and registers @world itself, as a property the
// registry stores. Each engine registers its own scopes: the Storylet Engine
// @story and its per-flow bags, Patter @patter and its per-flow and per-scene
// bags. Every expression reads every scope, so a Patter scene gates on
// @story.act, and a storylet gates on a @world value a Patter scene wrote. One
// save is { registry, patter, storylets }.
//
// Each case runs twice: once with the game writing and reading its registry
// through Patterplay's patter::saveRegistry / loadRegistry, once through the
// Storylet Engine's. A last case crosses them. As the dotnet host does.
//
// The first argument, if any, names a probe (see Probe below): a deliberate
// integration mistake, which build.sh's --probes mode uses to show that every
// case can fail.

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <typeinfo>
#include <vector>

// Both plugins' public std C++ headers, in one translation unit.
#include "Storylets/Engine.h"
#include "Storylets/JsonParse.h"
#include "Storylets/Save.h"
#include "Patter/Engine.h"
#include "Patter/Save.h"

namespace P = patter;
namespace S = storylets;
namespace K = wildwinter::expr;

// One kernel type, not two: the proof that the guards held.
static_assert(std::is_same<P::ScopeRegistry, S::ScopeRegistry>::value, "two ScopeRegistry types: the kernel guards did not hold");
static_assert(std::is_same<P::PatterValue, S::StoryletValue>::value, "two value types: the kernel guards did not hold");
static_assert(std::is_same<P::PatterKind, S::StoryletKind>::value, "two kind enums: the kernel guards did not hold");
static_assert(std::is_same<P::PropertyBag, S::PropertyBag>::value, "two PropertyBag types: the kernel guards did not hold");
static_assert(std::is_same<P::IScopeResolver, S::IScopeResolver>::value, "two resolver interfaces: the kernel guards did not hold");

namespace
{
    // --- probes ---------------------------------------------------------------------
    //
    // Each is a mistake a game could make integrating the two engines, and each
    // case fails under at least one of them (build.sh --probes runs them all).

    enum class Probe
    {
        None,
        TwoRegistries,     // the Storylet Engine gets a registry of its own
        NoRegistryLoad,    // the game forgets to load its registry on resume
        EnginesSaveValues, // both engines are standalone, so each save carries the values
        FreshSwap,         // a live edit rebuilds the engine instead of hot-swapping it
        NoClash,           // the second engine of a kind goes on a registry of its own
    };

    Probe g_probe = Probe::None;

    Probe ProbeNamed(const std::string& name)
    {
        if (name == "two-registries") return Probe::TwoRegistries;
        if (name == "no-registry-load") return Probe::NoRegistryLoad;
        if (name == "engines-save-values") return Probe::EnginesSaveValues;
        if (name == "fresh-swap") return Probe::FreshSwap;
        if (name == "no-clash") return Probe::NoClash;
        throw std::runtime_error("unknown probe: " + name);
    }

    // --- assertions -----------------------------------------------------------------

    struct Failed : std::runtime_error
    {
        explicit Failed(const std::string& what) : std::runtime_error(what) {}
    };

    void Check(bool ok, const std::string& what)
    {
        if (!ok) throw Failed(what);
    }

    std::string Show(const std::optional<K::ExprValue>& v) { return v ? v->toJsonString() : std::string("nothing"); }

    void Num(const std::optional<K::ExprValue>& v, double want, const std::string& what)
    {
        if (!v || !v->isNumber() || v->asNumber() != want)
        {
            throw Failed(what + ": expected " + K::ExprValue::JsNumber(want) + ", got " + Show(v));
        }
    }

    void Num(const K::ExprValue* v, double want, const std::string& what)
    {
        Num(v ? std::optional<K::ExprValue>(*v) : std::nullopt, want, what);
    }

    std::string Describe(const P::StepResult& step)
    {
        switch (step.type)
        {
            case P::StepType::End: return "end";
            case P::StepType::Line: return "line " + step.character + " \"" + step.text + "\"";
            case P::StepType::Text: return "text \"" + step.text + "\"";
            case P::StepType::Choice: return "choice";
            case P::StepType::GameEvent: return "game event " + step.id;
        }
        return "?";
    }

    void End(const P::StepResult& step, const std::string& what)
    {
        if (step.type != P::StepType::End) throw Failed(what + ": expected the end, got " + Describe(step));
    }

    /** fn must throw the engine's own error, exactly `type` and never the kernel's,
     *  carrying `contains` as a whole name ("registered by Patter" must not pass for a
     *  holder named "Patterplay"). */
    void ThrowsExactly(const std::function<void()>& fn, const std::string& type, const std::string& contains, const std::string& what)
    {
        std::string got, message;
        try { fn(); }
        catch (const S::EvalError& e) { got = "storylets::EvalError"; message = e.what(); }
        catch (const S::StoryletError& e) { got = "storylets::StoryletError"; message = e.what(); }
        catch (const P::EvalError& e) { got = "patter::EvalError"; message = e.what(); }
        catch (const K::ExprError& e) { got = "the kernel's ExprError"; message = e.what(); }
        catch (const K::RegistryError& e) { got = "the kernel's RegistryError"; message = e.what(); }
        catch (const std::exception& e) { got = "some other std::exception"; message = e.what(); }
        if (got.empty()) throw Failed(what + ": did not throw");
        if (got != type) throw Failed(what + ": threw " + got + " \"" + message + "\", expected " + type);
        const size_t at = message.find(contains);
        const size_t end = at + contains.size();
        if (at == std::string::npos || (end < message.size() && std::isalnum(static_cast<unsigned char>(message[end]))))
        {
            throw Failed(what + ": threw \"" + message + "\", expected \"" + contains + "\"");
        }
    }

    // --- JSON, through the Storylet Engine's own neutral tree ---------------------------

    S::JsonValue Parse(const std::string& text) { return S::JsonParser(text).parse(); }

    /** Canonical text for a JSON tree: object keys sorted, integral numbers without a
     *  point, so two trees compare as the JS test's toEqual compares objects. */
    std::string Canon(const S::JsonValue& v)
    {
        switch (v.type)
        {
            case S::JsonValue::Null: return "null";
            case S::JsonValue::Bool: return v.b ? "true" : "false";
            case S::JsonValue::Number: return K::ExprValue::JsNumber(v.num);
            case S::JsonValue::String: return K::ExprValue::JsonQuote(v.str);
            case S::JsonValue::Array:
            {
                std::string out = "[";
                for (size_t i = 0; i < v.arr.size(); ++i) out += (i ? "," : "") + Canon(v.arr[i]);
                return out + "]";
            }
            case S::JsonValue::Object:
            {
                std::map<std::string, std::string> sorted;
                for (const auto& kv : v.obj) sorted[kv.first] = Canon(kv.second);
                std::string out = "{";
                bool first = true;
                for (const auto& kv : sorted) { out += (first ? "" : ",") + K::ExprValue::JsonQuote(kv.first) + ":" + kv.second; first = false; }
                return out + "}";
            }
        }
        return "?";
    }

    void Same(const S::JsonValue* actual, const std::string& expectedJson, const std::string& what)
    {
        const std::string want = Canon(Parse(expectedJson));
        const std::string got = actual ? Canon(*actual) : std::string("nothing");
        if (got != want) throw Failed(what + ": expected " + want + ", got " + got);
    }

    std::vector<std::string> SortedKeys(const S::JsonValue& o)
    {
        std::vector<std::string> keys;
        for (const auto& kv : o.obj) keys.push_back(kv.first);
        std::sort(keys.begin(), keys.end());
        return keys;
    }

    std::string Joined(const std::vector<std::string>& v)
    {
        std::string out;
        for (const auto& s : v) out += (out.empty() ? "" : ",") + s;
        return out;
    }

    // --- the Storylet Engine's content ----------------------------------------------
    //
    // The JS test's storyletBundle(), expanded exactly as the conformance package's
    // expandBundle writes it (the scaffold's box, zone tags and hand included), written
    // out by running the JS test's own storyletBundle() from source. The newer build
    // (extraStory) adds a @story property, rumours. Its third card, patron, names
    // Patter's scope directly: gated on @patter.visits, it adds ten to it.

    const char* kStoryletBundle = R"JSON({"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[{"name":"alarm","type":"number","default":0}]},"story":{"properties":[{"name":"act","type":"number","default":1}]},"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],"decks":[{"id":"k_main","gameId":"main","properties":[],"cards":[{"id":"c_heist","gameId":"heist","priority":0,"redraw":"never","outcomes":[{"id":"o_go","gameId":"go","changes":{"@story.act":{"src":"@story.act + 1","ast":["bin","+",["sv","story","act"],["n",1]]},"@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]},{"id":"c_manhunt","gameId":"manhunt","condition":{"src":"@world.alarm >= 10","ast":["bin",">=",["sv","world","alarm"],["n",10]]},"priority":0,"redraw":"always","outcomes":[{"id":"o_run","gameId":"run","changes":{}}]},{"id":"c_patron","gameId":"patron","condition":{"src":"@patter.visits >= 1","ast":["bin",">=",["sv","patter","visits"],["n",1]]},"priority":0,"redraw":"always","outcomes":[{"id":"o_tip","gameId":"tip","changes":{"@patter.visits":{"src":"@patter.visits + 10","ast":["bin","+",["sv","patter","visits"],["n",10]]}}}]}]}],"handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]})JSON";

    S::BundlePtr StoryletBundle(bool extraStory = false)
    {
        std::string json = kStoryletBundle;
        if (extraStory)
        {
            const std::string act = R"({"name":"act","type":"number","default":1})";
            json.replace(json.find(act), act.size(), act + R"(,{"name":"rumours","type":"number","default":0})");
        }
        return S::ParseBundle(Parse(json));
    }

    // --- Patter's content, compiled against the Storylet Engine's published scopes ---
    //
    // The JS test's patterBundle(line), as Patter's exportBundle writes it (again from
    // the JS test's own function): the guard's snippet waits for @story.act >= 2 and,
    // on exit, raises @world.alarm by ten and counts a visit. Only the line's text
    // changes between the builds, so the structure hash is one and the build hash is
    // the compiler's for each text. The compiler records @story, another engine's
    // scope, in externalScopes.

    const char* kPatterBundle = R"JSON({"schema":"patter/bundle@0","content":{"project":"p","hash":"HASH","structureHash":"0zmhmuj"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"GUARD"}],"properties":[{"name":"visits","type":"number","default":0,"shared":true}],"scenes":{"gate":{"id":"gate","type":"scene","name":"Gate","gameId":"gate","blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"shout","type":"snippet","condition":{"src":"@story.act >= 2","ast":["bin",">=",["sv","story","act"],["n",2]]},"beats":[{"id":"L","kind":"line","character":"GUARD"}],"onExit":[{"kind":"set","target":"@world.alarm","value":{"src":"@world.alarm + 10","ast":["bin","+",["sv","world","alarm"],["n",10]]}},{"kind":"set","target":"@visits","value":{"src":"@visits + 1","ast":["bin","+",["sv","patter","visits"],["n",1]]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"LINE"}},"externalScopes":["story"]})JSON";

    const std::map<std::string, std::string> kLineHashes = {
        {"Thief!", "1q2dsxn"}, {"Stop, thief!", "1d8lt0v"}, {"Halt!", "04hkhhs"},
    };

    // Patterplay's C++ core has no JSON reader of its own (its Unreal loader reads
    // FJsonValue, its TestHost a private tree), so this reads its bundle from the same
    // neutral tree, as Patterplay's TestHost reads it, field for field.

    std::vector<std::string> StrList(const S::JsonValue& a)
    {
        std::vector<std::string> out;
        for (const auto& x : a.arr) out.push_back(x.str);
        return out;
    }

    P::PatterValue PatterValueOf(const S::JsonValue& e)
    {
        switch (e.type)
        {
            case S::JsonValue::Bool: return P::PatterValue::Bool(e.b);
            case S::JsonValue::Number: return P::PatterValue::Num(e.num);
            case S::JsonValue::String: return P::PatterValue::Str(e.str);
            case S::JsonValue::Array: return P::PatterValue::Flags(StrList(e));
            default: throw std::runtime_error("unsupported value kind");
        }
    }

    P::Expression PatterExpr(const S::JsonValue& e)
    {
        P::Expression x;
        x.ast = P::DeserialiseAstFrom<S::JsonValue>(e.at("ast"));
        return x;
    }

    std::vector<P::Effect> PatterEffects(const S::JsonValue& e)
    {
        std::vector<P::Effect> out;
        for (const auto& x : e.arr) { P::Effect ef; ef.target = x.at("target").str; ef.value = PatterExpr(x.at("value")); out.push_back(ef); }
        return out;
    }

    P::PropertyDecl PatterProp(const S::JsonValue& p)
    {
        P::PropertyDecl d;
        d.name = p.at("name").str; d.type = p.at("type").str;
        if (const auto* sh = p.find("shared")) { d.hasShared = true; d.shared = sh->b; }
        if (const auto* tp = p.find("temporary")) d.temporary = tp->b;
        if (const auto* df = p.find("default")) { d.hasDefault = true; d.def = PatterValueOf(*df); }
        if (const auto* vs = p.find("values")) d.values = StrList(*vs);
        if (const auto* st = p.find("stages")) d.stages = StrList(*st);
        return d;
    }

    P::Beat PatterBeat(const S::JsonValue& b)
    {
        P::Beat beat;
        beat.id = b.at("id").str; beat.kind = b.at("kind").str;
        if (const auto* c = b.find("character")) beat.character = c->str;
        if (const auto* dr = b.find("direction")) beat.direction = dr->str;
        if (const auto* tg = b.find("tags")) beat.tags = StrList(*tg);
        return beat;
    }

    P::NodePtr PatterNode(const S::JsonValue& n)
    {
        auto node = std::make_shared<P::Node>();
        node->id = n.at("id").str; node->type = n.at("type").str;
        if (const auto* c = n.find("condition")) node->condition = std::make_shared<P::Expression>(PatterExpr(*c));
        if (const auto* oe = n.find("onEnter")) node->onEnter = PatterEffects(*oe);
        if (const auto* ox = n.find("onExit")) node->onExit = PatterEffects(*ox);
        if (const auto* tg = n.find("tags")) node->tags = StrList(*tg);
        if (node->isGroup())
        {
            if (const auto* sel = n.find("selector")) node->selector = sel->str;
            if (const auto* ch = n.find("children")) for (const auto& c : ch->arr) node->children.push_back(PatterNode(c));
        }
        else
        {
            if (const auto* bts = n.find("beats")) for (const auto& bt : bts->arr) node->beats.push_back(PatterBeat(bt));
            if (const auto* jp = n.find("jump")) { node->jump = std::make_shared<P::Jump>(); node->jump->to = jp->at("to").str; }
        }
        return node;
    }

    /** Patter bundles are held for the life of the program: a patter::Engine keeps a
     *  pointer to the bundle it was built from. */
    const P::Bundle& PatterBundle(const std::string& line = "Thief!")
    {
        static std::map<std::string, std::unique_ptr<P::Bundle>> built;
        auto found = built.find(line);
        if (found != built.end()) return *found->second;
        std::string json = kPatterBundle;
        json.replace(json.find("HASH"), 4, kLineHashes.at(line));
        json.replace(json.find("LINE"), 4, line);
        const S::JsonValue b = Parse(json);
        auto bundle = std::make_unique<P::Bundle>();
        bundle->schema = b.at("schema").str;
        bundle->voiced = b.at("voiced").b;
        bundle->contentHash = b.at("content").at("hash").str;
        bundle->structureHash = b.at("content").at("structureHash").str;
        bundle->contentProject = b.at("content").at("project").str;
        bundle->locales.defaultLocale = b.at("locales").at("default").str;
        bundle->locales.included = StrList(b.at("locales").at("included"));
        for (const auto& c : b.at("cast").arr) { P::Cast cast; cast.name = c.at("name").str; bundle->cast.push_back(cast); }
        for (const auto& p : b.at("properties").arr) bundle->properties.push_back(PatterProp(p));
        for (const auto& loc : b.at("strings").obj) for (const auto& kv : loc.second.obj) bundle->strings[loc.first][kv.first] = kv.second.str;
        if (const auto* ext = b.find("externalScopes")) bundle->externalScopes = StrList(*ext);
        for (const auto& sc : b.at("scenes").obj)
        {
            P::Scene scene;
            scene.id = sc.second.at("id").str; scene.name = sc.second.at("name").str; scene.gameId = sc.second.at("gameId").str;
            for (const auto& blk : sc.second.at("blocks").arr)
            {
                P::Block block;
                block.id = blk.at("id").str; block.name = blk.at("name").str;
                for (const auto& c : blk.at("children").arr) block.children.push_back(PatterNode(c));
                scene.blocks.push_back(std::move(block));
            }
            bundle->scenes[sc.first] = std::move(scene);
        }
        return *built.emplace(line, std::move(bundle)).first->second;
    }

    // --- the game ----------------------------------------------------------------------

    struct Game
    {
        std::shared_ptr<K::ScopeRegistry> registry;
        std::unique_ptr<S::Engine> storylets;
        std::unique_ptr<P::Engine> patter;
    };

    /** One registry for the game. @world is the game's, stored by the registry; both
     *  engines read it. The SAME object goes to both engines. */
    Game CombinedGame(S::BundlePtr storyletBundle = nullptr, const std::string& patterLine = "Thief!")
    {
        Game g;
        g.registry = std::make_shared<K::ScopeRegistry>();
        K::ScopeDeclaration alarm;
        alarm.name = "alarm"; alarm.type = K::PropertyTypes::Number; alarm.defaultValue = K::ExprValue::Num(0);
        K::OwnedScopeOptions world; world.owner = std::string("Game");
        g.registry->defineOwned("world", {alarm}, world);

        S::EngineOptions so;
        so.seed = 3;
        if (g_probe == Probe::TwoRegistries)
        {
            // The mistake: the Storylet Engine on a registry of its own, holding its own @world.
            so.registry = std::make_shared<K::ScopeRegistry>();
            so.registry->defineOwned("world", {alarm}, world);
        }
        else if (g_probe != Probe::EnginesSaveValues) so.registry = g.registry;
        g.storylets = std::make_unique<S::Engine>(storyletBundle ? storyletBundle : StoryletBundle(), so);

        P::EngineOptions po;
        po.hasSeed = true; po.seed = 3;
        if (g_probe != Probe::EnginesSaveValues) po.registry = g.registry;
        else
        {
            // The mistake: both standalone, each keeping (and saving) its own values. The
            // game's registry is left holding @world alone.
        }
        g.patter = std::make_unique<P::Engine>(PatterBundle(patterLine), po);
        return g;
    }

    void Heist(S::Flow& flow)
    {
        const std::vector<S::DealtCard> dealt = flow.deal("q");
        const auto card = std::find_if(dealt.begin(), dealt.end(), [](const S::DealtCard& c) { return c.gameId == "heist"; });
        Check(card != dealt.end(), "the heist is dealt");
        flow.play(card->gameId, "go", "q");
    }

    /** Play the first part: a heist moves the story to act two, then the Patter guard shouts. */
    void PlayFirstPart(Game& g)
    {
        P::Flow* guard = g.patter->openFlow("guard", "gate");
        End(guard->advance(), "act 1: the gate stays quiet");
        Heist(*g.storylets->openFlow("thief"));
        P::Flow* again = g.patter->openFlow("guard", "gate");
        const P::StepResult step = again->advance();
        Check(step.type == P::StepType::Line && step.character == "GUARD", "act 2: the guard shouts (got " + Describe(step) + ")");
        g.patter->openFlow("watch", "gate");   // a second Patter flow, mid-scene
    }

    std::vector<std::string> Dealt(S::Flow& flow)
    {
        std::vector<std::string> out;
        for (const auto& c : flow.deal("q")) out.push_back(c.gameId);
        return out;
    }

    bool Has(const std::vector<std::string>& v, const std::string& s) { return std::find(v.begin(), v.end(), s) != v.end(); }

    // --- the one save, and the pass's registry helpers -----------------------------------

    /** Which plugin's helpers the game writes and reads its registry through, this pass. */
    struct Saver
    {
        std::string name;
        std::function<std::string(const K::ScopeRegistry&)> save;
        std::function<void(K::ScopeRegistry&, const std::string&)> load;
    };

    const Saver kThroughPatter{"Patterplay's patter::saveRegistry",
        [](const K::ScopeRegistry& r) { return P::saveRegistry(r); },
        [](K::ScopeRegistry& r, const std::string& json) { P::loadRegistry(r, json); }};

    const Saver kThroughStorylets{"the Storylet Engine's storylets::saveRegistry",
        [](const K::ScopeRegistry& r) { return S::saveRegistry(r); },
        [](K::ScopeRegistry& r, const std::string& json) { S::loadRegistry(r, json); }};

    const Saver* g_saver = &kThroughPatter;

    /** The game's one save, as one text a save file would hold: the registry's values
     *  once, and each engine's part. */
    std::string SaveAll(Game& g)
    {
        return "{\"registry\":" + g_saver->save(*g.registry)
            + ",\"patter\":" + P::serializeState(*g.patter)
            + ",\"storylets\":" + S::serializeState(*g.storylets) + "}";
    }

    std::string Section(const S::JsonValue& save, const std::string& key)
    {
        // The text back out of the tree, for the engines' own text loaders.
        std::function<std::string(const S::JsonValue&)> text = [&](const S::JsonValue& v) -> std::string
        {
            switch (v.type)
            {
                case S::JsonValue::Null: return "null";
                case S::JsonValue::Bool: return v.b ? "true" : "false";
                case S::JsonValue::Number: return K::ExprValue::JsNumber(v.num);
                case S::JsonValue::String: return K::ExprValue::JsonQuote(v.str);
                case S::JsonValue::Array:
                {
                    std::string out = "[";
                    for (size_t i = 0; i < v.arr.size(); ++i) out += (i ? "," : "") + text(v.arr[i]);
                    return out + "]";
                }
                case S::JsonValue::Object:
                {
                    std::string out = "{";
                    for (size_t i = 0; i < v.obj.size(); ++i) out += (i ? "," : "") + K::ExprValue::JsonQuote(v.obj[i].first) + ":" + text(v.obj[i].second);
                    return out + "}";
                }
            }
            return "null";
        };
        return text(save.at(key));
    }

    void LoadRegistry(Game& g, const S::JsonValue& save)
    {
        if (g_probe == Probe::NoRegistryLoad) return;   // the mistake: the game never loads it
        g_saver->load(*g.registry, Section(save, "registry"));
    }

    void LoadPatter(Game& g, const S::JsonValue& save) { P::deserializeState(*g.patter, Section(save, "patter")); }

    void LoadStorylets(Game& g, const S::JsonValue& save) { S::deserializeState(*g.storylets, Section(save, "storylets")); }

    // --- the cases -----------------------------------------------------------------------

    void EachReadsTheOther()
    {
        Game g = CombinedGame();
        PlayFirstPart(g);
        End(g.patter->getFlow("guard")->advance(), "onExit: alarm +10, visits +1");
        Num(g.registry->get("world", "alarm"), 11, "1 from the heist, 10 from the guard");
        Num(g.patter->getProperty("@story.act"), 2, "Patter reads the Storylet Engine's scope");
        Num(g.storylets->getProperty("patter.visits"), 1, "and the Storylet Engine reads Patter's");
        const std::vector<std::string> dealt = Dealt(*g.storylets->getFlow("thief"));
        Check(Has(dealt, "manhunt"), "the storylet gated on Patter's write is dealt now: " + Joined(dealt));
    }

    void SavesOnce()
    {
        Game g = CombinedGame();
        PlayFirstPart(g);
        g.patter->getFlow("guard")->advance();
        const S::JsonValue save = Parse(SaveAll(g));
        const S::JsonValue& registry = save.at("registry");
        Same(registry.find("world"), R"({ "alarm": 11 })", "save.registry.world");
        Same(registry.find("story"), R"({ "act": 2 })", "save.registry.story");
        Same(registry.find("patter"), R"({ "visits": 1 })", "save.registry.patter");
        // Patter's part is its envelope, { schema, save }: the registry would sit in `save`.
        const S::JsonValue& patter = save.at("patter");
        Check(!patter.has("registry") && patter.has("save") && !patter.at("save").has("registry"),
            "Patter's save holds a registry: " + Canon(patter));
        // The Storylet Engine's part is its save file, { schema, engine }: the registry would sit in `engine`.
        const S::JsonValue& storylets = save.at("storylets");
        Check(!storylets.has("registry") && storylets.has("engine") && !storylets.at("engine").has("registry"),
            "the Storylet Engine's save holds a registry: " + Canon(storylets));
        Same(storylets.at("engine").find("shared"), R"({ "spent": [] })", "save.storylets.shared");
        // The owner label groups one examiner's rows by engine.
        std::set<std::string> owners;
        for (const auto& row : g.registry->listProperties()) owners.insert(row.owner.value_or("<none>"));
        Check(owners == std::set<std::string>{"Game", "Patter", "Storylet Engine"},
            "the owner labels: " + Joined(std::vector<std::string>(owners.begin(), owners.end())));
    }

    void Resumes(bool registryFirst)
    {
        Game g1 = CombinedGame();
        PlayFirstPart(g1);
        const std::string text = SaveAll(g1);
        const S::JsonValue save = Parse(text);

        Game g2 = CombinedGame();
        if (registryFirst) LoadRegistry(g2, save);
        LoadPatter(g2, save);
        LoadStorylets(g2, save);
        if (!registryFirst) LoadRegistry(g2, save);

        Num(g2.registry->get("story", "act"), 2, "story.act");
        Num(g2.registry->get("world", "alarm"), 1, "world.alarm");
        // Patter resumes the guard mid-line: the exit writes land on the restored world.
        P::Flow* guard = g2.patter->getFlow("guard");
        Check(guard != nullptr, "the guard's flow resumed");
        End(guard->advance(), "the guard ends");
        Num(g2.registry->get("world", "alarm"), 11, "world.alarm after the guard");
        // The Storylet Engine's spent heist stayed spent; the manhunt is open.
        S::FlowPtr thief = g2.storylets->getFlow("thief");
        Check(thief != nullptr, "the thief's flow resumed");
        const std::vector<std::string> dealt = Dealt(*thief);
        Check(Has(dealt, "manhunt"), "the manhunt is open: " + Joined(dealt));
        Check(!Has(dealt, "heist"), "the heist stayed spent: " + Joined(dealt));
        // And a second save of the resumed game carries the same shape.
        const std::vector<std::string> keys = SortedKeys(save.at("registry"));
        const std::vector<std::string> again = SortedKeys(Parse(SaveAll(g2)).at("registry"));
        Check(again == keys, "a second save's registry keys: " + Joined(again) + ", expected " + Joined(keys));
    }

    void DriftAndHotSwap()
    {
        Game g1 = CombinedGame();
        PlayFirstPart(g1);
        const S::JsonValue save = Parse(SaveAll(g1));

        // A newer build: the Storylet Engine declares a new @story property, Patter rewords a line.
        Game g2 = CombinedGame(StoryletBundle(true), "Stop, thief!");
        LoadRegistry(g2, save);
        LoadPatter(g2, save);
        LoadStorylets(g2, save);
        Num(g2.storylets->getProperty("story.rumours"), 0, "new: its default");
        Num(g2.storylets->getProperty("story.act"), 2, "known: restored");

        End(g2.patter->getFlow("guard")->advance(), "the guard ends (visits 0 -> 1, alarm 1 -> 11)");

        // A live Patter edit mid-game: its bags are handed over on the same registry.
        std::unique_ptr<P::Engine> swapped;
        if (g_probe == Probe::FreshSwap)
        {
            // The mistake: a new engine instead of a swap. It cannot even register (the old
            // one still holds @patter), so drop the old one first, as a game doing this would.
            g2.patter.reset();
            P::EngineOptions po; po.hasSeed = true; po.seed = 3; po.registry = g2.registry;
            swapped = std::make_unique<P::Engine>(PatterBundle("Halt!"), po);
        }
        else
        {
            swapped = g2.patter->hotSwap(PatterBundle("Halt!"));
            g2.patter.reset();   // the old engine goes; it released its bags to the replacement
        }
        Num(swapped->getProperty("@visits"), 1, "Patter's own value, carried over");
        Num(swapped->getProperty("@story.act"), 2, "@story.act after the swap");
        P::Flow* watch = swapped->getFlow("watch");
        Check(watch != nullptr, "the watch's flow survived the swap");
        const P::StepResult step = watch->advance();
        Check(step.type == P::StepType::Line && step.text == "Halt!", "the watch speaks the new line (got " + Describe(step) + ")");
        End(watch->advance(), "then ends");
        Num(swapped->getProperty("@visits"), 2, "@visits after the watch");
        Num(g2.registry->get("world", "alarm"), 21, "world.alarm after the watch");
        Num(g2.storylets->getProperty("story.act"), 2, "the other engine never noticed");
    }

    void TokenClash()
    {
        auto registry = std::make_shared<K::ScopeRegistry>();
        auto second = [&registry]() { return g_probe == Probe::NoClash ? std::make_shared<K::ScopeRegistry>() : registry; };
        S::EngineOptions so; so.registry = registry;
        S::Engine storylets(StoryletBundle(), so);
        const std::string before = g_saver->save(*registry);
        ThrowsExactly([&] { S::EngineOptions again; again.registry = second(); S::Engine twice(StoryletBundle(), again); },
            "storylets::StoryletError", "scope '@story' is already registered by Storylet Engine", "a second Storylet Engine");
        Check(g_saver->save(*registry) == before, "the refused engine left the registry changed");
        P::EngineOptions po; po.registry = registry;
        P::Engine patter(PatterBundle(), po);
        ThrowsExactly([&] { P::EngineOptions again; again.registry = second(); P::Engine twice(PatterBundle(), again); },
            "patter::EvalError", "scope '@patter' is already registered by Patter", "a second Patter");
    }

    /** Not in the JS test, which has one registry saver: a game running both plugins may
     *  write its registry through either and read it through the other. */
    void CrossedSavers()
    {
        Game g1 = CombinedGame();
        PlayFirstPart(g1);
        const std::string byPatter = P::saveRegistry(*g1.registry);
        const std::string byStorylets = S::saveRegistry(*g1.registry);
        Check(Canon(Parse(byPatter)) == Canon(Parse(byStorylets)), "the two helpers wrote different JSON: " + byPatter + " / " + byStorylets);
        struct Pass { const Saver* write; const Saver* read; const char* label; };
        for (const Pass& pass : {Pass{&kThroughPatter, &kThroughStorylets, "written by Patterplay, read by the Storylet Engine"},
                                 Pass{&kThroughStorylets, &kThroughPatter, "written by the Storylet Engine, read by Patterplay"}})
        {
            const std::string text = pass.write->save(*g1.registry);
            Game g2 = CombinedGame();
            if (g_probe != Probe::NoRegistryLoad) pass.read->load(*g2.registry, text);
            Num(g2.registry->get("story", "act"), 2, std::string(pass.label) + ": story.act");
            Num(g2.registry->get("world", "alarm"), 1, std::string(pass.label) + ": world.alarm");
            Num(g2.patter->getProperty("@story.act"), 2, std::string(pass.label) + ": Patter reads it");
        }
    }

    /** A card names @patter directly, and the Storylet Engine hot-swaps on the
     *  registry Patter shares. */
    void PatronAndStoryletHotSwap()
    {
        Game g = CombinedGame();
        PlayFirstPart(g);
        Check(g.patter->getFlow("guard") != nullptr, "the guard's flow is open");
        S::FlowPtr thief = g.storylets->getFlow("thief");
        Check(!Has(Dealt(*thief), "patron"), "visits 0: the patron is not dealt yet");
        End(g.patter->getFlow("guard")->advance(), "the guard's exit: visits 1");
        Check(Has(Dealt(*thief), "patron"), "visits 1: the patron is dealt: " + Joined(Dealt(*thief)));
        thief->play("patron", "tip", "q");
        Num(g.patter->getProperty("@visits"), 11, "a storylet wrote Patter's value");

        // A live Storylets edit mid-game, on the registry Patter shares.
        std::unique_ptr<S::Engine> swapped;
        S::LoadReport report;
        if (g_probe == Probe::FreshSwap)
        {
            // The mistake: a new engine instead of a swap. It cannot even register (the old
            // one still holds @story), so drop the old one first, as a game doing this would.
            const S::SaveEnvelope save = g.storylets->saveGame();
            g.storylets.reset();
            S::EngineOptions so; so.seed = 3; so.registry = g.registry;
            swapped = std::make_unique<S::Engine>(StoryletBundle(true), so);
            report = swapped->loadGame(save);
        }
        else
        {
            S::Engine::HotSwapResult swap = g.storylets->hotSwap(StoryletBundle(true));
            swapped = std::move(swap.engine);
            report = swap.report;
            g.storylets.reset();   // the spent engine goes, and takes nothing of the replacement's with it
        }
        std::string defaulted;
        for (const auto& p : report.defaultedProperties) defaulted += "[" + p.flow + "|" + p.path + "]";
        Check(defaulted == "[|story.rumours]", "the report's defaulted properties: " + defaulted);
        Num(swapped->getProperty("story.act"), 2, "story.act, carried over");
        Num(swapped->getProperty("story.rumours"), 0, "story.rumours, its default");
        Num(g.patter->getProperty("@story.act"), 2, "Patter reads the replacement's @story");
        Num(g.registry->get("patter", "visits"), 11, "and its own values stand");
    }

    struct Case { const char* name; std::function<void()> run; };

    const std::vector<Case> kCases = {
        {"each engine reads the other's writes through the one registry", EachReadsTheOther},
        {"saves every property once, in the registry; neither engine's save holds one", SavesOnce},
        {"resumes both engines from the one save, registry first", [] { Resumes(true); }},
        {"resumes both engines from the one save, engines first", [] { Resumes(false); }},
        {"loads across content drift in both engines, and Patter hot-swaps without disturbing the other", DriftAndHotSwap},
        {"a card names @patter directly, and the Storylet Engine hot-swaps on the shared registry", PatronAndStoryletHotSwap},
        {"a token clash fails as the game combines its engines, naming who holds it", TokenClash},
    };
}

int main(int argc, char** argv)
{
    if (argc > 1) g_probe = ProbeNamed(argv[1]);
    int passed = 0, total = 0;
    std::vector<std::string> failures;
    auto one = [&](const std::string& label, const std::function<void()>& body)
    {
        ++total;
        std::string failure;
        try { body(); }
        catch (const Failed& e) { failure = e.what(); }
        catch (const std::exception& e) { failure = std::string("threw: ") + e.what(); }
        if (failure.empty())
        {
            ++passed;
            std::cout << "  ok   " << label << "\n";
        }
        else
        {
            failures.push_back(label + ": " + failure);
            std::cout << "  FAIL " << label << "\n         " << failure << "\n";
        }
    };
    std::cout << "one kernel: patter::ScopeRegistry and storylets::ScopeRegistry are one type ("
              << typeid(K::ScopeRegistry).name() << ")\n";
    for (const Saver* saver : {&kThroughPatter, &kThroughStorylets})
    {
        g_saver = saver;
        std::cout << "-- the registry saved through " << saver->name << "\n";
        for (const Case& c : kCases) one(c.name, c.run);
    }
    std::cout << "-- either plugin's registry helpers\n";
    one("a registry written through either plugin reads back through the other", CrossedSavers);
    std::cout << "combined game (Patterplay + the Storylet Engine, one registry): " << passed << "/" << total << "\n";
    std::cout << (failures.empty() ? "ALL PASS" : std::to_string(failures.size()) + " FAILED") << "\n";
    return failures.empty() ? 0 : 1;
}
