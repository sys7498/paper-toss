"""Bake the paper in Blender 4.3. Run with blender -b -P art/render-paper.py -- OUTPUT_DIR [GROUP]."""
import bpy
import json
import math
import re
import sys
import struct
import zlib
import numpy as np
from pathlib import Path

OUTPUT = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
GROUPS = sys.argv[sys.argv.index("--") + 2:]
ROOT = Path(__file__).resolve().parents[1]
RAW = (ROOT / "dist/paper-shape.js").read_text()
COLS, ROWS = [int(re.search(r"export const " + name + r" = (\d+);", RAW)[1]) for name in ("columns", "rows")]
STAGES = json.loads(RAW.partition("export const stages = ")[2].strip().removesuffix(";"))
REST = (-.23, -.38, .15)
TURN = (1.7, 4.4, -2.3)
SURFACE = json.loads((ROOT / "dist/paper-surface.js").read_text()
                     .partition("export const openSurface = ")[2].strip().removesuffix(";"))
# Resolution, columns in the atlas, on-screen world span, and frame count.
GROUP = {
    "spin": (384, 8, 1.91, 61),
    "open": (576, 6, SURFACE["span"], 28),
    "flat": (1408, 1, SURFACE["span"], 1),
    "rest": (896, 1, 1.91, 1),
}


def opened_height(u, v):
    height = .039 * math.tanh((.82 * u + .51 * v + .1) / .092)
    for x, y, width, rise in SURFACE["corners"]:
        height += rise * math.exp(-((u - x) ** 2 + (v - y) ** 2) / width ** 2)
    for x, y, angle, length, width, rise, curve in SURFACE["creases"]:
        dx, dy = u - x, v - y
        along = dx * math.cos(angle) + dy * math.sin(angle)
        across = -dx * math.sin(angle) + dy * math.cos(angle) + curve * along ** 2
        peak = math.exp(-(across / width) ** 2)
        trough = math.exp(-((across - width) / (width * 1.4)) ** 2)
        height += rise * (peak - .42 * trough) * math.exp(-(along / length) ** 4)
    return height


