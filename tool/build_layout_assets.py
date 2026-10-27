"""Build HapagPamana's real-time layout asset library in Blender.

Run inside Blender. The MCP automation executes this file, saves the source
.blend, and exports one cached GLB containing named, floor-aligned prototypes.
"""
import bpy
import math
import os
from mathutils import Vector


PROJECT = r"E:\Projects\Hapag Pamana"
OUT_DIR = os.path.join(PROJECT, "Admin", "Layout Designer", "models", "layout")
BLEND_PATH = os.path.join(OUT_DIR, "hapag-layout-library.blend")
GLB_PATH = os.path.join(OUT_DIR, "hapag-layout-library.glb")


def clear_scene():
    # MCP previews may isolate assets. Unhide first so regeneration cannot
    # leave preview-hidden prototypes behind and duplicate the library.
    for obj in bpy.context.scene.objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, metallic=0.0, roughness=0.5, alpha=1.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.18 if metallic < 0.5 else 0.32
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "DITHERED"
    if emission and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.2
    return mat


def assign(obj, mat):
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(mat)
    return obj


def parent(obj, root):
    obj.parent = root
    return obj


def box(root, name, size, loc, mat, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    if bevel:
        mod = obj.modifiers.new("Soft edges", "BEVEL")
        mod.width = min(bevel, min(size) * 0.22)
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return parent(obj, root)


def cyl(root, name, radius, depth, loc, mat, vertices=20, rotation=None, radius2=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rotation or (0, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    if radius2 is not None:
        # Taper by scaling the top loop only.
        mesh = obj.data
        zs = [v.co.z for v in mesh.vertices]
        top = max(zs)
        ratio = radius2 / radius if radius else 1
        for v in mesh.vertices:
            if abs(v.co.z - top) < 1e-5:
                v.co.x *= ratio
                v.co.y *= ratio
    assign(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return parent(obj, root)


def sphere(root, name, scale, loc, mat, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return parent(obj, root)


def torus(root, name, major, minor, loc, mat, rotation=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=24,
        minor_segments=8,
        location=loc,
        rotation=rotation or (0, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return parent(obj, root)


def beam(root, name, a, b, radius, mat, vertices=10):
    a, b = Vector(a), Vector(b)
    delta = b - a
    obj = cyl(root, name, radius, delta.length, (a + b) / 2, mat, vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return obj


def root(name):
    obj = bpy.data.objects.new("ASSET_" + name, None)
    bpy.context.collection.objects.link(obj)
    obj["hp_asset"] = name
    return obj


def pleats(root_obj, width, depth, height, z, mat, count=None):
    count = count or max(5, round(width / 0.28))
    for i in range(count):
        x = -width / 2 + (i + 0.5) * width / count
        box(root_obj, f"ClothPleat_{i:02d}", (0.025, 0.035, height),
            (x, depth / 2 + 0.018, z), mat, 0.008)


def flower(root_obj, loc, scale=1.0):
    x, y, z = loc
    cyl(root_obj, "Vase", 0.055 * scale, 0.16 * scale,
        (x, y, z + 0.08 * scale), M["gold"], 16, radius2=0.038 * scale)
    for i in range(7):
        a = i * math.tau / 7
        px = x + math.cos(a) * 0.07 * scale
        py = y + math.sin(a) * 0.07 * scale
        sphere(root_obj, "Bloom", (0.055, 0.055, 0.045),
               (px, py, z + 0.20 * scale + (i % 2) * 0.025),
               M["wine"] if i % 3 == 0 else M["cream"], 12, 8)
        sphere(root_obj, "Leaf", (0.055, 0.025, 0.018),
               (x + math.cos(a) * 0.10 * scale, y + math.sin(a) * 0.10 * scale,
                z + 0.16 * scale), M["leaf"], 10, 6)


def table_round():
    r = root("round")
    cyl(r, "RoundTop", 0.75, 0.075, (0, 0, 0.75), M["wood"], 32)
    cyl(r, "LinenSkirt", 0.72, 0.69, (0, 0, 0.385), M["cloth"], 32, radius2=0.67)
    torus(r, "GoldRim", 0.72, 0.012, (0, 0, 0.79), M["gold"])
    flower(r, (0, 0, 0.80), 0.85)


def table_rect():
    r = root("rect")
    box(r, "RectTop", (1.8, 0.75, 0.075), (0, 0, 0.75), M["wood"], 0.035)
    box(r, "LinenBody", (1.74, 0.69, 0.69), (0, 0, 0.385), M["cloth"], 0.025)
    pleats(r, 1.7, 0.69, 0.62, 0.39, M["cream"])
    flower(r, (0, 0, 0.80), 0.75)


def table_cocktail():
    r = root("cocktail")
    cyl(r, "PoseurTop", 0.35, 0.055, (0, 0, 1.05), M["wood"], 28)
    cyl(r, "DrapedCloth", 0.32, 1.0, (0, 0, 0.525), M["cloth"], 24, radius2=0.20)
    torus(r, "GoldTie", 0.205, 0.018, (0, 0, 0.62), M["gold"])
    for x, y in ((-0.11, 0.05), (0.10, -0.06)):
        cyl(r, "Glass", 0.027, 0.12, (x, y, 1.135), M["glass"], 14, radius2=0.034)


def covered_chair_back(root_obj):
    """Soft upholstered slipcover with a curved profile and rounded crown."""
    rows = 20
    columns = 16
    verts = []
    faces = []
    stride = columns + 1

    # Front and rear quilted surfaces. The back gently reclines and swells like
    # a fitted fabric sleeve over a padded banquet-chair shell.
    for surface in (1.0, -1.0):
        for row in range(rows + 1):
            v = row / rows
            base_z = 0.44 + 0.64 * v
            if base_z <= 0.98:
                half_width = 0.238
            else:
                dz = base_z - 0.98
                half_width = 0.238 - (0.12 - math.sqrt(max(0.0, 0.12 ** 2 - dz ** 2)))
            centre_y = -0.19 - 0.035 * v
            for column in range(columns + 1):
                u = -1.0 + 2.0 * column / columns
                z = base_z + 0.030 * (v ** 8) * (1.0 - u * u)
                padding = 0.010 * (1.0 - u * u) * math.sin(math.pi * v)
                y = centre_y + surface * (0.041 + padding)
                verts.append((u * half_width, y, z))

    surface_size = (rows + 1) * stride
    for surface in range(2):
        base = surface * surface_size
        for row in range(rows):
            for column in range(columns):
                a = base + row * stride + column
                b = a + 1
                d = base + (row + 1) * stride + column
                c = d + 1
                faces.append((a, b, c, d) if surface == 0 else (a, d, c, b))

    # Close the upholstered shell around its four soft seams.
    rear = surface_size
    for row in range(rows):
        front_l = row * stride
        front_l2 = (row + 1) * stride
        rear_l = rear + row * stride
        rear_l2 = rear + (row + 1) * stride
        faces.append((front_l, front_l2, rear_l2, rear_l))
        front_r = front_l + columns
        front_r2 = front_l2 + columns
        rear_r = rear_l + columns
        rear_r2 = rear_l2 + columns
        faces.append((front_r, rear_r, rear_r2, front_r2))
    for column in range(columns):
        front_bottom = column
        rear_bottom = rear + column
        faces.append((front_bottom, rear_bottom, rear_bottom + 1, front_bottom + 1))
        front_top = rows * stride + column
        rear_top = rear + rows * stride + column
        faces.append((front_top, front_top + 1, rear_top + 1, rear_top))

    mesh_data = bpy.data.meshes.new("CoveredChairBackMesh")
    mesh_data.from_pydata(verts, [], faces)
    mesh_data.update()
    uv_layer = mesh_data.uv_layers.new(name="UVMap")
    for polygon in mesh_data.polygons:
        for loop_index in polygon.loop_indices:
            co = mesh_data.vertices[mesh_data.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = ((co.x + 0.25) * 8.0, (co.z - 0.44) * 8.0)
    obj = bpy.data.objects.new("PaddedRoundedCoveredBack", mesh_data)
    bpy.context.collection.objects.link(obj)
    assign(obj, M["cloth"])
    parent(obj, root_obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def covered_chair_skirt(root_obj):
    """Square floor-length cover with narrow vertical tailored gathers."""
    straight_steps = 24
    corner_steps = 8
    segments = 4 * (straight_steps + corner_steps)
    rings = 10
    pleats = 28
    verts = []
    faces = []

    def perimeter(half_x, half_y, radius):
        points = []

        def line(start, end):
            for j in range(straight_steps):
                t = j / straight_steps
                x = start[0] + (end[0] - start[0]) * t
                y = start[1] + (end[1] - start[1]) * t
                nx, ny = end[2], end[3]
                points.append((x, y, nx, ny))

        def corner(cx, cy, start_angle, end_angle):
            for j in range(corner_steps):
                t = j / corner_steps
                angle = start_angle + (end_angle - start_angle) * t
                nx, ny = math.cos(angle), math.sin(angle)
                points.append((cx + radius * nx, cy + radius * ny, nx, ny))

        line((-half_x + radius, half_y, 0, 1),
             (half_x - radius, half_y, 0, 1))
        corner(half_x - radius, half_y - radius, math.pi / 2, 0)
        line((half_x, half_y - radius, 1, 0),
             (half_x, -half_y + radius, 1, 0))
        corner(half_x - radius, -half_y + radius, 0, -math.pi / 2)
        line((half_x - radius, -half_y, 0, -1),
             (-half_x + radius, -half_y, 0, -1))
        corner(-half_x + radius, -half_y + radius, -math.pi / 2, -math.pi)
        line((-half_x, -half_y + radius, -1, 0),
             (-half_x, half_y - radius, -1, 0))
        corner(-half_x + radius, half_y - radius, math.pi, math.pi / 2)
        return points

    for ring in range(rings + 1):
        t = ring / rings
        flare = t ** 1.5
        base_x = 0.235 + 0.050 * flare
        base_y = 0.230 + 0.050 * flare
        corner_radius = 0.045 + 0.015 * flare
        amplitude = 0.003 + 0.018 * flare
        for i, (x, y, normal_x, normal_y) in enumerate(perimeter(base_x, base_y, corner_radius)):
            phase = math.tau * pleats * i / segments
            wave = amplitude * math.sin(phase)
            hem_lift = 0.010 * (t ** 8) * (0.5 + 0.5 * math.cos(phase))
            z = 0.425 * (1.0 - t) + 0.018 * t + hem_lift
            verts.append((x + wave * normal_x, y + wave * normal_y, z))
    for ring in range(rings):
        start = ring * segments
        nxt = (ring + 1) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((start + i, start + j, nxt + j, nxt + i))
    mesh_data = bpy.data.meshes.new("PleatedChairSkirtMesh")
    mesh_data.from_pydata(verts, [], faces)
    mesh_data.update()
    uv_layer = mesh_data.uv_layers.new(name="UVMap")
    for polygon in mesh_data.polygons:
        ring = polygon.index // segments
        i = polygon.index % segments
        next_u = (i + 1) / segments
        coords = (
            (i / segments * 8.0, ring / rings * 8.0),
            (next_u * 8.0, ring / rings * 8.0),
            (next_u * 8.0, (ring + 1) / rings * 8.0),
            (i / segments * 8.0, (ring + 1) / rings * 8.0),
        )
        for loop_index, uv in zip(polygon.loop_indices, coords):
            uv_layer.data[loop_index].uv = uv
    obj = bpy.data.objects.new("FloorLengthPleatedSkirt", mesh_data)
    bpy.context.collection.objects.link(obj)
    assign(obj, M["cloth"])
    parent(obj, root_obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def chair_banquet():
    r = root("chair_banquet")
    covered_chair_skirt(r)
    box(r, "CoveredSeatCushion", (0.47, 0.47, 0.085),
        (0, 0, 0.455), M["cloth"], 0.035)
    covered_chair_back(r)


def chair_chiavari():
    r = root("chair_chiavari")
    for x in (-0.16, 0.16):
        for y in (-0.16, 0.16):
            cyl(r, "TurnedLeg", 0.018, 0.46, (x, y, 0.23), M["gold"], 12, radius2=0.024)
    box(r, "SeatPad", (0.39, 0.39, 0.06), (0, 0, 0.47), M["cloth"], 0.03)
    for x in (-0.16, 0.16):
        cyl(r, "BackPost", 0.022, 0.58, (x, -0.17, 0.75), M["gold"], 12)
        sphere(r, "Finial", (0.035, 0.035, 0.035), (x, -0.17, 1.05), M["gold"], 12, 8)
    for z in (0.58, 0.69, 0.80, 0.91):
        beam(r, "BackRail", (-0.16, -0.17, z), (0.16, -0.17, z), 0.014, M["gold"], 10)
    for y in (-0.16, 0.16):
        beam(r, "SideStretcher", (-0.16, y, 0.24), (0.16, y, 0.24), 0.012, M["gold"], 8)


def chair_modern():
    r = root("chair_modern")
    for x in (-0.18, 0.18):
        for y in (-0.17, 0.17):
            beam(r, "SteelLeg", (x, y, 0.02), (x * 0.86, y * 0.92, 0.44), 0.014, M["steel"], 10)
    box(r, "ShellSeat", (0.46, 0.44, 0.07), (0, 0, 0.455), M["olive"], 0.055)
    back = box(r, "CurvedBack", (0.46, 0.055, 0.42), (0, -0.20, 0.69), M["olive"], 0.065)
    back.rotation_euler.x = math.radians(-8)


def chair_stool():
    r = root("chair_stool")
    cyl(r, "Seat", 0.18, 0.075, (0, 0, 0.76), M["wine"], 24)
    cyl(r, "Post", 0.035, 0.72, (0, 0, 0.38), M["steel"], 16, radius2=0.026)
    cyl(r, "Base", 0.21, 0.035, (0, 0, 0.018), M["steel"], 24, radius2=0.17)
    torus(r, "FootRing", 0.15, 0.014, (0, 0, 0.24), M["steel"])


def chair_executive():
    r = root("chair_executive")
    cyl(r, "Column", 0.045, 0.40, (0, 0, 0.22), M["steel"], 16)
    for i in range(5):
        a = i * math.tau / 5
        beam(r, "BaseArm", (0, 0, 0.10), (math.cos(a) * 0.28, math.sin(a) * 0.28, 0.035), 0.018, M["steel"], 10)
        cyl(r, "Caster", 0.025, 0.035, (math.cos(a) * 0.28, math.sin(a) * 0.28, 0.035), M["dark"], 12,
            rotation=(math.pi / 2, 0, 0))
    box(r, "Seat", (0.50, 0.48, 0.11), (0, 0, 0.46), M["wine"], 0.065)
    back = box(r, "HighBack", (0.50, 0.09, 0.60), (0, -0.21, 0.78), M["wine"], 0.075)
    back.rotation_euler.x = math.radians(-5)
    for x in (-0.28, 0.28):
        box(r, "ArmPost", (0.035, 0.035, 0.17), (x, -0.02, 0.56), M["dark"], 0.01)
        box(r, "ArmPad", (0.055, 0.36, 0.055), (x, -0.02, 0.65), M["dark"], 0.025)


def counter_base(r, width, depth, height=0.9, top_mat=None):
    box(r, "CounterBody", (width - 0.06, depth - 0.06, height - 0.07),
        (0, 0, (height - 0.07) / 2), M["cloth"], 0.025)
    box(r, "CounterTop", (width, depth, 0.07), (0, 0, height - 0.035), top_mat or M["wood"], 0.025)
    pleats(r, width - 0.08, depth - 0.06, height - 0.16, (height - 0.07) / 2, M["cream"])


def chafing_dish(r, x, z=0.94, scale=1.0):
    # Feet and frame.
    for dx in (-0.20, 0.20):
        for dy in (-0.12, 0.12):
            cyl(r, "ChaferLeg", 0.012, 0.15, (x + dx, dy, z + 0.075), M["steel"], 10)
    box(r, "ChaferTray", (0.50, 0.34, 0.10), (x, 0, z + 0.18), M["steel"], 0.04)
    lid = sphere(r, "DomedLid", (0.25, 0.17, 0.09), (x, 0, z + 0.28), M["steel"], 20, 10)
    # Hide lower hemisphere inside pan.
    box(r, "LidBand", (0.50, 0.34, 0.035), (x, 0, z + 0.245), M["steel"], 0.015)
    sphere(r, "LidKnob", (0.025, 0.025, 0.025), (x, 0, z + 0.38), M["gold"], 12, 8)


def buffet():
    r = root("buffet")
    counter_base(r, 4.0, 0.8, 0.90)
    for x in (-1.35, -0.45, 0.45, 1.35):
        chafing_dish(r, x)
    for i in range(6):
        cyl(r, "Plate", 0.13, 0.012, (-1.76, 0.15, 0.94 + i * 0.012), M["ceramic"], 24)


def dessert():
    r = root("dessert")
    counter_base(r, 2.0, 0.8, 0.85, M["gold"])
    cyl(r, "StandPost", 0.018, 0.48, (0, 0, 1.13), M["gold"], 12)
    for rad, z in ((0.26, 0.91), (0.20, 1.10), (0.14, 1.29)):
        cyl(r, "CakeTier", rad, 0.025, (0, 0, z), M["ceramic"], 24)
        count = max(4, round(rad * 22))
        for i in range(count):
            a = i * math.tau / count
            cyl(r, "Cupcake", 0.03, 0.045,
                (math.cos(a) * (rad - 0.055), math.sin(a) * (rad - 0.055), z + 0.032),
                M["wine"], 10, radius2=0.024)
            sphere(r, "Icing", (0.027, 0.027, 0.022),
                   (math.cos(a) * (rad - 0.055), math.sin(a) * (rad - 0.055), z + 0.066),
                   M["cream"], 10, 6)


def beverage():
    r = root("beverage")
    counter_base(r, 1.6, 0.7, 0.92, M["steel"])
    for x in (-0.38, 0.10):
        cyl(r, "DispenserBase", 0.13, 0.04, (x, 0, 0.97), M["steel"], 20, radius2=0.11)
        cyl(r, "GlassReservoir", 0.115, 0.34, (x, 0, 1.16), M["glass"], 20)
        cyl(r, "DispenserLid", 0.125, 0.04, (x, 0, 1.35), M["steel"], 20, radius2=0.115)
        beam(r, "Tap", (x, -0.10, 1.08), (x, -0.19, 1.08), 0.014, M["steel"], 10)
        cyl(r, "TapHandle", 0.016, 0.07, (x, -0.19, 1.045), M["dark"], 10)
    for i in range(5):
        cyl(r, "Cup", 0.034, 0.085, (0.56 + (i % 2) * 0.075, -0.08 + (i // 2) * 0.075, 1.005), M["ceramic"], 14, radius2=0.027)


def service():
    r = root("service")
    counter_base(r, 1.5, 0.7, 0.85)
    box(r, "ServiceTray", (0.45, 0.30, 0.035), (0.30, 0, 0.89), M["steel"], 0.025)
    for i in range(5):
        cyl(r, "Plate", 0.12, 0.012, (-0.43, 0, 0.88 + i * 0.012), M["ceramic"], 24)


def trash():
    r = root("trash")
    for x, mat in ((-0.20, M["dark"]), (0.20, M["olive"])):
        cyl(r, "WasteBin", 0.17, 0.70, (x, 0, 0.35), mat, 20, radius2=0.15)
        cyl(r, "SwingLid", 0.185, 0.055, (x, 0, 0.73), M["dark"], 20, radius2=0.17)
        box(r, "Opening", (0.21, 0.11, 0.018), (x, -0.04, 0.762), M["black"], 0.008)


def stage():
    r = root("stage")
    box(r, "StageDeck", (6.0, 3.0, 0.36), (0, 0, 0.18), M["wood"], 0.035)
    box(r, "GoldFascia", (6.0, 0.06, 0.34), (0, 1.50, 0.18), M["gold"], 0.02)
    for i in range(15):
        x = -3.0 + i * (6.0 / 14)
        cyl(r, "CurtainFold", 0.11, 3.25, (x, -1.39, 2.0), M["wine"], 12)
    box(r, "Pelmet", (6.15, 0.24, 0.25), (0, -1.38, 3.62), M["gold"], 0.055)
    box(r, "LowerStep", (2.2, 0.42, 0.13), (0, 1.70, 0.065), M["wood"], 0.025)
    box(r, "UpperStep", (2.2, 0.42, 0.26), (0, 1.34, 0.13), M["wood"], 0.025)


def dance():
    r = root("dance")
    n = 8
    tile = 5.0 / n
    for ix in range(n):
        for iy in range(n):
            mat = M["wood"] if (ix + iy) % 2 else M["wood_light"]
            box(r, "ParquetTile", (tile - 0.012, tile - 0.012, 0.045),
                (-2.5 + (ix + 0.5) * tile, -2.5 + (iy + 0.5) * tile, 0.0225), mat, 0.008)
    # Brass perimeter makes the laid dance floor read cleanly.
    for y in (-2.5, 2.5):
        box(r, "BrassEdge", (5.04, 0.025, 0.055), (0, y, 0.028), M["gold"], 0.008)
    for x in (-2.5, 2.5):
        box(r, "BrassEdge", (0.025, 5.04, 0.055), (x, 0, 0.028), M["gold"], 0.008)


def bar():
    r = root("bar")
    box(r, "BarBody", (2.4, 0.8, 1.08), (0, 0, 0.54), M["wine"], 0.045)
    box(r, "TimberTop", (2.5, 0.9, 0.08), (0, 0, 1.12), M["wood"], 0.035)
    for x in (-0.75, 0, 0.75):
        box(r, "BrassPanel", (0.025, 0.035, 0.75), (x, -0.415, 0.53), M["gold"], 0.008)
    for i in range(7):
        x = -0.90 + i * 0.30
        cyl(r, "Bottle", 0.045, 0.24, (x, 0.18, 1.28), M["olive"] if i % 2 else M["glass"], 14, radius2=0.035)
        cyl(r, "BottleNeck", 0.018, 0.10, (x, 0.18, 1.45), M["gold"], 12)


def decor():
    r = root("decor")
    cyl(r, "BrassPlanter", 0.31, 0.45, (0, 0, 0.225), M["gold"], 24, radius2=0.39)
    for i in range(13):
        a = i * 2.39996
        radius = 0.12 + (i % 4) * 0.055
        z = 0.58 + (i % 5) * 0.10
        sphere(r, "Foliage", (0.18, 0.11, 0.075),
               (math.cos(a) * radius, math.sin(a) * radius, z), M["leaf"], 12, 7)
    for i in range(5):
        a = i * math.tau / 5
        sphere(r, "Bloom", (0.075, 0.075, 0.06),
               (math.cos(a) * 0.24, math.sin(a) * 0.24, 0.92 + (i % 2) * 0.08),
               M["cream"] if i % 2 else M["wine"], 12, 8)


def dj():
    r = root("dj")
    box(r, "Booth", (1.8, 0.9, 0.92), (0, 0, 0.46), M["dark"], 0.045)
    box(r, "GoldFront", (1.76, 0.035, 0.34), (0, -0.465, 0.65), M["gold"], 0.02)
    box(r, "Controller", (0.82, 0.42, 0.07), (0, -0.02, 0.975), M["black"], 0.025)
    for x in (-0.22, 0.22):
        cyl(r, "JogWheel", 0.105, 0.025, (x, -0.02, 1.025), M["steel"], 24)
    for x in (-0.12, 0, 0.12):
        box(r, "Fader", (0.018, 0.13, 0.015), (x, -0.02, 1.025), M["gold"], 0.006)
    for x in (-0.58, 0.58):
        screen_obj = box(r, "Monitor", (0.34, 0.035, 0.22), (x, 0.10, 1.12), M["screen"], 0.02)
        screen_obj.rotation_euler.x = math.radians(-18)


def speaker():
    r = root("speaker")
    for i in range(3):
        a = i * math.tau / 3
        beam(r, "TripodLeg", (0, 0, 0.45), (math.cos(a) * 0.23, math.sin(a) * 0.23, 0.02), 0.014, M["dark"], 10)
    cyl(r, "Pole", 0.024, 1.48, (0, 0, 0.78), M["dark"], 12)
    box(r, "SpeakerCabinet", (0.34, 0.29, 0.52), (0, -0.01, 1.68), M["black"], 0.045)
    # Front faces -Y, matching other assets' public side.
    for z, radius in ((1.59, 0.105), (1.80, 0.065)):
        cyl(r, "Driver", radius, 0.018, (0, -0.165, z), M["dark"], 24,
            rotation=(math.pi / 2, 0, 0))
        torus(r, "DriverRing", radius, 0.010, (0, -0.176, z), M["steel"], rotation=(math.pi / 2, 0, 0))


def screen():
    r = root("screen")
    box(r, "LEDPanel", (3.0, 0.14, 2.2), (0, 0, 1.47), M["dark"], 0.035)
    box(r, "EmissiveFace", (2.88, 0.018, 2.08), (0, -0.08, 1.47), M["screen"], 0.015)
    for x in (-1.35, 1.35):
        box(r, "TrussLeg", (0.075, 0.075, 0.38), (x, 0, 0.19), M["steel"], 0.012)
        box(r, "Foot", (0.38, 0.45, 0.04), (x, 0, 0.02), M["steel"], 0.012)
    # Panel seam grid.
    for x in (-0.75, 0, 0.75):
        box(r, "PanelSeam", (0.008, 0.008, 2.04), (x, -0.092, 1.47), M["black"], 0)
    for z in (0.95, 1.47, 1.99):
        box(r, "PanelSeam", (2.84, 0.008, 0.008), (0, -0.092, z), M["black"], 0)


def photo():
    r = root("photo")
    box(r, "Backdrop", (2.0, 0.07, 2.1), (0, 0.64, 1.05), M["wine"], 0.035)
    for x in (-0.96, 0.96):
        cyl(r, "FramePost", 0.028, 2.18, (x, 0.64, 1.09), M["dark"], 12)
    beam(r, "FrameBar", (-0.96, 0.64, 2.16), (0.96, 0.64, 2.16), 0.025, M["dark"], 12)
    for i in range(11):
        t = i / 10
        x = -0.95 + t * 1.9
        z = 2.12 + math.sin(t * math.pi) * 0.14
        sphere(r, "FloralArch", (0.08, 0.06, 0.07), (x, 0.58, z),
               M["leaf"] if i % 2 else M["cream"], 12, 8)
    for i in range(3):
        a = i * math.tau / 3
        beam(r, "CameraTripod", (0, -0.48, 1.05),
             (math.cos(a) * 0.20, -0.48 + math.sin(a) * 0.20, 0.02), 0.012, M["dark"], 10)
    box(r, "Camera", (0.23, 0.16, 0.15), (0, -0.48, 1.43), M["black"], 0.025)
    cyl(r, "Lens", 0.055, 0.11, (0, -0.585, 1.43), M["dark"], 16,
        rotation=(math.pi / 2, 0, 0), radius2=0.065)


def doorway(name, width, exit_sign=False):
    r = root(name)
    for x in (-width / 2 + 0.045, width / 2 - 0.045):
        box(r, "DoorJamb", (0.09, 0.22, 2.10), (x, 0, 1.05), M["wood"], 0.015)
    box(r, "DoorHead", (width, 0.22, 0.12), (0, 0, 2.16), M["wood"], 0.018)
    box(r, "Threshold", (width, 0.24, 0.022), (0, 0, 0.011), M["gold"], 0.006)
    if exit_sign:
        box(r, "ExitSign", (0.45, 0.045, 0.18), (0, -0.13, 2.42), M["exit"] ,0.018)
        box(r, "ExitMark", (0.24, 0.015, 0.045), (0, -0.158, 2.42), M["cream"], 0.006)


def other():
    r = root("other")
    box(r, "EquipmentCase", (1.2, 1.2, 0.82), (0, 0, 0.41), M["dark"], 0.045)
    for x in (-0.56, 0.56):
        for y in (-0.56, 0.56):
            box(r, "CornerGuard", (0.08, 0.08, 0.80), (x, y, 0.41), M["steel"], 0.012)
    for z in (0.05, 0.77):
        box(r, "CaseBand", (1.16, 0.035, 0.055), (0, -0.61, z), M["steel"], 0.012)
    box(r, "Handle", (0.24, 0.04, 0.07), (0, -0.63, 0.42), M["steel"], 0.018)


def optimise_roots():
    """Merge same-finish parts per prototype to reduce browser draw calls."""
    roots = [o for o in bpy.context.scene.objects if o.name.startswith("ASSET_")]
    for asset in roots:
        groups = {}
        for obj in list(asset.children):
            if obj.type != "MESH" or not obj.data.materials:
                continue
            mat = obj.data.materials[0]
            groups.setdefault(mat.name, []).append(obj)
        for mat_name, objects in groups.items():
            if len(objects) < 2:
                objects[0].name = f"{asset.name[6:]}_{mat_name}"
                continue
            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            bpy.ops.object.join()
            joined = bpy.context.object
            joined.name = f"{asset.name[6:]}_{mat_name}"
            joined.parent = asset


def setup_scene_and_export():
    os.makedirs(OUT_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.world.color = (0.025, 0.02, 0.015)

    # glTF exports Z-up Blender coordinates as Y-up for Three.js.
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        export_apply=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_yup=True,
    )


clear_scene()
M = {
    "cloth": material("HP_Cloth", (0.93, 0.88, 0.75), roughness=0.78),
    "cream": material("HP_Cream", (0.98, 0.96, 0.89), roughness=0.72),
    "wood": material("HP_Wood", (0.30, 0.105, 0.035), roughness=0.34),
    "wood_light": material("HP_WoodLight", (0.56, 0.27, 0.08), roughness=0.38),
    "gold": material("HP_Gold", (0.72, 0.43, 0.10), metallic=0.86, roughness=0.20),
    "steel": material("HP_Steel", (0.58, 0.63, 0.68), metallic=0.92, roughness=0.25),
    "glass": material("HP_Glass", (0.75, 0.90, 0.93), roughness=0.06, alpha=0.34),
    "wine": material("HP_Wine", (0.34, 0.035, 0.045), roughness=0.58),
    "olive": material("HP_Olive", (0.20, 0.25, 0.10), roughness=0.68),
    "leaf": material("HP_Leaf", (0.11, 0.28, 0.08), roughness=0.76),
    "dark": material("HP_Dark", (0.035, 0.040, 0.050), metallic=0.08, roughness=0.68),
    "black": material("HP_Black", (0.008, 0.010, 0.013), roughness=0.82),
    "ceramic": material("HP_Ceramic", (0.93, 0.94, 0.92), roughness=0.23),
    "screen": material("HP_Screen", (0.015, 0.055, 0.095), metallic=0.28, roughness=0.18,
                       emission=(0.03, 0.22, 0.42)),
    "exit": material("HP_Exit", (0.02, 0.34, 0.12), roughness=0.38,
                     emission=(0.01, 0.16, 0.045)),
}
table_round()
table_rect()
table_cocktail()
chair_banquet()
chair_chiavari()
chair_modern()
chair_stool()
chair_executive()
buffet()
dessert()
beverage()
service()
trash()
stage()
dance()
bar()
decor()
dj()
speaker()
screen()
photo()
doorway("door", 0.9, False)
doorway("exit", 1.2, True)
other()
optimise_roots()
setup_scene_and_export()

print(f"Built {len([o for o in bpy.data.objects if o.name.startswith('ASSET_')])} prototypes")
print(f"BLEND: {BLEND_PATH}")
print(f"GLB:   {GLB_PATH}")
