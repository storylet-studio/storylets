// The bundle inspector, Unity idiom (design/engine-runtimes.md 2, piece 6):
// a [CustomEditor] on the imported .storyletsc asset, so selecting a bundle in
// the Project window answers "what may my game code call?" without running the
// game or opening Storyletter.
//
// Read-only by construction: the rows come from BundleInspector.DescribeBundle
// (no session, no state), and nothing here writes to the asset. Identity
// first, then collapsible sections - Hands (the Deal() surface), Tags by box
// (the Peek() criteria surface), Properties (declared), Counts - with the
// LoadError surfaced prominently above everything when the bundle failed to
// compile. The raw JSON stays behind a closed foldout: it is the artefact, not
// the answer.

using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace StoryletStudio.StoryletEngine.Editor
{
    [CustomEditor(typeof(StoryletBundleAsset))]
    public sealed class StoryletBundleAssetEditor : UnityEditor.Editor
    {
        private bool _handsOpen = true;
        private bool _tagsOpen = true;
        private bool _propsOpen = true;
        private bool _mapsOpen = true;
        private bool _countsOpen = true;
        private bool _jsonOpen;

        public override void OnInspectorGUI()
        {
            var asset = (StoryletBundleAsset)target;

            // A broken bundle still imports: say so first, and loudly.
            string error = asset.LoadError;
            if (!string.IsNullOrEmpty(error))
            {
                EditorGUILayout.HelpBox("This bundle failed to compile:\n" + error, MessageType.Error);
                DrawRawJson(asset);
                return;
            }

            var description = BundleInspector.DescribeBundle(asset.Bundle);
            DrawIdentity(description.Identity);
            EditorGUILayout.Space();

            _handsOpen = EditorGUILayout.Foldout(_handsOpen, "Hands (deal)", true);
            if (_handsOpen) DrawHands(description);

            _tagsOpen = EditorGUILayout.Foldout(_tagsOpen, "Tags by box (peek criteria)", true);
            if (_tagsOpen) DrawTags(description);

            _propsOpen = EditorGUILayout.Foldout(_propsOpen, "Properties (declared)", true);
            if (_propsOpen) DrawProperties(description);

            // Only when there are some. An empty section on every ordinary
            // bundle would teach the reader to skip the one section that only
            // matters when it is not empty.
            if (description.Maps.Count > 0)
            {
                _mapsOpen = EditorGUILayout.Foldout(_mapsOpen, "Maps (carried, not read)", true);
                if (_mapsOpen) DrawMaps(description);
            }

            _countsOpen = EditorGUILayout.Foldout(_countsOpen, "Counts", true);
            if (_countsOpen) DrawCounts(description);

            EditorGUILayout.Space();
            DrawRawJson(asset);
        }

        private static void DrawIdentity(BundleIdentity identity)
        {
            EditorGUILayout.LabelField(
                $"{identity.Project} {identity.Version}", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("Schema", identity.Schema);
            EditorGUILayout.LabelField("Hash", string.IsNullOrEmpty(identity.Hash) ? "(none)" : identity.Hash);
            EditorGUILayout.LabelField("Metadata", identity.Metadata);
        }

        private static void DrawHands(BundleDescription description)
        {
            if (description.Hands.Count == 0)
            {
                EditorGUILayout.LabelField("  (no hands - this bundle is peek-only)");
                return;
            }
            foreach (var hand in description.Hands)
            {
                string template = string.IsNullOrEmpty(hand.Template) ? "" : $", template {hand.Template}";
                EditorGUILayout.LabelField(
                    "  " + (string.IsNullOrEmpty(hand.Title) ? hand.GameId : $"{hand.GameId} ({hand.Title})"),
                    $"box {hand.Box}, slots {hand.SlotsLabel}{template}");
            }
        }

        private static void DrawTags(BundleDescription description)
        {
            foreach (var box in description.Boxes)
            {
                EditorGUILayout.LabelField(
                    "  " + (string.IsNullOrEmpty(box.Title) ? box.GameId : box.Title),
                    EditorStyles.miniBoldLabel);
                if (box.TagGroups.Count == 0)
                {
                    EditorGUILayout.LabelField("    (no tag groups)");
                    continue;
                }
                foreach (var group in box.TagGroups)
                {
                    EditorGUILayout.LabelField("    " + group.GameId,
                        group.Tags.Count > 0 ? string.Join(", ", group.Tags) : "(no tags)");
                }
            }
        }

        private static void DrawProperties(BundleDescription description)
        {
            foreach (var scope in description.Properties)
            {
                EditorGUILayout.LabelField("  " + ScopeLabel(scope), EditorStyles.miniBoldLabel);
                if (scope.Properties.Count == 0)
                {
                    EditorGUILayout.LabelField("    (none declared)");
                    continue;
                }
                foreach (var p in scope.Properties)
                {
                    EditorGUILayout.LabelField("    " + p.Name, PropertyLabel(p));
                }
            }
        }

        /// <summary>The scope label a declaration block files under ("world",
        /// "box box", "tag docks (zone)").</summary>
        internal static string ScopeLabel(PropertyScopeSummary scope)
        {
            if (scope.Scope == PropertyScopeKinds.World || scope.Scope == PropertyScopeKinds.Story)
            {
                return scope.Scope;
            }
            string group = string.IsNullOrEmpty(scope.Group) ? "" : $" ({scope.Group})";
            return $"{scope.Scope} {scope.Owner}{group}";
        }

        /// <summary>"type = default", plus enum/flags options where declared.</summary>
        internal static string PropertyLabel(PropertySummary p)
        {
            string options = p.Values != null && p.Values.Count > 0 ? $" [{string.Join(", ", p.Values)}]" : "";
            string def = p.Default != null ? p.Default.ToJsonString() : "<unset>";
            return $"{p.Type} = {def}{options}";
        }

        private static void DrawMaps(BundleDescription description)
        {
            EditorGUILayout.LabelField("Geometry the build was asked to carry. The engine ignores it.", EditorStyles.miniLabel);
            foreach (var map in description.Maps)
            {
                EditorGUILayout.LabelField($"{map.Box} - {map.Group}: zones {map.Zones}, pictures {map.Backgrounds}");
            }
        }

        private static void DrawCounts(BundleDescription description)
        {
            var t = description.Totals;
            EditorGUILayout.LabelField("  Whole bundle",
                $"boxes {t.Boxes}, decks {t.Decks}, cards {t.Cards}, hands {t.Hands}, "
                + $"templates {t.Templates}, tag groups {t.TagGroups}");
            foreach (var box in description.Boxes)
            {
                var c = box.Counts;
                EditorGUILayout.LabelField("  " + box.GameId,
                    $"decks {c.Decks}, cards {c.Cards}, hands {c.Hands}, templates {c.Templates}, "
                    + $"tag groups {c.TagGroups}, ranking.specificity {(box.RankingSpecificity ? "on" : "off")}");
            }
        }

        private void DrawRawJson(StoryletBundleAsset asset)
        {
            _jsonOpen = EditorGUILayout.Foldout(_jsonOpen, "Source JSON (raw .storyletsc)", true);
            if (!_jsonOpen) return;
            string json = asset.SourceJson ?? "";
            EditorGUILayout.LabelField($"  {json.Length} characters, persisted verbatim");
            using (new EditorGUI.DisabledScope(true))
            {
                // A guard, not a limit: the whole bundle in one text area would
                // choke the inspector on a real project.
                EditorGUILayout.TextArea(json.Length > 4000 ? json.Substring(0, 4000) + "\n..." : json,
                    GUILayout.MaxHeight(160));
            }
            if (GUILayout.Button("Copy Source JSON", GUILayout.Width(150)))
            {
                EditorGUIUtility.systemCopyBuffer = json;
            }
        }

        /// <summary>Rendering helper shared with the tests: one line per hand,
        /// as the inspector shows it.</summary>
        internal static List<string> HandLines(BundleDescription description)
        {
            var lines = new List<string>();
            foreach (var hand in description.Hands)
            {
                string template = string.IsNullOrEmpty(hand.Template) ? "" : $", template {hand.Template}";
                lines.Add($"{hand.GameId}: box {hand.Box}, slots {hand.SlotsLabel}{template}");
            }
            return lines;
        }
    }
}