COORDS = [(i % COLS / (COLS - 1), i // COLS / (ROWS - 1)) for i in range(COLS * ROWS)]
CREASES = [opened_height(u * 2 - 1, v * 2 - 1) - STAGES[0][i * 3 + 2] / 8192
           for i, (u, v) in enumerate(COORDS)]


def shape(folded, creased):
    frame = folded * (len(STAGES) - 1)
    low, high = STAGES[math.floor(frame)], STAGES[math.ceil(frame)]
    weight = frame % 1
    positions = []
    for i, ridge in enumerate(CREASES):
        x, y, z = [(low[j] + (high[j] - low[j]) * weight) / 8192 for j in range(i * 3, i * 3 + 3)]
        if creased:
            z += ridge * (1 - folded) ** 3
        positions.append((x, y, z))
    return positions


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.use_denoising = False
scene.cycles.adaptive_threshold = .09
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 2
scene.cycles.glossy_bounces = 1
scene.cycles.sample_clamp_indirect = 1.4
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

triangles = []
for y in range(ROWS - 1):
    for x in range(COLS - 1):
        a = y * COLS + x
        b, c, d = a + 1, a + COLS, a + COLS + 1
        triangles.extend(((a, b, c), (b, d, c)) if (x + y) % 2 else ((a, b, d), (a, d, c)))
mesh = bpy.data.meshes.new("One sheet")
mesh.from_pydata(shape(0, False), [], triangles)
uv = mesh.uv_layers.new(name="Sheet coordinates")
for loop in mesh.loops:
    uv.data[loop.index].uv = COORDS[loop.vertex_index]
paper = bpy.data.objects.new("Paper", mesh)
scene.collection.objects.link(paper)
for poly in mesh.polygons:
    poly.use_smooth = True

material = bpy.data.materials.new("Matte paper")
material.use_nodes = True
paper.data.materials.append(material)
tree = material.node_tree
nodes, link = tree.nodes, tree.links.new
surface = nodes.get("Principled BSDF")
surface.inputs["Roughness"].default_value = .86
surface.inputs["Specular IOR Level"].default_value = .19
texture = nodes.new("ShaderNodeTexCoord")
scale_fibers = nodes.new("ShaderNodeVectorMath")
scale_fibers.operation = "MULTIPLY"
scale_fibers.inputs[1].default_value = (2.7, 1, 1)
link(texture.outputs["UV"], scale_fibers.inputs[0])
fibers = nodes.new("ShaderNodeTexNoise")
fibers.inputs["Scale"].default_value = 174
fibers.inputs["Detail"].default_value = 2
link(scale_fibers.outputs["Vector"], fibers.inputs["Vector"])
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = .16
bump.inputs["Distance"].default_value = .012
link(fibers.outputs["Fac"], bump.inputs["Height"])
link(bump.outputs["Normal"], surface.inputs["Normal"])
color = nodes.new("ShaderNodeValToRGB")
color.color_ramp.elements[0].position = .19
color.color_ramp.elements[0].color = (.64, .61, .56, 1)
color.color_ramp.elements[1].position = .81
color.color_ramp.elements[1].color = (.87, .83, .75, 1)
link(fibers.outputs["Fac"], color.inputs[0])
link(color.outputs["Color"], surface.inputs["Base Color"])

world = bpy.data.worlds.new("Studio fill")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (.55, .58, .63, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = .24
scene.world = world


def area(name, location, power, radius, color):
    light = bpy.data.lights.new(name, "AREA")
    light.shape, light.size, light.energy, light.color = "DISK", radius, power, color
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()


area("Key", (-2.7, 4.3, 4.8), 750, 2.3, (1, .954, .87))
area("Edge", (2.5, 1.6, -2.6), 130, 2.7, (.83, .90, 1))
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(camera)
camera.location = (0, 0, 4.25)
camera.data.lens_unit = "FOV"
scene.camera = camera


def write_uv(path, vertices, rotation, size, span):
    """Rasterize front-face UVs in the same camera projection as the beauty frame."""
    xyz = np.asarray(vertices) @ np.asarray(rotation.to_matrix()).T
    camera_z = camera.location.z
    inverse_z = 1 / (camera_z - xyz[:, 2])
    screen = (xyz[:, :2] * np.array([1, -1]) *
              (camera_z / span * inverse_z[:, None]) + .5) * size
    uv = np.asarray(COORDS)
    mapped = np.zeros((size, size, 3), dtype=np.uint8)
    depth = np.zeros((size, size))
    for ids in triangles:
        a, b, c = screen[list(ids)]
        ab, ac = b - a, c - a
        determinant = ab[0] * ac[1] - ab[1] * ac[0]
        if abs(determinant) < 1e-8:
            continue
        x0, y0 = np.maximum(0, np.floor(np.minimum(np.minimum(a, b), c)).astype(int))
        x1, y1 = np.minimum(size, np.ceil(np.maximum(np.maximum(a, b), c)).astype(int))
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.ogrid[y0:y1, x0:x1]
        x, y = xx + .5 - a[0], yy + .5 - a[1]
        w1 = (x * ac[1] - y * ac[0]) / determinant
        w2 = (ab[0] * y - ab[1] * x) / determinant
        w0 = 1 - w1 - w2
        za, zb, zc = inverse_z[list(ids)]
        next_depth = w0 * za + w1 * zb + w2 * zc
        patch_depth = depth[y0:y1, x0:x1]
        selected = (w0 >= 0) & (w1 >= 0) & (w2 >= 0) & (next_depth > patch_depth)
        if not selected.any():
            continue
        patch_depth[selected] = next_depth[selected]
        patch = mapped[y0:y1, x0:x1]
        if determinant > 0:
            patch[selected] = 0
            continue
        weights = np.stack([w0[selected] * za, w1[selected] * zb, w2[selected] * zc], axis=1)
        coordinates = weights @ uv[list(ids)] / next_depth[selected, None]
        patch[selected, :2] = np.clip(np.rint(coordinates * 255), 0, 255).astype(np.uint8)
        patch[selected, 2] = 255

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    # The Sub filter encodes the smooth UV gradients as small differences.
    previous = np.zeros_like(mapped)
    previous[:, 1:] = mapped[:, :-1]
    pixels = b"".join(b"\x01" + row.tobytes() for row in mapped - previous)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
                     chunk(b"IDAT", zlib.compress(pixels, 6)) + chunk(b"IEND", b""))


def render(name, index):
    size, _, span, count = GROUP[name]
    t = index / (count - 1) if count > 1 else 0
    folded = 1 if name in ("spin", "rest") else t
    if name == "rest":
        rotation = REST
    elif name == "spin":
        rotation = [start + speed * (t * 2 - 1) for start, speed in zip(REST, TURN)]
    else:
        rotation = [flat + (rest - flat) * t for flat, rest in zip(SURFACE["rotation"], REST)]
    vertices = shape(folded, name in ("open", "flat"))
    for vertex, location in zip(mesh.vertices, vertices):
        vertex.co = location
    mesh.update()
    paper.rotation_euler = rotation
    scene.cycles.samples = 40 if count == 1 else 18
    scene.render.resolution_x = scene.render.resolution_y = size
    camera.data.angle = 2 * math.atan(span / (2 * camera.location.z))
    output = OUTPUT / name
    output.mkdir(parents=True, exist_ok=True)
    prefix = output / f"{index:03}"
    scene.render.filepath = str(prefix.with_suffix(".png"))
    bpy.ops.render.render(write_still=True)
    if name == "open":
        write_uv(output / f"{index:03}-uv.png", vertices, paper.rotation_euler, size, span)


OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / "groups.json").write_text(json.dumps(GROUP))
if GROUPS == ["sample"]:
    render("spin", 30)
    render("open", 0)
    render("open", 13)
else:
    for name in GROUPS or GROUP:
        for index in range(GROUP[name][3]):
            beauty = (OUTPUT / name / f"{index:03}.png").exists()
            mapping = (OUTPUT / name / f"{index:03}-uv.png").exists()
            if not beauty or (name == "open" and not mapping):
                render(name, index)
