// A compiled .storyletsc imported into Unity as an asset (produced by the
// ScriptedImporter). Persists the raw bundle JSON verbatim and rebuilds the
// compiled form lazily via the Json loader - never re-serialised (the bundle
// asset path, engine-runtimes.md section 2). Separate from the pure runtime
// (this references UnityEngine), so the core stays engine-free.
//
// A broken bundle still imports: the asset always exists, with the parse
// failure readable on LoadError (the old StoryworldImporter pattern).

using System;
using UnityEngine;

namespace StoryletStudio.StoryletEngine
{
    public sealed class StoryletBundleAsset : ScriptableObject
    {
        [SerializeField, HideInInspector] private string sourceJson;

        [NonSerialized] private Bundle _bundle;
        [NonSerialized] private string _loadError;
        [NonSerialized] private bool _parsed;

        /// <summary>The raw compiled bundle JSON (the .storyletsc contents),
        /// persisted verbatim. Setting it invalidates the compiled form.</summary>
        public string SourceJson
        {
            get => sourceJson;
            set
            {
                sourceJson = value;
                _bundle = null;
                _loadError = null;
                _parsed = false;
            }
        }

        /// <summary>The parse failure, readable on the asset (null when the
        /// bundle loads cleanly). Populated by the importer and on any lazy
        /// rebuild, so a broken asset diagnoses itself in the editor.</summary>
        public string LoadError
        {
            get
            {
                EnsureParsed();
                return _loadError;
            }
        }

        /// <summary>The compiled bundle (rebuilt lazily from SourceJson).
        /// Throws a StoryletError when the JSON is missing or malformed;
        /// check LoadError first for the no-throw read.</summary>
        public Bundle Bundle
        {
            get
            {
                EnsureParsed();
                if (_bundle == null) throw new StoryletError(_loadError ?? "no bundle JSON");
                return _bundle;
            }
        }

        /// <summary>Set the source JSON and try the loader in one step (the
        /// importer's entry point). Returns false with the error on failure;
        /// the asset keeps the JSON either way.</summary>
        public bool LoadFromJsonString(string json, out string error)
        {
            SourceJson = json;
            EnsureParsed();
            error = _loadError;
            return _bundle != null;
        }

        /// <summary>Construct a play-ready ENGINE on this bundle (all play
        /// happens on a Flow from OpenFlow - design/flows.md).</summary>
        public Engine CreateEngine(double seed = 0, EngineOptions opts = null)
        {
            opts = opts ?? new EngineOptions();
            opts.Seed = seed;
            return new Engine(Bundle, opts);
        }

        private void OnEnable()
        {
            // Warm the compiled form when the asset loads; a broken bundle
            // just records its LoadError (never throws here).
            EnsureParsed();
        }

        private void EnsureParsed()
        {
            if (_parsed) return;
            _parsed = true;
            _bundle = null;
            _loadError = null;
            if (string.IsNullOrEmpty(sourceJson))
            {
                _loadError = "no bundle JSON";
                return;
            }
            try
            {
                _bundle = BundleLoader.Parse(sourceJson);
            }
            catch (Exception e)
            {
                _loadError = e.Message;
            }
        }
    }
}
