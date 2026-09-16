// Generated from patterkit/site-chrome; do not edit here, edit the source and run sync
export default {
  "brand": "Storylet Studio",
  "product": "Storylet Studio",
  "wrapClass": "sy-wrap",
  "credit": "Open source under the <a href=\"{base}licensing/\">MIT licence</a>, made by <a href=\"https://ian.wildwinter.net\" rel=\"author\">Ian Thomas</a>.",
  "landing": {
    "mark": "<svg viewBox=\"0 0 100 100\" width=\"28\" height=\"28\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><g fill=\"none\"><path d=\"M88 12 C5 12 5 50 50 50 C95 50 95 88 12 88\" stroke=\"#36284a\" stroke-width=\"12\" stroke-linecap=\"round\"></path><circle cx=\"88\" cy=\"12\" r=\"9.5\" fill=\"#c8902f\"></circle><circle cx=\"12\" cy=\"88\" r=\"9.5\" fill=\"#c8902f\"></circle><circle cx=\"50\" cy=\"50\" r=\"9.5\" fill=\"#c8902f\"></circle></g></svg>",
    "footMark": "<svg viewBox=\"0 0 100 100\" width=\"22\" height=\"22\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><g fill=\"none\"><path d=\"M88 12 C5 12 5 50 50 50 C95 50 95 88 12 88\" stroke=\"#9a89b5\" stroke-width=\"12\" stroke-linecap=\"round\"></path><circle cx=\"88\" cy=\"12\" r=\"9.5\" fill=\"#e0b463\"></circle><circle cx=\"12\" cy=\"88\" r=\"9.5\" fill=\"#e0b463\"></circle><circle cx=\"50\" cy=\"50\" r=\"9.5\" fill=\"#e0b463\"></circle></g></svg>",
    "wordmark": "Storylet Studio",
    "nav": [
      {
        "label": "Storyletter",
        "href": "storyletter/overview/"
      },
      {
        "label": "Runtimes",
        "href": "play/overview/"
      },
      {
        "label": "Why Storylet Studio",
        "href": "why/"
      },
      {
        "label": "Download",
        "href": "download/"
      },
      {
        "label": "GitHub",
        "href": "https://github.com/storylet-studio/storylets"
      }
    ],
    "cta": {
      "label": "Get started",
      "href": "getting-started/"
    },
    "footNav": [
      {
        "label": "Why Storylet Studio",
        "href": "why/"
      },
      {
        "label": "Storyletter",
        "href": "storyletter/overview/"
      },
      {
        "label": "Runtimes",
        "href": "play/overview/"
      },
      {
        "label": "Download",
        "href": "download/"
      },
      {
        "label": "GitHub",
        "href": "https://github.com/storylet-studio/storylets"
      }
    ]
  },
  "downloads": {
    "repo": "storylet-studio/storylets",
    "releases": "https://github.com/storylet-studio/storylets/releases",
    "default": "storyletter",
    "sections": {
      "storyletter": {
        "kind": "release",
        "tag": "^v\\d",
        "strip": "^v",
        "whenMissing": {
          "what": "The Storyletter installers"
        },
        "rows": [
          {
            "name": "macOS",
            "sub": "Signed and notarised <code>.dmg</code>",
            "asset": "\\.dmg$",
            "label": "Download for macOS"
          },
          {
            "name": "Windows",
            "sub": "One-click installer",
            "asset": "\\.exe$",
            "label": "Download for Windows"
          },
          {
            "name": "Linux",
            "sub": "Self-contained AppImage",
            "asset": "\\.AppImage$",
            "label": "Download for Linux"
          }
        ]
      },
      "plugins": {
        "kind": "engines",
        "strip": "^play-[a-z]+-v",
        "asset": "\\.zip$",
        "label": "Download zip",
        "engines": [
          {
            "key": "js",
            "tag": "^play-js-v\\d",
            "icon": "plugin-javascript.svg",
            "name": "JavaScript",
            "sub": "Web games and apps (TypeScript or JavaScript)"
          },
          {
            "key": "unity",
            "tag": "^play-unity-v\\d",
            "icon": "plugin-unity.svg",
            "name": "Unity",
            "sub": "C# package, drop into <code>Packages/</code>"
          },
          {
            "key": "unreal",
            "tag": "^play-unreal-v\\d",
            "icon": "plugin-unreal.svg",
            "name": "Unreal",
            "sub": "C++ plugin and demo project"
          },
          {
            "key": "godot",
            "tag": "^play-godot-v\\d",
            "icon": "plugin-godot.svg",
            "name": "Godot",
            "sub": "GDScript addon for <code>addons/</code>"
          }
        ]
      },
      "cli": {
        "kind": "release",
        "tag": "^cli-v\\d",
        "strip": "^cli-v",
        "whenMissing": {
          "what": "The CLI binaries"
        },
        "rows": [
          {
            "name": "macOS (Apple silicon)",
            "sub": "One self-contained file",
            "asset": "macos-arm64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "macOS (Intel)",
            "sub": "One self-contained file",
            "asset": "macos-x64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Windows",
            "sub": "One self-contained file",
            "asset": "windows.*\\.exe$",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Linux (x64)",
            "sub": "One self-contained file",
            "asset": "linux-x64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Linux (arm64)",
            "sub": "One self-contained file",
            "asset": "linux-arm64",
            "label": "Download",
            "drop": true
          }
        ]
      },
      "village": {
        "kind": "release",
        "tag": "^village-v\\d",
        "strip": "^village-v",
        "whenMissing": {
          "keepLinks": true,
          "note": "The downloadable zip will appear here once the first release ships."
        },
        "rows": [
          {
            "name": "In your browser",
            "sub": "Playable now, nothing to install",
            "link": "village/",
            "label": "Play the Village"
          },
          {
            "name": "The zip",
            "sub": "<code>dist/</code> to open offline, <code>src/</code> to read",
            "asset": "\\.zip$",
            "label": "Download zip"
          }
        ]
      },
      "hamlet": {
        "kind": "release",
        "tag": "^hamlet-v\\d",
        "strip": "^hamlet-v",
        "whenMissing": {
          "message": "Coming with its first release, once the words are written. The Village above is playable now."
        },
        "rows": [
          {
            "name": "In your browser",
            "sub": "Playable now, nothing to install",
            "link": "hamlet/",
            "label": "Play the Hamlet"
          },
          {
            "name": "JavaScript client",
            "sub": "<code>src/</code> and <code>dist/</code>",
            "asset": "^the-hamlet-\\d[\\w.-]*\\.zip$",
            "label": "Download zip",
            "drop": true
          },
          {
            "name": "Godot project",
            "sub": "With Patter's plugin included",
            "asset": "-godot-.*\\.zip$",
            "label": "Download zip",
            "drop": true
          },
          {
            "name": "Unity project",
            "sub": "With Patter's plugin included",
            "asset": "-unity-.*\\.zip$",
            "label": "Download zip",
            "drop": true
          },
          {
            "name": "Unreal project",
            "sub": "With Patter's plugin included",
            "asset": "-unreal-.*\\.zip$",
            "label": "Download zip",
            "drop": true
          }
        ]
      }
    }
  }
};
