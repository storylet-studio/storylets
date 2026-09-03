// The Hamlet, the game part, with no Unity in it: the same shape as the JS
// client's main.ts + performance.ts and the Godot demo's hamlet_game.gd, so the
// three read side by side. Pure C#, so the TestHost beside this project
// compiles and plays it with no editor.
//
//   the Storylet Engine decides WHICH beat happens, and when
//   Patter performs that beat's dialogue
//   HamletWorld owns @world, and is handed to both
//
// Neither engine is told the other exists. What joins them: a card's gameId
// is its scene id; an outcome's gameId is what the scene reports in a
// gameEvent's gameData.outcome; and the world object.
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using StoryletStudio.StoryletEngine;
using Patterkit.Patterplay;
using SEngine = StoryletStudio.StoryletEngine.Engine;
using SFlow = StoryletStudio.StoryletEngine.Flow;
using PEngine = Patterkit.Patterplay.Engine;
using PFlow = Patterkit.Patterplay.Flow;

namespace StoryletStudio.Hamlet
{
    public sealed class HamletGame
    {
        public const double Seed = 7;
        public const string Flow = "main";
        public const string Performance = "performance";

        public HamletWorld World { get; private set; }
        public SEngine Storylets { get; private set; }
        public SFlow Story { get; private set; }
        public PEngine Patter { get; private set; }
        public readonly List<(string gameId, string title)> Places = new List<(string, string)>();
        public string At { get; private set; } = "";
        public Performing Playing { get; private set; }
        public readonly List<string> Log = new List<string>();

        public sealed class Performing
        {
            public DealtCard Card; public PFlow Flow;
            public List<(string kind, string character, string text)> Shown = new List<(string, string, string)>();
            public List<(string id, string text)> Choices = new List<(string, string)>();
            public string Outcome;
        }

        public void Setup(string storyletJson, string patterJson)
        {
            World = new HamletWorld(new Dictionary<string, object> { ["time_of_day"] = "day", ["knows_road"] = false }, "time_of_day");
            var sb = BundleLoader.Parse(storyletJson);
            Storylets = new SEngine(sb, new StoryletStudio.StoryletEngine.EngineOptions { Seed = Seed, World = World });
            // ONE resolver, both engines. Patter's Unity package takes it under
            // HostScopes keyed by scope token; ours under World. Same object.
            Patter = new PEngine(PatterBundleLoader.Parse(patterJson), new Patterkit.Patterplay.EngineOptions
                { Seed = Seed, HostScopes = new Dictionary<string, IHostScope> { ["world"] = World } });
            Story = Storylets.OpenFlow(Flow);
            Places.Clear();
            foreach (var h in sb.Boxes[0].Hands) Places.Add((h.GameId, h.Title ?? h.GameId));
            Story.DealMany();
        }

        /// Arrive somewhere. A place is a HAND, so arriving means dealing it.
        public void Go(string place) { At = place; Playing = null; if (place != "") Story.Deal(place); }
        public List<DealtCard> Hand() => At == "" ? new List<DealtCard>() : Story.Deal(At);

        /// Pick a card: the storylet side chose the beat; Patter performs it, found BY NAME.
        public void Start(DealtCard card)
        {
            Playing = new Performing { Card = card, Flow = Patter.OpenFlow(Performance, card.GameId) };
            Run();
        }
        public void Choose(string optionId) { if (Playing == null) return; Playing.Flow.Choose(optionId); Playing.Choices.Clear(); Run(); }

        private void Run()
        {
            for (var guard = 0; guard < 500; guard++)
            {
                var step = Playing.Flow.Advance();
                switch (step.Type)
                {
                    case StepType.Line: Playing.Shown.Add(("line", step.CharacterName ?? step.Character ?? "", step.Text ?? "")); break;
                    case StepType.Text: Playing.Shown.Add(("text", "", step.Text ?? "")); break;
                    case StepType.GameEvent:
                        // THE SEAM: the scene saying which of the card's outcomes it reached.
                        if (step.GameData != null && step.GameData.TryGetValue("outcome", out var o) && o.IsString) Playing.Outcome = o.AsString;
                        break;
                    case StepType.Choice:
                        foreach (var opt in step.Options.Where(x => x.Eligible)) Playing.Choices.Add((opt.Id, opt.Prompt?.Text ?? opt.Id));
                        return;
                    default: Finish(); return;
                }
            }
        }

