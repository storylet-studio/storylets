// A ScriptedImporter: drop a compiled .storyletsc into a Unity project and it
// imports as a StoryletBundleAsset. A broken bundle STILL imports - the error
// is logged via ctx and readable on the asset's LoadError - so the file always
// shows up in the Project view with something to click on (the old
// StoryworldImporter pattern, engine-runtimes.md section 2).

using System;
using System.IO;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace StoryletStudio.StoryletEngine.Editor
{
    [ScriptedImporter(1, "storyletsc")]
    public sealed class StoryletBundleImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            var asset = ScriptableObject.CreateInstance<StoryletBundleAsset>();
            string json = null;
            try
            {
                json = File.ReadAllText(ctx.assetPath);
            }
            catch (Exception e)
            {
                ctx.LogImportError($"Storylet Engine: failed to read source file - {e.Message}");
            }
            if (json != null && !asset.LoadFromJsonString(json, out var error))
            {
                ctx.LogImportError($"Storylet Engine: invalid .storyletsc - {error}");
            }
            // Always produce the asset, even on failure: the JSON is preserved
            // and LoadError surfaces the diagnosis in-editor.
            ctx.AddObjectToAsset("StoryletBundle", asset);
            ctx.SetMainObject(asset);
        }
    }
}
