---
name: najd-3d
description: Build, edit, export and render 3D models with the user's installed Blender. Use for 3D scenes, models, GLB/GLTF/FBX/OBJ files and renders.
---

# 3D with Blender

Use najd_blender_run with a short bpy script; the user approves each script.

1. New scene: `bpy.ops.wm.read_factory_settings(use_empty=True)`. Existing file: `bpy.ops.wm.open_mainfile(filepath=...)` with a path in the working folder.
2. Build with primitives and modifiers (`bpy.ops.mesh.primitive_*_add`, `obj.modifiers.new(...)`), materials with `bpy.data.materials.new` and `use_nodes = True`.
3. Add a camera and a light, set `scene.camera`, then render a preview: `scene.render.engine = "BLENDER_WORKBENCH"` (fast) or `"BLENDER_EEVEE_NEXT"` (better), small resolution first, `bpy.ops.render.render(write_still=True)` with `scene.render.filepath` in `os.getcwd()`.
4. Export what the user asked for into `os.getcwd()`: `bpy.ops.export_scene.gltf(filepath=...glb)`, `bpy.ops.wm.obj_export`, `bpy.ops.export_scene.fbx`, or `bpy.ops.wm.save_as_mainfile` for .blend.
5. Report the files the result lists; show the rendered PNG to the user. If a script fails, read the error in the result, fix the script and run it again once.

Keep each script under 4,000 characters. Do not download add-ons or run other programs from the script.