        private void Finish()
        {
            var card = Playing.Card; var outcome = Playing.Outcome;
            if (string.IsNullOrEmpty(outcome)) throw new InvalidOperationException($"scene \"{card.GameId}\" ended without reporting an outcome");
            Story.Play(card.Id, outcome, At);
            Log.Insert(0, $"{card.Title ?? card.GameId}: {outcome}");
            Playing = null;
            // Re-prime everywhere: a refresh evicts what is no longer eligible and fills
            // EMPTY slots; a still-eligible card keeps its seat (the survivor rule).
            Story.DealMany();
        }

        public void Wait()
        {
            World.Host("time_of_day", (string)World.Values["time_of_day"] == "day" ? "night" : "day");
            Story.AdvanceTurns(Story.ListBoxes()[0].GameId, 1);
            Story.DealMany();
        }

        // --- one envelope, both engines, the world once (the JS client's shape, key for key) ---
        public string Save()
        {
            var env = new JObject
            {
                ["storylets"] = StoryletSave.SerializeState(Storylets),
                // Patter's half as its own text envelope (patter/save@0), exactly as the
                // storylet half is ours: the family's serializer, never the raw save object.
                ["patter"] = PatterSave.SerializeState(Patter),
                ["world"] = JObject.FromObject(World.Values),
                ["at"] = At,
                ["performing"] = Playing == null ? null : new JObject
                {
                    ["card"] = new JObject { ["id"] = Playing.Card.Id, ["gameId"] = Playing.Card.GameId, ["title"] = Playing.Card.Title },
                    ["shown"] = new JArray(Playing.Shown.Select(s => new JObject { ["kind"] = s.kind, ["character"] = s.character, ["text"] = s.text })),
                    ["outcome"] = Playing.Outcome,
                },
            };
            return env.ToString(Newtonsoft.Json.Formatting.None);
        }

        public bool Load(string json)
        {
            var env = JObject.Parse(json);
            var w = env["world"] as JObject;
            if (w != null) foreach (var p in w.Properties()) World.Values[p.Name] = p.Value.Type == JTokenType.Boolean ? (object)p.Value.Value<bool>() : p.Value.Type == JTokenType.Integer || p.Value.Type == JTokenType.Float ? (object)p.Value.Value<double>() : p.Value.Value<string>();
            StoryletSave.DeserializeState(Storylets, env["storylets"].Value<string>());
            PatterSave.DeserializeState(Patter, env["patter"].Type == JTokenType.String ? env["patter"].Value<string>() : env["patter"].ToString(Newtonsoft.Json.Formatting.None));
            // A load rebuilds the flows, and OpenFlow on an existing id REPLACES it, hand and all: GetFlow.
            Story = Storylets.GetFlow(Flow);
            if (Story == null) return false;
            At = env["at"]?.Value<string>() ?? "";
            var perf = env["performing"] as JObject;
            if (perf != null)
            {
                var flow = Patter.GetFlow(Performance);
                if (flow == null) throw new InvalidOperationException("the envelope says a scene was in flight, and Patter's half did not restore it");
                var card = new DealtCard { Id = perf["card"]["id"].Value<string>(), GameId = perf["card"]["gameId"].Value<string>(), Title = perf["card"]["title"]?.Value<string>() };
                var pl = new Performing { Card = card, Flow = flow, Outcome = perf["outcome"]?.Value<string>() };
                foreach (var s in perf["shown"] as JArray ?? new JArray()) pl.Shown.Add((s["kind"].Value<string>(), s["character"]?.Value<string>() ?? "", s["text"]?.Value<string>() ?? ""));
                foreach (var opt in flow.GetChoices().Where(x => x.Eligible)) pl.Choices.Add((opt.Id, opt.Prompt?.Text ?? opt.Id));
                Playing = pl;
            }
            return true;
        }

        public string WorldLine() => string.Join(" · ", World.Values.Select(kv => kv.Value is bool b ? (b ? kv.Key : null) : kv.Value?.ToString()).Where(s => !string.IsNullOrEmpty(s)));
    }
}
