// The save-file string boundary for the C++ core: the .storyletsave FILE
// (storylets/savefile@1 - the HOST's wrapper: the engine's envelope plus, when
// the host keeps one, its @world container; design/flows.md). The envelope is
// storylets/save@2, written in the TypeScript reference's key order (schema,
// content, registry when the engine owns its registry, shared, flows);
// storylets/save@1 envelopes still read.
//
// Pure std, self-sufficient, and PUBLIC - the parity member every runtime
// carries under the same two names (serializeState / deserializeState; JS
// play-helpers, Unity StoryletSave, Godot StoryletSave, and Patter's own
// Patter/Save.h). It used to live UE-side under different names, which meant
// the clang TestHost never exercised it and two faults in it reached an
// Unreal build before anything noticed.
//
// A host with its own JSON parser (the UE plugin has FJsonObject) may parse
// to a JsonValue itself and call the tree overloads; nothing here is
// mandatory.
#pragma once

#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

#include "Storylets/Bundle.h"
#include "Storylets/Engine.h"
#include "Storylets/JsonParse.h"
#include "Storylets/JsonValue.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    namespace savedetail
    {
            // --- writing (the TS SaveEnvelope wire shape, 2-space pretty print) -----

            inline void Indent(std::string& Out, int Depth)
            {
                Out.append(static_cast<size_t>(Depth) * 2, ' ');
            }

            /** JSON.stringify-parity number token (integral doubles without a decimal
             *  point; the shortest round-tripping form otherwise). */
            inline std::string NumToken(double N) { return StoryletValue::JsNumber(N); }

            inline std::string ValueToken(const StoryletValue& V) { return V.toJsonString(); }

            inline void WriteBag(std::string& Out, const OrderedMap<std::string, StoryletValue>& Bag, int Depth)
            {
                if (Bag.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Bag)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": " + ValueToken(Pair.second);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteKind(std::string& Out,
                const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>& Kind, int Depth)
            {
                if (Kind.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Kind)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": ";
                    WriteBag(Out, Pair.second, Depth + 1);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteNumberMap(std::string& Out, const OrderedMap<std::string, double>& Map, int Depth)
            {
                if (Map.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Map)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": " + NumToken(Pair.second);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WritePartition(std::string& Out, const PropsPartition& P, int Depth)
            {
                Out += "{\n";
                Indent(Out, Depth + 1); Out += "\"story\": "; WriteBag(Out, P.story, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"box\": "; WriteKind(Out, P.box, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"deck\": "; WriteKind(Out, P.deck, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"hand\": "; WriteKind(Out, P.hand, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"value\": "; WriteKind(Out, P.value, Depth + 1); Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteFlow(std::string& Out, const FlowSave& F, int Depth)
            {
                Out += "{\n";
                // Only a parked flow (saveFlow) and a version 1 envelope carry
                // props; a version 2 envelope's flows leave them to the registry.
                if (F.props.has_value())
                {
                    Indent(Out, Depth + 1); Out += "\"props\": "; WritePartition(Out, *F.props, Depth + 1); Out += ",\n";
                }
                Indent(Out, Depth + 1); Out += "\"turns\": "; WriteNumberMap(Out, F.turns, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"prng\": " + NumToken(static_cast<double>(F.prng)) + ",\n";
                Indent(Out, Depth + 1); Out += "\"cooldowns\": "; WriteNumberMap(Out, F.cooldowns, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"board\": ";
                if (F.board.size() == 0)
                {
                    Out += "{}";
                }
                else
                {
                    Out += "{\n";
                    bool bFirst = true;
                    for (const auto& Pair : F.board)
                    {
                        if (!bFirst) Out += ",\n";
                        bFirst = false;
                        Indent(Out, Depth + 2);
                        Out += StoryletValue::JsonQuote(Pair.first) + ": [";
                        for (size_t i = 0; i < Pair.second.size(); ++i)
                        {
                            if (i > 0) Out += ", ";
                            Out += StoryletValue::JsonQuote(Pair.second[i]);
                        }
                        Out += "]";
                    }
                    Out += "\n";
                    Indent(Out, Depth + 1);
                    Out += "}";
                }
                Out += ",\n";
                Indent(Out, Depth + 1);
                Out += "\"playLog\": [";
                if (!F.playLog.empty())
                {
                    Out += "\n";
                    for (size_t i = 0; i < F.playLog.size(); ++i)
                    {
                        const PlayRecord& R = F.playLog[i];
                        Indent(Out, Depth + 2);
                        Out += "{ \"card\": " + StoryletValue::JsonQuote(R.card)
                            + ", \"outcome\": " + StoryletValue::JsonQuote(R.outcome)
                            + ", \"turn\": " + NumToken(R.turn) + " }";
                        Out += (i + 1 < F.playLog.size()) ? ",\n" : "\n";
                    }
                    Indent(Out, Depth + 1);
                }
                Out += "]\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline std::string EnvelopeToJson(const SaveEnvelope& Env, const OrderedMap<std::string, StoryletValue>& World)
            {
                // The .storyletsave FILE is the HOST's wrapper (storylets/savefile@1,
                // design/flows.md): the engine's envelope plus the host's @world
                // container, which a bound @world needs (the engine never saves
                // it) and a self-backed one carries twice, harmlessly: its values
                // ride the envelope's registry section too.
                std::string Out = "{\n";
                Indent(Out, 1);
                Out += "\"schema\": " + StoryletValue::JsonQuote(SAVEFILE_SCHEMA) + ",\n";
                Indent(Out, 1);
                Out += "\"engine\": {\n";
                Indent(Out, 2);
                Out += "\"schema\": " + StoryletValue::JsonQuote(Env.schema) + ",\n";
                Indent(Out, 2);
                Out += "\"content\": {\n";
                Indent(Out, 3);
                Out += "\"project\": " + StoryletValue::JsonQuote(Env.content.project) + ",\n";
                Indent(Out, 3);
                Out += "\"version\": " + StoryletValue::JsonQuote(Env.content.version) + ",\n";
                Indent(Out, 3);
                Out += "\"hash\": " + StoryletValue::JsonQuote(Env.content.hash) + "\n";
                Indent(Out, 2);
                Out += "},\n";
                if (Env.registry.has_value())
                {
                    // A standalone engine's registry values, keyed by registry key.
                    Indent(Out, 2);
                    Out += "\"registry\": ";
                    WriteKind(Out, *Env.registry, 2);
                    Out += ",\n";
                }
                Indent(Out, 2);
                Out += "\"shared\": {\n";
                if (Env.shared.props.has_value())
                {
                    Indent(Out, 3);
                    Out += "\"props\": ";
                    WritePartition(Out, *Env.shared.props, 3);
                    Out += ",\n";
                }
                Indent(Out, 3);
                Out += "\"spent\": [";
                for (size_t i = 0; i < Env.shared.spent.size(); ++i)
                {
                    if (i) Out += ", ";
                    Out += StoryletValue::JsonQuote(Env.shared.spent[i]);
                }
                Out += "]\n";
                Indent(Out, 2);
                Out += "},\n";
                Indent(Out, 2);
                Out += "\"flows\": ";
                if (Env.flows.size() == 0)
                {
                    Out += "{}";
                }
                else
                {
                    Out += "{\n";
                    bool bFirst = true;
                    for (const auto& Pair : Env.flows)
                    {
                        if (!bFirst) Out += ",\n";
                        bFirst = false;
                        Indent(Out, 3);
                        Out += StoryletValue::JsonQuote(Pair.first) + ": ";
                        WriteFlow(Out, Pair.second, 3);
                    }
                    Out += "\n";
                    Indent(Out, 2);
                    Out += "}";
                }
                Out += "\n";
                Indent(Out, 1);
                Out += "},\n";
                Indent(Out, 1);
                Out += "\"world\": ";
                WriteBag(Out, World, 1);
                Out += "\n}";
                return Out;
            }

            // --- reading (neutral JsonValue tree -> envelope) ------------------------

            inline OrderedMap<std::string, StoryletValue> ParseBag(const JsonValue* Token)
            {
                OrderedMap<std::string, StoryletValue> Bag;
                if (!Token || !Token->isObject()) return Bag;
                for (const auto& Pair : Token->obj)
                {
                    Bag.set(Pair.first, bundleloader::ToValue(Pair.second));
                }
                return Bag;
            }

            inline OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> ParseKind(const JsonValue* Token)
            {
                OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> Kind;
                if (!Token || !Token->isObject()) return Kind;
                for (const auto& Pair : Token->obj)
                {
                    Kind.set(Pair.first, ParseBag(&Pair.second));
                }
                return Kind;
            }

            inline PropsPartition PartitionFromTree(const JsonValue* Token)
            {
                PropsPartition P;
                if (!Token || !Token->isObject()) return P;
                P.story = ParseBag(Token->find("story"));
                P.box = ParseKind(Token->find("box"));
                P.deck = ParseKind(Token->find("deck"));
                P.hand = ParseKind(Token->find("hand"));
                P.value = ParseKind(Token->find("value"));
                return P;
            }

            inline FlowSave FlowFromTree(const JsonValue& Tree)
            {
                FlowSave F;
                // Absent from a version 2 envelope's flows: the registry has them.
                const JsonValue* Props = Tree.find("props");
                if (Props && Props->isObject()) F.props = PartitionFromTree(Props);
                const JsonValue* Turns = Tree.find("turns");
                if (Turns && Turns->isObject())
                {
                    for (const auto& Pair : Turns->obj) F.turns.set(Pair.first, Pair.second.num);
                }
                // JS ToUint32, never a bare cast: a hand-edited or foreign save
                // can carry a negative, fractional or out-of-range state, and
                // casting a double outside uint32's range is undefined.
                F.prng = Mulberry32::ToUint32(Tree.numOr("prng", 0));
                const JsonValue* Cooldowns = Tree.find("cooldowns");
                if (Cooldowns && Cooldowns->isObject())
                {
                    for (const auto& Pair : Cooldowns->obj) F.cooldowns.set(Pair.first, Pair.second.num);
                }
                const JsonValue* Board = Tree.find("board");
                if (Board && Board->isObject())
                {
                    for (const auto& Pair : Board->obj)
                    {
                        std::vector<std::string> Ids;
                        for (const auto& Id : Pair.second.arr) Ids.push_back(Id.str);
                        F.board.set(Pair.first, std::move(Ids));
                    }
                }
                const JsonValue* PlayLog = Tree.find("playLog");
                if (PlayLog && PlayLog->isArray())
                {
                    for (const auto& Item : PlayLog->arr)
                    {
                        PlayRecord Record;
                        Record.card = Item.strOr("card");
                        Record.outcome = Item.strOr("outcome");
                        Record.turn = Item.numOr("turn", 0);
                        F.playLog.push_back(std::move(Record));
                    }
                }
                return F;
            }

            inline SaveEnvelope EnvelopeFromTree(const JsonValue& Tree)
            {
                SaveEnvelope Env;
                Env.schema = Tree.strOr("schema");
                const JsonValue* Content = Tree.find("content");
                if (Content && Content->isObject())
                {
                    Env.content.project = Content->strOr("project");
                    Env.content.version = Content->strOr("version");
                    Env.content.hash = Content->strOr("hash");
                }
                const JsonValue* Registry = Tree.find("registry");
                if (Registry && Registry->isObject()) Env.registry = ParseKind(Registry);
                const JsonValue* Shared = Tree.find("shared");
                if (Shared && Shared->isObject())
                {
                    // Version 1 only: a version 2 envelope's shared half has no props.
                    const JsonValue* Props = Shared->find("props");
                    if (Props && Props->isObject()) Env.shared.props = PartitionFromTree(Props);
                    const JsonValue* Spent = Shared->find("spent");
                    if (Spent && Spent->isArray())
                    {
                        for (const auto& Id : Spent->arr) Env.shared.spent.push_back(Id.str);
                    }
                }
                const JsonValue* Flows = Tree.find("flows");
                if (Flows && Flows->isObject())
                {
                    for (const auto& Pair : Flows->obj)
                    {
                        Env.flows.set(Pair.first, FlowFromTree(Pair.second));
                    }
                }
                return Env;
            }
    }

    /** The engine's whole state (and the host's @world values, if it keeps
     *  any) as pretty-printed .storyletsave text. */
    inline std::string serializeState(
        const Engine& engine,
        const OrderedMap<std::string, StoryletValue>& world = {})
    {
        return savedetail::EnvelopeToJson(engine.saveGame(), world);
    }

    /** Restore an engine from a PARSED .storyletsave tree - the twin of
     *  deserializeState below, which does the same from text.
     *
     *  Patterplay's pairing, confirmed against `patter/Save.h` and its three
     *  siblings on 2026-08-29: saveState / loadState work on the parsed
     *  object, serializeState / deserializeState work on TEXT. This port
     *  already had the family shape; the JS reference did not, and was brought
     *  into line rather than the other way round.
     *
     *  Throws StoryletError on a foreign or malformed file, or a save for
     *  another project - before any mutation, so a refused load leaves the
     *  engine exactly as it was. The envelope may be storylets/save@2 or
     *  storylets/save@1. Returns the file's @world values for the HOST to
     *  apply: a bound @world is the game's, and the engine never carries it
     *  (design/flows.md).
     *
     *  `onReport`, when given, is handed the LoadReport loadGame returned (the
     *  JS loadState's `{ onReport }`): what the load cost, which the return
     *  value has no room for since it stays the @world values. */
    inline OrderedMap<std::string, StoryletValue> loadState(Engine& engine, const JsonValue& tree,
        const std::function<void(const LoadReport&)>& onReport = {})
    {
        const JsonValue* engineTree = tree.find("engine");
        const std::string envelopeSchema = engineTree && engineTree->isObject() ? engineTree->strOr("schema") : std::string();
        if (tree.strOr("schema") != SAVEFILE_SCHEMA
            || !engineTree || !engineTree->isObject()
            || (envelopeSchema != SAVE_SCHEMA && envelopeSchema != SAVE_SCHEMA_V1))
        {
            throw StoryletError(std::string("not a storylets save (expected schema \"") + SAVEFILE_SCHEMA + "\")");
        }
        const LoadReport report = engine.loadGame(savedetail::EnvelopeFromTree(*engineTree));
        if (onReport) onReport(report);
        const JsonValue* world = tree.find("world");
        return world && world->isObject() ? savedetail::ParseBag(world)
            : OrderedMap<std::string, StoryletValue>{};
    }

    /** ONE flow's blob as JSON, the shape the envelope carries per flow plus
     *  the flow's props, as saveFlow parks it (design/engine-server.md 4.1). The string boundary for
     *  a host that parks a visit: Blueprint has no FlowSave struct, and a
     *  parked visit is stored and shipped as text anyway. */
    inline std::string serializeFlow(const FlowSave& flow)
    {
        std::string out;
        savedetail::WriteFlow(out, flow, 0);
        return out;
    }

    /** The twin of serializeFlow: a parsed tree back to a blob. Tolerant in the
     *  same way the envelope reader is - a missing key is a default, because a
     *  blob parked under an older build is exactly the case this serves. */
    inline FlowSave flowFromTree(const JsonValue& tree)
    {
        return savedetail::FlowFromTree(tree);
    }

    /** Parse + restore a serializeFlow string. Throws StoryletError on
     *  malformed text, as deserializeState does. */
    inline FlowSave deserializeFlow(const std::string& json)
    {
        try
        {
            return savedetail::FlowFromTree(JsonParser(json).parse());
        }
        catch (const StoryletError&)
        {
            throw;
        }
        catch (const std::exception&)
        {
            throw StoryletError("not valid JSON");
        }
    }

    /** A DURABLE HALF as JSON (ruling H): the installation's memory from
     *  Engine::saveDurable or a player's pocket from Flow::saveDurable, in the
     *  reference's key names and order (schema, content, values, spent). The
     *  string boundary for a host that keeps a half between runs: Blueprint has
     *  no DurableSave struct, and a half is stored as text anyway. */
    inline std::string serializeDurable(const DurableSave& half)
    {
        std::string out = "{\n";
        savedetail::Indent(out, 1);
        out += "\"schema\": " + StoryletValue::JsonQuote(half.schema) + ",\n";
        savedetail::Indent(out, 1);
        out += "\"content\": {\n";
        savedetail::Indent(out, 2);
        out += "\"project\": " + StoryletValue::JsonQuote(half.content.project) + ",\n";
        savedetail::Indent(out, 2);
        out += "\"version\": " + StoryletValue::JsonQuote(half.content.version) + ",\n";
        savedetail::Indent(out, 2);
        out += "\"hash\": " + StoryletValue::JsonQuote(half.content.hash) + "\n";
        savedetail::Indent(out, 1);
        out += "},\n";
        savedetail::Indent(out, 1);
        out += "\"values\": ";
        if (half.unreadable.empty())
        {
            savedetail::WriteBag(out, half.values, 1);
        }
        else
        {
            // A half read from a hand-edited file goes back out with what it
            // could not read as null, so it still carries those addresses and
            // a load still reports them.
            out += "{\n";
            bool first = true;
            const auto entry = [&out, &first](const std::string& address, const std::string& token)
            {
                if (!first) out += ",\n";
                first = false;
                savedetail::Indent(out, 2);
                out += StoryletValue::JsonQuote(address) + ": " + token;
            };
            for (const auto& pair : half.values) entry(pair.first, savedetail::ValueToken(pair.second));
            for (const std::string& address : half.unreadable) entry(address, "null");
            out += "\n";
            savedetail::Indent(out, 1);
            out += "}";
        }
        out += ",\n";
        savedetail::Indent(out, 1);
        out += "\"spent\": [";
        for (size_t i = 0; i < half.spent.size(); ++i)
        {
            if (i) out += ", ";
            out += StoryletValue::JsonQuote(half.spent[i]);
        }
        out += "]\n}";
        return out;
    }

    namespace savedetail
    {
        /** A JSON token as JavaScript's String() prints it, absent as
         *  "undefined": the text the reference's durable refusals quote, so a
         *  half with no schema, or a non-string one, is refused in the same
         *  words everywhere. */
        inline std::string JsText(const JsonValue* token)
        {
            if (!token) return "undefined";
            switch (token->type)
            {
                case JsonValue::Null: return "null";
                case JsonValue::Bool: return token->b ? "true" : "false";
                case JsonValue::Number: return NumToken(token->num);
                case JsonValue::String: return token->str;
                case JsonValue::Array:
                {
                    // Array.prototype.join: a null item is empty.
                    std::string out;
                    for (size_t i = 0; i < token->arr.size(); ++i)
                    {
                        if (i) out += ",";
                        if (!token->arr[i].isNull()) out += JsText(&token->arr[i]);
                    }
                    return out;
                }
                default: return "[object Object]";
            }
        }

        /** A value a property can hold: a boolean, a number, a string, or an
         *  array of strings (flags). */
        inline bool IsReadableValue(const JsonValue& token)
        {
            if (token.isBool() || token.isNumber() || token.isString()) return true;
            if (!token.isArray()) return false;
            for (const auto& item : token.arr) if (!item.isString()) return false;
            return true;
        }
    }

    /** The twin of serializeDurable: a parsed tree back to a half. Takes what
     *  it is given and leaves the judging to the load: Engine::loadDurable and
     *  openFlow's `durable` refuse an unknown schema or another project's half
     *  before anything moves, quoting a missing or non-string schema or project
     *  as JS prints it ("undefined" when absent). A value no property can hold
     *  goes to `unreadable`, to be reported by the load, never into a bag. */
    inline DurableSave durableFromTree(const JsonValue& tree)
    {
        DurableSave half;
        const JsonValue* schema = tree.find("schema");
        half.schema = savedetail::JsText(schema);
        // Only a string is the tag: an array whose text happens to spell it
        // (["storylets/durable@1"]) is refused, as JS refuses it, with that text.
        if (schema && !schema->isString() && half.schema == DURABLE_SCHEMA) half.schema += " ";
        const JsonValue* content = tree.find("content");
        half.content.project = savedetail::JsText(content && content->isObject() ? content->find("project") : nullptr);
        if (content && content->isObject())
        {
            half.content.version = content->strOr("version");
            half.content.hash = content->strOr("hash");
        }
        const JsonValue* values = tree.find("values");
        if (values && values->isObject())
        {
            for (const auto& pair : values->obj)
            {
                if (savedetail::IsReadableValue(pair.second)) half.values.set(pair.first, bundleloader::ToValue(pair.second));
                else half.unreadable.push_back(pair.first);
            }
        }
        const JsonValue* spent = tree.find("spent");
        if (spent && spent->isArray())
        {
            for (const auto& id : spent->arr) half.spent.push_back(id.str);
        }
        return half;
    }

    /** Parse a serializeDurable string. Throws StoryletError on malformed
     *  text, as deserializeFlow does. */
    inline DurableSave deserializeDurable(const std::string& json)
    {
        try
        {
            return durableFromTree(JsonParser(json).parse());
        }
        catch (const StoryletError&)
        {
            throw;
        }
        catch (const std::exception&)
        {
            throw StoryletError("not valid JSON");
        }
    }

    /** A registry's values (ScopeRegistry::save()) as pretty-printed JSON,
     *  keyed by registry key, the shape a standalone envelope carries under
     *  `registry`. The game's half of a combined save: a game that passes its
     *  one registry to several engines saves it once with this, beside each
     *  engine's envelope. */
    inline std::string saveRegistry(const ScopeRegistry& registry)
    {
        std::string out;
        savedetail::WriteKind(out, registry.save(), 0);
        return out;
    }

    /** The twin of saveRegistry: lay a saveRegistry string over the registry
     *  (ScopeRegistry::load, a whole restore), before or after the engines
     *  load their envelopes. Values for keys nobody has registered yet wait
     *  for the bag that claims them. Throws StoryletError on malformed text or
     *  anything but an object of sections, leaving the registry untouched. */
    inline void loadRegistry(ScopeRegistry& registry, const std::string& json)
    {
        JsonValue tree;
        try
        {
            tree = JsonParser(json).parse();
        }
        catch (const std::exception&)
        {
            throw StoryletError("not valid JSON");
        }
        if (!tree.isObject()) throw StoryletError("not a registry save (expected an object of sections)");
        registry.load(savedetail::ParseKind(&tree));
    }

    /** A LoadReport as JSON (design/engine-server.md 4.9): the string face of
     *  the report, for a host whose boundary is text - the Unreal Blueprint
     *  wrapper, a console, a wire. Field order is the struct's, list order is
     *  the report's own, so two runtimes write the same bytes. */
    inline std::string reportToJson(const LoadReport& report)
    {
        const auto quote = [](const std::string& text) { return StoryletValue::JsonQuote(text); };
        const auto strings = [&quote](const std::vector<std::string>& list)
        {
            std::string out = "[";
            for (size_t i = 0; i < list.size(); ++i)
            {
                if (i) out += ", ";
                out += quote(list[i]);
            }
            return out + "]";
        };
        const auto properties = [&quote](const std::vector<LoadProperty>& list)
        {
            std::string out = "[";
            for (size_t i = 0; i < list.size(); ++i)
            {
                if (i) out += ", ";
                out += "{ ";
                if (!list[i].flow.empty()) out += "\"flow\": " + quote(list[i].flow) + ", ";
                out += "\"path\": " + quote(list[i].path) + " }";
            }
            return out + "]";
        };
        std::string out = "{\n";
        out += "  \"exact\": " + std::string(report.exact ? "true" : "false") + ",\n";
        out += "  \"project\": " + quote(report.project) + ",\n";
        out += "  \"version\": { \"saved\": " + quote(report.version.saved)
            + ", \"bundle\": " + quote(report.version.bundle) + " },\n";
        out += "  \"hash\": { \"saved\": " + quote(report.hash.saved)
            + ", \"bundle\": " + quote(report.hash.bundle) + " },\n";
        out += "  \"flows\": " + strings(report.flows) + ",\n";
        out += "  \"evicted\": [";
        for (size_t i = 0; i < report.evicted.size(); ++i)
        {
            if (i) out += ", ";
            const LoadEviction& e = report.evicted[i];
            out += "{ \"flow\": " + quote(e.flow) + ", \"hand\": " + quote(e.hand)
                + ", \"card\": " + quote(e.card) + ", \"reason\": " + quote(e.reason) + " }";
        }
        out += "],\n";
        out += "  \"droppedCooldowns\": [";
        for (size_t i = 0; i < report.droppedCooldowns.size(); ++i)
        {
            if (i) out += ", ";
            out += "{ \"flow\": " + quote(report.droppedCooldowns[i].flow)
                + ", \"card\": " + quote(report.droppedCooldowns[i].card) + " }";
        }
        out += "],\n";
        out += "  \"droppedSpent\": " + strings(report.droppedSpent) + ",\n";
        out += "  \"droppedProperties\": " + properties(report.droppedProperties) + ",\n";
        out += "  \"defaultedProperties\": " + properties(report.defaultedProperties) + ",\n";
        out += "  \"retypedProperties\": " + properties(report.retypedProperties) + "\n";
        out += "}";
        return out;
    }

    /** Parse + restore .storyletsave TEXT: the text twin of loadState. Throws
     *  StoryletError on malformed text, exactly as loadState does on a
     *  malformed file. `onReport` is loadState's. */
    inline OrderedMap<std::string, StoryletValue> deserializeState(Engine& engine, const std::string& json,
        const std::function<void(const LoadReport&)>& onReport = {})
    {
        JsonValue tree;
        try
        {
            tree = JsonParser(json).parse();
        }
        catch (const std::exception&)
        {
            throw StoryletError("not valid JSON");
        }
        return loadState(engine, tree, onReport);
    }
}
