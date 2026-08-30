// Save-file plumbing over the .storyletsave file (storylets/savefile@1): the
// HOST's file - the engine's envelope (storylets/save@1, shared partitions +
// every flow) plus, when the host keeps one, its @world container. Mirrors
// @storylet-studio/play-helpers' save.ts: "host saves its container once,
// each engine saves its own envelope" (design/flows.md) folded into one file
// for the single-host case. These helpers are the string boundary - a
// foreign or malformed blob throws rather than corrupting a run. Pure (no
// UnityEngine), so the dotnet TestHost compiles and exercises this layer too.

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>A parsed .storyletsave file: the engine's envelope plus the
    /// host's @world values (null when the file carries none). The ENGINE
    /// never reads or writes World - the host applies it to its container.</summary>
    public sealed class SaveFile
    {
        public SaveEnvelope Engine;
        public OrderedMap<string, StoryletValue> World;
    }

    public static class StoryletSave
    {
        /// <summary>The current engine state (and the host's @world values, if
        /// given) as pretty-printed .storyletsave JSON.</summary>
        public static string SerializeState(Engine engine, OrderedMap<string, StoryletValue> world = null)
        {
            var file = new JObject
            {
                ["schema"] = Model.SAVEFILE_SCHEMA,
                ["engine"] = ToJson(engine.SaveGame()),
            };
            if (world != null) file["world"] = BagToken(world);
            return file.ToString(Formatting.Indented);
        }

        /// <summary>Capture the whole engine (and the host's @world values, if
        /// given) as the tagged save-file OBJECT.
        ///
        /// Four verbs, in Patterplay's pairing (patter play-helpers save.ts and
        /// all four of its runtimes): SaveState / LoadState work on the PARSED
        /// object, SerializeState / DeserializeState on TEXT. This port matched
        /// the JS reference, and the reference did not match the family, until
        /// 2026-08-29; Godot and Unreal already had the family shape.</summary>
        public static SaveFile SaveState(Engine engine, OrderedMap<string, StoryletValue> world = null)
        {
            return new SaveFile { Engine = engine.SaveGame(), World = world };
        }

        /// <summary>Restore a SaveState file into an engine (every flow is
        /// rebuilt; re-take your Flow handles afterwards). Throws on a foreign
        /// or malformed file. Returns the file's @world values, if any - the
        /// HOST applies them; the engine never touches them.</summary>
        public static OrderedMap<string, StoryletValue> LoadState(Engine engine, SaveFile file)
        {
            if (file == null || file.Engine == null)
            {
                throw new StoryletError($"not a storylets save (expected schema \"{Model.SAVEFILE_SCHEMA}\")");
            }
            engine.LoadGame(file.Engine);
            return file.World;
        }

        /// <summary>Parse + restore a SerializeState string: the TEXT twin of
        /// LoadState, as Patterplay pairs them. Throws on malformed JSON, a
        /// foreign file or a project mismatch.</summary>
        public static OrderedMap<string, StoryletValue> DeserializeState(Engine engine, string json)
        {
            JObject parsed;
            try
            {
                parsed = JObject.Parse(json);
            }
            catch (Exception)
            {
                throw new StoryletError("not valid JSON");
            }
            var engineToken = parsed["engine"] as JObject;
            if (parsed.Value<string>("schema") != Model.SAVEFILE_SCHEMA
                || engineToken == null || engineToken.Value<string>("schema") != Model.SAVE_SCHEMA)
            {
                throw new StoryletError($"not a storylets save (expected schema \"{Model.SAVEFILE_SCHEMA}\")");
            }
            SaveFile file;
            try
            {
                file = new SaveFile
                {
                    Engine = FromJson(engineToken),
                    World = parsed["world"] is JObject world ? ParseBag(world) : null,
                };
            }
            catch (StoryletError)
            {
                throw;
            }
            catch (Exception e)
            {
                throw new StoryletError($"malformed storylets save: {e.Message}");
            }
            return LoadState(engine, file);
        }

        // --- envelope <-> JObject (the TS SaveEnvelope wire shape) ---------------

        /// <summary>JS-style number token: integral doubles write as integers
        /// (JSON.stringify never emits "1.0"), everything else as a double.</summary>
        private static JValue NumToken(double n)
        {
            if (!double.IsNaN(n) && !double.IsInfinity(n)
                && n == Math.Floor(n) && Math.Abs(n) <= Model.MAX_SAFE_INTEGER)
            {
                return new JValue((long)n);
            }
            return new JValue(n);
        }

        private static JToken ValueToken(StoryletValue v)
        {
            if (v.IsBool) return new JValue(v.AsBool);
            if (v.IsNumber) return NumToken(v.AsNumber);
            if (v.IsString) return new JValue(v.AsString);
            var arr = new JArray();
            foreach (var flag in v.AsFlags) arr.Add(flag);
            return arr;
        }

        private static JObject BagToken(OrderedMap<string, StoryletValue> bag)
        {
            var o = new JObject();
            foreach (var pair in bag) o[pair.Key] = ValueToken(pair.Value);
            return o;
        }

        private static JObject KindToken(OrderedMap<string, OrderedMap<string, StoryletValue>> kind)
        {
            var o = new JObject();
            foreach (var pair in kind) o[pair.Key] = BagToken(pair.Value);
            return o;
        }

        private static JObject PartitionToken(PropsPartition p)
        {
            return new JObject
            {
                ["story"] = BagToken(p.Story),
                ["box"] = KindToken(p.Box),
                ["deck"] = KindToken(p.Deck),
                ["hand"] = KindToken(p.Hand),
                ["value"] = KindToken(p.Value),
            };
        }

        private static JObject FlowToken(FlowSave f)
        {
            var turns = new JObject();
            foreach (var pair in f.Turns) turns[pair.Key] = NumToken(pair.Value);
            var cooldowns = new JObject();
            foreach (var pair in f.Cooldowns) cooldowns[pair.Key] = NumToken(pair.Value);
            var board = new JObject();
            foreach (var pair in f.Board)
            {
                var hand = new JArray();
                foreach (var id in pair.Value) hand.Add(id);
                board[pair.Key] = hand;
            }
            var playLog = new JArray();
            foreach (var record in f.PlayLog)
            {
                playLog.Add(new JObject
                {
                    ["card"] = record.Card,
                    ["outcome"] = record.Outcome,
                    ["turn"] = NumToken(record.Turn),
                });
            }
            return new JObject
            {
                ["props"] = PartitionToken(f.Props),
                ["turns"] = turns,
                ["prng"] = f.Prng,
                ["cooldowns"] = cooldowns,
                ["board"] = board,
                ["playLog"] = playLog,
            };
        }

        public static JObject ToJson(SaveEnvelope env)
        {
            var content = new JObject();
            if (env.Content.Project != null) content["project"] = env.Content.Project;
            if (env.Content.Version != null) content["version"] = env.Content.Version;
            if (env.Content.Hash != null) content["hash"] = env.Content.Hash;
            var flows = new JObject();
            foreach (var pair in env.Flows) flows[pair.Key] = FlowToken(pair.Value);
            return new JObject
            {
                ["schema"] = env.Schema,
                ["content"] = content,
                ["shared"] = SharedToken(env.Shared),
                ["flows"] = flows,
            };
        }

        private static OrderedMap<string, StoryletValue> ParseBag(JToken token)
        {
            var bag = new OrderedMap<string, StoryletValue>();
            if (!(token is JObject o)) return bag;
            foreach (var pair in o) bag.Set(pair.Key, StoryletJson.ToValue(pair.Value));
            return bag;
        }

        private static OrderedMap<string, OrderedMap<string, StoryletValue>> ParseKind(JToken token)
        {
            var kind = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
            if (!(token is JObject o)) return kind;
            foreach (var pair in o) kind.Set(pair.Key, ParseBag(pair.Value));
            return kind;
        }

        /// <summary>The engine's shared half: the properties plus the spent set
        /// (design/shared-scarcity.md).</summary>
        private static JObject SharedToken(SharedSave shared)
        {
            var spent = new JArray();
            foreach (var id in shared.Spent ?? new List<string>()) spent.Add(id);
            return new JObject
            {
                ["props"] = PartitionToken(shared.Props),
                ["spent"] = spent,
            };
        }

        private static SharedSave ParseShared(JToken token)
        {
            var shared = new SharedSave();
            var o = token as JObject;
            if (o == null) return shared;
            shared.Props = ParsePartition(o["props"]);
            if (o["spent"] is JArray spent)
            {
                foreach (var id in spent) shared.Spent.Add(id.Value<string>());
            }
            return shared;
        }

        private static PropsPartition ParsePartition(JToken token)
        {
            var p = new PropsPartition();
            if (!(token is JObject o)) return p;
            p.Story = ParseBag(o["story"]);
            p.Box = ParseKind(o["box"]);
            p.Deck = ParseKind(o["deck"]);
            p.Hand = ParseKind(o["hand"]);
            p.Value = ParseKind(o["value"]);
            return p;
        }

        private static FlowSave ParseFlow(JObject o)
        {
            var f = new FlowSave { Props = ParsePartition(o["props"]) };
            if (o["turns"] is JObject turns)
            {
                foreach (var pair in turns) f.Turns.Set(pair.Key, pair.Value.Value<double>());
            }
            f.Prng = o.Value<uint>("prng");
            if (o["cooldowns"] is JObject cooldowns)
            {
                foreach (var pair in cooldowns) f.Cooldowns.Set(pair.Key, pair.Value.Value<double>());
            }
            if (o["board"] is JObject board)
            {
                foreach (var pair in board)
                {
                    var ids = new List<string>();
                    foreach (var id in (JArray)pair.Value) ids.Add(id.Value<string>());
                    f.Board.Set(pair.Key, ids);
                }
            }
            if (o["playLog"] is JArray playLog)
            {
                foreach (var item in playLog)
                {
                    var record = (JObject)item;
                    f.PlayLog.Add(new PlayRecord
                    {
                        Card = record.Value<string>("card"),
                        Outcome = record.Value<string>("outcome"),
                        Turn = record.Value<double>("turn"),
                    });
                }
            }
            return f;
        }

        public static SaveEnvelope FromJson(JObject o)
        {
            var env = new SaveEnvelope();
            var content = o["content"] as JObject;
            if (content != null)
            {
                env.Content.Project = content.Value<string>("project");
                env.Content.Version = content.Value<string>("version");
                env.Content.Hash = content.Value<string>("hash");
            }
            env.Shared = ParseShared(o["shared"]);
            if (o["flows"] is JObject flows)
            {
                foreach (var pair in flows) env.Flows.Set(pair.Key, ParseFlow((JObject)pair.Value));
            }
            return env;
        }
    }
}
