// The debug registry (engine-runtimes.md section 2, piece 5): a tiny static
// registry the editor "Runtime State" window reads, so the examiner finds
// every live engine without plumbing. In your game, call
// StoryletDebug.Register(engine, "label") - one entry per ENGINE. The window
// asks the engine for its open flows, so flows opened and closed later show
// up and disappear on their own, and nothing has to be registered twice.
// This is the shape Patterplay's PatterDebug has in all three ports.
//
// Engines are held weakly: a host that forgets to Unregister never pins a
// dead engine in memory, and List() prunes collected entries as it reads.

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    public static class StoryletDebug
    {
        public sealed class Entry
        {
            public Engine Engine;
            public string Label;
        }

        private sealed class WeakEntry
        {
            public WeakReference<Engine> Engine;
            public string Label;
        }

        private static readonly List<WeakEntry> Entries = new List<WeakEntry>();

        /// <summary>Fires when the registry changes (register / unregister),
        /// so an examiner can repaint without polling the list shape.</summary>
        public static event Action OnChanged;

        /// <summary>The game's Live Link to Storyletter, if it registered one
        /// (RegisterLink), so the state window can show where the link is. One
        /// per process: a game talks to one editor.</summary>
        public static StoryletLiveLink Link { get; private set; }

        public static void RegisterLink(StoryletLiveLink link)
        {
            if (ReferenceEquals(Link, link)) return;
            Link = link;
            OnChanged?.Invoke();
        }

        public static void UnregisterLink(StoryletLiveLink link)
        {
            if (Link == null || !ReferenceEquals(Link, link)) return;
            Link = null;
            OnChanged?.Invoke();
        }

        public static void Register(Engine engine, string label = null)
        {
            if (engine == null) return;
            foreach (var entry in Entries)
            {
                if (entry.Engine.TryGetTarget(out var live) && ReferenceEquals(live, engine)) return;
            }
            Entries.Add(new WeakEntry
            {
                Engine = new WeakReference<Engine>(engine),
                Label = label,
            });
            OnChanged?.Invoke();
        }

        public static void Unregister(Engine engine)
        {
            var removed = Entries.RemoveAll(entry =>
                !entry.Engine.TryGetTarget(out var live) || ReferenceEquals(live, engine));
            if (removed > 0) OnChanged?.Invoke();
        }

        /// <summary>The live engines, registration order, dead entries pruned.</summary>
        public static List<Entry> List()
        {
            var live = new List<Entry>();
            var pruned = Entries.RemoveAll(entry => !entry.Engine.TryGetTarget(out _));
            foreach (var entry in Entries)
            {
                if (entry.Engine.TryGetTarget(out var engine))
                {
                    live.Add(new Entry { Engine = engine, Label = entry.Label });
                }
            }
            if (pruned > 0) OnChanged?.Invoke();
            return live;
        }
    }
}
