@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# mulberry32: a thin shim over the SHARED implementation.
#
# The algorithm lives once, in expr/ports/godot/mulberry32.gd, vendored beside
# this as expr/mulberry32.gd. This file only gives it a Storylet Engine
# identity, because Godot registers class_name project-wide and the shared
# source must not claim one.
class_name StoryletMulberry32
extends "expr/mulberry32.gd"
