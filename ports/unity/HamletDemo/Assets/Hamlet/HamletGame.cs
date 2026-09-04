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
        /// <summary>The box this host performs through Patter, and the name of its ONE Patter flow: opened once,
        /// found again after a load, entered per card with Goto. Never re-opened, so the flow's visit counts,
        /// shuffle cursors and PRNG carry on between performances.</summary>
        public const string Box = "village";
        public PFlow Performance;

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
            public List<(string id, string text, string outcome, bool enabled, string why)> Choices
                = new List<(string, string, string, bool, string)>();
            public string Outcome;
            /// <summary>The outcome named on the option the player took, when no gameEvent overrules it.</summary>
            public string Labelled;
            /// <summary>The scene has ENDED and its closing words are on screen, waiting for Continue.</summary>
            public bool Done;
        }

        public void Setup(string storyletJson, string patterJson)
        {
            World = new HamletWorld(new Dictionary<string, object> { ["time_of_day"] = "day", ["knows_road"] = false });   // nothing read-only: both projects let a scene or a card move time
            var sb = BundleLoader.Parse(storyletJson);
            Storylets = new SEngine(sb, new StoryletStudio.StoryletEngine.EngineOptions { Seed = Seed, World = World });
            // ONE resolver, both engines. Patter's Unity package takes it under
            // HostScopes keyed by scope token; ours under World. Same object.
            Patter = new PEngine(PatterBundleLoader.Parse(patterJson), new Patterkit.Patterplay.EngineOptions
                { Seed = Seed, HostScopes = new Dictionary<string, IHostScope> { ["world"] = World } });
            Story = Storylets.OpenFlow(Flow);
            Performance = Patter.OpenFlow(Box);
            Places.Clear();
            foreach (var h in sb.Boxes[0].Hands) Places.Add((h.GameId, h.Title ?? h.GameId));
            Story.DealMany();
            // Open where there is something to do: the first hand that deals a card. The project
            // does not order its hands for this (the demo opens with one card, at the gate).
            foreach (var p in Places) if (Story.Deal(p.Item1).Count > 0) { At = p.Item1; break; }
        }

        /// Arrive somewhere. A place is a HAND, so arriving means dealing it.
        public void Go(string place) { At = place; Playing = null; if (place != "") Story.Deal(place); }
        public List<DealtCard> Hand() => At == "" ? new List<DealtCard>() : Story.Deal(At);

        /// Pick a card: the storylet side chose the beat; Patter performs it, found BY NAME.
        public void Start(DealtCard card)
        {
            if (!Performance.Goto(card.GameId)) throw new InvalidOperationException($"no Patter scene \"{card.GameId}\"");
            Playing = new Performing { Card = card, Flow = Performance };
            Run();
        }
        public void Choose(string optionId)
        {
            if (Playing == null) return;
            // The label rides with the option, so it is taken HERE, while the host still
            // knows which option was clicked. By the end of the branch it is gone.
            var picked = Playing.Choices.FirstOrDefault(c => c.id == optionId);
            if (!string.IsNullOrEmpty(picked.outcome)) Playing.Labelled = picked.outcome;
            Playing.Flow.Choose(optionId); Playing.Choices.Clear(); Run(); }

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
                        Playing.Choices.AddRange(ChoicesFrom(step.Options));
                        return;
                    default:
                        // The scene has ENDED but its outcome is not played yet: its closing lines,
                        // and the whole of a scene with no choice, would vanish under the redeal
                        // before anyone read them. The player presses Continue.
                        Playing.Done = true;
                        return;
                }
            }
        }

        /// <summary>The outcome ids the storylet side will accept for this card RIGHT NOW. Read
        /// afresh at every stop: a scene can write @world mid-performance and change what is open
        /// under itself.</summary>
        private HashSet<string> OpenOutcomes() =>
            new HashSet<string>(Story.Outcomes(Playing.Card.Id, At).Where(o => o.Available).Select(o => o.GameId));

        /// <summary>The choices a step offers, with BOTH engines' gates applied. Patter says whether
        /// the option can be offered at all; the Storylet Engine says whether the outcome it leads
        /// to is open. Clickable only when both agree.</summary>
        private List<(string, string, string, bool, string)> ChoicesFrom(IEnumerable<Patterkit.Patterplay.ChoiceOption> options)
        {
            var open = OpenOutcomes();
            var made = new List<(string, string, string, bool, string)>();
            foreach (var opt in options)
            {
                var outcome = opt.GameData != null && opt.GameData.TryGetValue("outcome", out var g) && g.IsString ? g.AsString : null;
                var shut = outcome != null && !open.Contains(outcome);
                made.Add((opt.Id, opt.Prompt?.Text ?? opt.Id, outcome, opt.Eligible && !shut,
                    !opt.Eligible ? "not available here" : shut ? "requirements not met" : ""));
            }
            return made;
        }

        /// <summary>An explicit gameEvent, else the option the player took, else the card's only
        /// outcome. Loud when none of the three answers: guessing would move the world the wrong
        /// way, and the build catches this shape first (scripts/pairing.mjs).</summary>
        private string ResolveOutcome()
        {
            if (!string.IsNullOrEmpty(Playing.Outcome)) return Playing.Outcome;
            if (!string.IsNullOrEmpty(Playing.Labelled)) return Playing.Labelled;
            var declared = Story.Outcomes(Playing.Card.Id, At).Select(o => o.GameId).ToList();
            if (declared.Count == 1) return declared[0];
            throw new InvalidOperationException($"scene \"{Playing.Card.GameId}\" ended without saying which outcome"
                + $" it reached, and its card declares {declared.Count} ({string.Join(", ", declared)})");
        }

        /// <summary>Called by the Continue button, once the player has read what the scene said.</summary>
        public void Finish()
        {
            var card = Playing.Card; var outcome = ResolveOutcome();
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
                    ["labelled"] = Playing.Labelled,
                    ["done"] = Playing.Done,
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
            Performance = Patter.GetFlow(Box);
            if (Performance == null) throw new InvalidOperationException($"the save has no \"{Box}\" Patter flow");
            At = env["at"]?.Value<string>() ?? "";
            var perf = env["performing"] as JObject;
            if (perf != null)
            {
                var flow = Performance;
                var card = new DealtCard { Id = perf["card"]["id"].Value<string>(), GameId = perf["card"]["gameId"].Value<string>(), Title = perf["card"]["title"]?.Value<string>() };
                var pl = new Performing { Card = card, Flow = flow, Outcome = perf["outcome"]?.Value<string>(),
                    Labelled = perf["labelled"]?.Value<string>(), Done = perf["done"]?.Value<bool>() ?? false };
                foreach (var s in perf["shown"] as JArray ?? new JArray()) pl.Shown.Add((s["kind"].Value<string>(), s["character"]?.Value<string>() ?? "", s["text"]?.Value<string>() ?? ""));
                Playing = pl;   // ChoicesFrom reads Playing.Card for the card's outcomes
                // A scene that had ended and not been continued needs nothing from Patter:
                // the transcript and the outcome are the envelope's, and Continue is waiting.
                if (!pl.Done) pl.Choices.AddRange(ChoicesFrom(flow.GetChoices()));
                Playing = pl;
            }
            return true;
        }

        public string WorldLine() => string.Join(" · ", World.Values.Select(kv => kv.Value is bool b ? (b ? kv.Key : null) : kv.Value?.ToString()).Where(s => !string.IsNullOrEmpty(s)));
    }
}
