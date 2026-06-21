import json
import re
from pathlib import Path

import numpy as np
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
DEPTH_PSD_PATH = ROOT / "data" / "Midori-full-depth.psd"
OUTPUT_DIR = ROOT / "generated" / "midori-full-meshes"
LAYERS_DIR = OUTPUT_DIR / "layers"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

IMAGE_WIDTH = 576
IMAGE_HEIGHT = 1280
STEP = 1


def clamp_byte(value):
    return max(0, min(255, int(round(value))))


def flatten_visible_layers(psd):
    flattened = []

    def visit(group):
        for layer in group:
            if not layer.is_visible():
                continue
            if layer.is_group():
                visit(layer)
                continue
            left, top, right, bottom = layer.bbox
            image = np.array(layer.topil())
            flattened.append(
                {
                    "name": str(layer.name or ""),
                    "left": int(left),
                    "top": int(top),
                    "width": int(right - left),
                    "height": int(bottom - top),
                    "rgba": image,
                    "mask": np.array(layer.mask.topil()) if layer.has_mask() else None,
                }
            )

    visit(psd)
    return flattened


def compute_mask_bounds(mask, width, height):
    if not np.any(mask):
        return None
    ys, xs = np.nonzero(mask.reshape(height, width))
    left = int(xs.min())
    top = int(ys.min())
    right = int(xs.max())
    bottom = int(ys.max())
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": right - left + 1,
        "height": bottom - top + 1,
    }


def local_neighbor_fill(depth, mask, width, height, passes=128):
    output = depth.copy()
    for _ in range(passes):
        changed = False
        next_output = output.copy()
        for y in range(height):
            for x in range(width):
                index = y * width + x
                if not mask[index] or output[index] > 0:
                    continue
                samples = []
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        sx = x + dx
                        sy = y + dy
                        if sx < 0 or sy < 0 or sx >= width or sy >= height:
                            continue
                        sample = output[sy * width + sx]
                        if sample > 0:
                            samples.append(int(sample))
                if samples:
                    next_output[index] = clamp_byte(np.median(samples))
                    changed = True
        output = next_output
        if not changed:
            break
    return output


def sample_nearest_positive(depth, mask, width, height, x0, y0, radius):
    best_value = 0
    best_distance = None
    for dy in range(-radius, radius + 1):
        sy = y0 + dy
        if sy < 0 or sy >= height:
            continue
        for dx in range(-radius, radius + 1):
            sx = x0 + dx
            if sx < 0 or sx >= width:
                continue
            index = sy * width + sx
            if not mask[index] or depth[index] <= 0:
                continue
            distance = dx * dx + dy * dy
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_value = int(depth[index])
    return best_value


def multiscale_fill(depth, mask, width, height):
    output = depth.copy()
    pending = np.flatnonzero(mask & (output <= 0))
    for radius in (3, 7, 15, 31, 63):
        if not len(pending):
            break
        next_pending = []
        for index in pending:
            x = int(index % width)
            y = int(index // width)
            value = sample_nearest_positive(output, mask, width, height, x, y, radius)
            if value > 0:
                output[index] = value
            else:
                next_pending.append(int(index))
        pending = np.array(next_pending, dtype=np.int64)
    return output


def smooth_masked_depth(depth, mask, width, height, passes=2):
    kernel = (
        (-1, -1, 1),
        (0, -1, 2),
        (1, -1, 1),
        (-1, 0, 2),
        (0, 0, 4),
        (1, 0, 2),
        (-1, 1, 1),
        (0, 1, 2),
        (1, 1, 1),
    )
    output = depth.copy()
    for _ in range(passes):
        next_output = output.copy()
        for y in range(height):
            for x in range(width):
                index = y * width + x
                if not mask[index] or output[index] <= 0:
                    continue
                weighted_sum = 0
                total_weight = 0
                for dx, dy, weight in kernel:
                    sx = x + dx
                    sy = y + dy
                    if sx < 0 or sy < 0 or sx >= width or sy >= height:
                        continue
                    sample_index = sy * width + sx
                    if not mask[sample_index] or output[sample_index] <= 0:
                        continue
                    weighted_sum += int(output[sample_index]) * weight
                    total_weight += weight
                if total_weight > 0:
                    next_output[index] = clamp_byte(weighted_sum / total_weight)
        output = next_output
    return output


def compute_distance_from_contour(mask, width, height):
    total = width * height
    distances = np.full(total, -1, dtype=np.int16)
    queue = np.empty(total, dtype=np.int32)
    head = 0
    tail = 0
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if not mask[index]:
                continue
            is_contour = False
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                sx = x + dx
                sy = y + dy
                if sx < 0 or sy < 0 or sx >= width or sy >= height or not mask[sy * width + sx]:
                    is_contour = True
                    break
            if is_contour:
                distances[index] = 0
                queue[tail] = index
                tail += 1
    while head < tail:
        index = int(queue[head])
        head += 1
        x = index % width
        y = index // width
        next_distance = distances[index] + 1
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sx = x + dx
            sy = y + dy
            if sx < 0 or sy < 0 or sx >= width or sy >= height:
                continue
            sample_index = sy * width + sx
            if not mask[sample_index] or distances[sample_index] >= 0:
                continue
            distances[sample_index] = next_distance
            queue[tail] = sample_index
            tail += 1
    return distances


def classify_layer_thickness(name):
    label = name.lower()
    if "finger" in label or "string" in label or "eyelash" in label or "eyebrow" in label or "eye light" in label:
        return (2, 4)
    if "lip" in label or "teeth" in label or "tongue" in label or "iris" in label or "sclera" in label or "eyelid" in label or "eylid" in label:
        return (3, 6)
    if "ear" in label or "nose" in label:
        return (4, 9)
    if "bang" in label or "hair" in label or "tail" in label:
        return (5, 18)
    if "ribbon" in label or "belt" in label or "skirt" in label or "hood" in label or "jacket" in label or "sleeve" in label:
        return (6, 14)
    if "boot" in label or "leg" in label or "arm" in label or "palm" in label or "thumb" in label:
        return (8, 18)
    if "face" in label or "body" in label or "breast" in label or "neck" in label:
        return (10, 24)
    return (6, 12)


def estimate_back_depth(front_depth, mask, layer_name, width, height):
    distances = compute_distance_from_contour(mask, width, height)
    max_distance = int(distances.max()) if distances.size else 0
    min_thickness, max_thickness = classify_layer_thickness(layer_name)
    back_depth = front_depth.copy()
    inferred_pixels = 0
    for index in range(width * height):
        if not mask[index] or front_depth[index] <= 0:
            continue
        depth_ratio = distances[index] / max(1, max_distance)
        thickness = min_thickness + (max_thickness - min_thickness) * depth_ratio
        next_depth = clamp_byte(int(front_depth[index]) - thickness)
        if next_depth < 1:
            next_depth = 1
        if next_depth < back_depth[index]:
            back_depth[index] = next_depth
            inferred_pixels += 1
    back_depth = smooth_masked_depth(back_depth, mask, width, height, passes=1)
    return back_depth, inferred_pixels


def classify_topology(name):
    label = name.lower()
    if re.search(r"(bang|side[\s_:]*hair)", label):
        return "hair_sheet"
    if re.search(r"(eye light|eyelash|eyebrow|jwerly|deco|string|ribbon)", label):
        return "thin_sheet"
    if re.search(r"(iris|sclera|eyelid|eylid|teeth|tongue|mouth inner|lip)", label):
        return "visible_only"
    if re.search(r"(hood|jacket|skirt|belt|sleeve)", label):
        return "cloth_surface"
    return "closed_volume"


def sample_masked_depth(depth_map, mask, width, height, global_left, global_top, global_x, global_y, max_radius=8):
    local_x = int(round(global_x - global_left))
    local_y = int(round(global_y - global_top))
    best = 0
    best_distance = None
    for radius in range(max_radius + 1):
        for dy in range(-radius, radius + 1):
            sy = local_y + dy
            if sy < 0 or sy >= height:
                continue
            for dx in range(-radius, radius + 1):
                sx = local_x + dx
                if sx < 0 or sx >= width:
                    continue
                index = sy * width + sx
                if not mask[index] or depth_map[index] <= 0:
                    continue
                distance = dx * dx + dy * dy
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    best = int(depth_map[index])
        if best_distance is not None:
            return best
    return 0


def build_head_model(layers):
    lookup = {layer["name"]: layer for layer in layers}
    back_head = lookup.get("Back Head")
    face = lookup.get("Face") or lookup.get("Face2")
    face2 = lookup.get("Face2") or face
    if not back_head or not face:
        return None
    left = min(back_head["left"], face["left"])
    top = min(back_head["top"], face["top"])
    right = max(back_head["left"] + back_head["width"], face["left"] + face["width"])
    bottom = max(back_head["top"] + back_head["height"], face["top"] + face["height"])
    face_values = face["final_depth"][face["final_depth"] > 0]
    back_values = back_head["final_depth"][back_head["final_depth"] > 0]
    return {
        "cx": (left + right) * 0.5,
        "cy": (top + bottom) * 0.5,
        "rx": (right - left) * 0.5,
        "ry": (bottom - top) * 0.5,
        "top": top,
        "left": left,
        "right": right,
        "bottom": bottom,
        "face": face,
        "face2": face2,
        "back_head": back_head,
        "face_mean_depth": int(round(face_values.mean())) if len(face_values) else 140,
        "back_mean_depth": int(round(back_values.mean())) if len(back_values) else 40,
    }


def ellipse_top_y(head_model, global_x):
    if not head_model:
        return 0.0
    tx = max(-0.98, min(0.98, (global_x - head_model["cx"]) / max(1e-6, head_model["rx"])))
    return head_model["cy"] - head_model["ry"] * np.sqrt(max(0.0, 1.0 - tx * tx))


def ellipse_side_x(head_model, global_y, side):
    if not head_model:
        return 0.0
    ty = max(-0.98, min(0.98, (global_y - head_model["cy"]) / max(1e-6, head_model["ry"])))
    offset = head_model["rx"] * np.sqrt(max(0.0, 1.0 - ty * ty))
    return head_model["cx"] - offset if side == "left" else head_model["cx"] + offset


def sample_head_front_depth(head_model, global_x, global_y):
    if not head_model:
        return 140
    for key in ("face", "face2"):
        layer = head_model.get(key)
        if not layer:
            continue
        value = sample_masked_depth(
            layer["final_depth"],
            layer["mask"],
            layer["width"],
            layer["height"],
            layer["left"],
            layer["top"],
            global_x,
            global_y,
            max_radius=6,
        )
        if value > 0:
            return value
    return head_model["face_mean_depth"]


def sample_head_back_depth(head_model, global_x, global_y):
    if not head_model:
        return 40
    layer = head_model["back_head"]
    value = sample_masked_depth(
        layer["final_depth"],
        layer["mask"],
        layer["width"],
        layer["height"],
        layer["left"],
        layer["top"],
        global_x,
        global_y,
        max_radius=10,
    )
    return value if value > 0 else head_model["back_mean_depth"]


def is_single_symmetry_layer(name):
    return re.search(r"(?:^|[\s_:#-])(face|body|torso|chest|breast)(?:$|[\s_:#-])", name, re.IGNORECASE) is not None


def parse_paired_symmetry_name(name):
    if re.search(r"(?:^|::|\b)(l|left)(?:$|::|\b)", name, re.IGNORECASE):
        side = "left"
    elif re.search(r"(?:^|::|\b)(r|right)(?:$|::|\b)", name, re.IGNORECASE):
        side = "right"
    else:
        return None
    key = re.sub(r"(?:^|::|\b)(l|left|r|right)(?:$|::|\b)", "::", name, flags=re.IGNORECASE)
    key = re.sub(r":+", "::", key).strip(" :").lower()
    return {"side": side, "key": key}


def symmetrize_within_layer(depth, mask, width, height):
    bounds = compute_mask_bounds(mask, width, height)
    if not bounds:
        return depth
    output = depth.copy()
    axis_x = bounds["left"] + (bounds["width"] - 1) * 0.5
    for y in range(bounds["top"], bounds["top"] + bounds["height"]):
        for x in range(bounds["left"], bounds["left"] + bounds["width"]):
            mirror_x = int(round(axis_x + (axis_x - x)))
            if mirror_x < bounds["left"] or mirror_x >= bounds["left"] + bounds["width"] or mirror_x < x:
                continue
            left_index = y * width + x
            right_index = y * width + mirror_x
            left_masked = bool(mask[left_index])
            right_masked = bool(mask[right_index])
            if not left_masked and not right_masked:
                continue
            left_depth = int(output[left_index]) if left_masked else 0
            right_depth = int(output[right_index]) if right_masked else 0
            if left_masked and right_masked and left_depth > 0 and right_depth > 0:
                averaged = clamp_byte((left_depth + right_depth) * 0.5)
                output[left_index] = averaged
                output[right_index] = averaged
            elif left_masked and right_masked:
                propagated = left_depth or right_depth
                if propagated > 0:
                    output[left_index] = propagated
                    output[right_index] = propagated
    return output


def symmetrize_pair(left_layer, right_layer):
    left_bounds = compute_mask_bounds(left_layer["mask"], left_layer["width"], left_layer["height"])
    right_bounds = compute_mask_bounds(right_layer["mask"], right_layer["width"], right_layer["height"])
    if not left_bounds or not right_bounds:
        return
    axis_x = (
        left_layer["left"] + left_bounds["left"] + left_layer["left"] + left_bounds["right"]
        + right_layer["left"] + right_bounds["left"] + right_layer["left"] + right_bounds["right"]
    ) * 0.25
    next_left = left_layer["filled_depth"].copy()
    next_right = right_layer["filled_depth"].copy()
    for global_y in range(left_layer["top"] + left_bounds["top"], left_layer["top"] + left_bounds["bottom"] + 1):
        for global_x in range(left_layer["left"] + left_bounds["left"], left_layer["left"] + left_bounds["right"] + 1):
            left_local_x = global_x - left_layer["left"]
            left_local_y = global_y - left_layer["top"]
            if not (0 <= left_local_x < left_layer["width"] and 0 <= left_local_y < left_layer["height"]):
                continue
            left_index = left_local_y * left_layer["width"] + left_local_x
            if not left_layer["mask"][left_index]:
                continue
            mirror_x = int(round(axis_x + (axis_x - global_x)))
            right_local_x = mirror_x - right_layer["left"]
            right_local_y = global_y - right_layer["top"]
            if not (0 <= right_local_x < right_layer["width"] and 0 <= right_local_y < right_layer["height"]):
                continue
            right_index = right_local_y * right_layer["width"] + right_local_x
            if not right_layer["mask"][right_index]:
                continue
            left_depth = int(next_left[left_index])
            right_depth = int(next_right[right_index])
            if left_depth > 0 and right_depth > 0:
                averaged = clamp_byte((left_depth + right_depth) * 0.5)
                next_left[left_index] = averaged
                next_right[right_index] = averaged
            elif left_depth > 0 or right_depth > 0:
                propagated = left_depth or right_depth
                next_left[left_index] = propagated
                next_right[right_index] = propagated
    left_layer["filled_depth"] = next_left
    right_layer["filled_depth"] = next_right


def apply_occlusion_limits(layers):
    upper_limit = np.full(IMAGE_WIDTH * IMAGE_HEIGHT, 256, dtype=np.int16)
    for layer in reversed(layers):
        final_depth = layer["filled_depth"].copy()
        mask = layer["mask"]
        direct_mask = layer["direct_mask"]
        for y in range(layer["height"]):
            global_y = layer["top"] + y
            if global_y < 0 or global_y >= IMAGE_HEIGHT:
                continue
            for x in range(layer["width"]):
                global_x = layer["left"] + x
                if global_x < 0 or global_x >= IMAGE_WIDTH:
                    continue
                local_index = y * layer["width"] + x
                if not mask[local_index] or final_depth[local_index] <= 0:
                    continue
                global_index = global_y * IMAGE_WIDTH + global_x
                if not direct_mask[local_index] and upper_limit[global_index] <= 255:
                    final_depth[local_index] = min(final_depth[local_index], max(1, upper_limit[global_index] - 1))
                upper_limit[global_index] = min(upper_limit[global_index], int(final_depth[local_index]))
        layer["final_depth"] = final_depth
        layer["inferred_mask"] = (mask & (direct_mask == 0) & (final_depth > 0)).astype(np.uint8)
        if layer["topology"] in ("closed_volume", "cloth_surface"):
            back_depth, shell_pixels = estimate_back_depth(final_depth, mask, layer["name"], layer["width"], layer["height"])
            layer["back_depth"] = back_depth
            layer["shell_inferred_pixels"] = shell_pixels
        else:
            layer["back_depth"] = None
            layer["shell_inferred_pixels"] = 0


def sanitize_filename(index, path_name):
    cleaned = re.sub(r"[^\w]+", "_", path_name, flags=re.UNICODE).strip("_")
    if not cleaned:
        cleaned = f"Layer_{index + 1}"
    return f"{index + 1:03d}-{cleaned}.json"


def append_vertex(vertices, uvs, global_x, global_y, depth_byte, layer):
    global_u = global_x / max(1, IMAGE_WIDTH - 1)
    global_v = global_y / max(1, IMAGE_HEIGHT - 1)
    sx = global_u - 0.5
    sy = 0.5 - global_v
    local_x = global_x - layer["left"]
    local_y = global_y - layer["top"]
    u = max(0.0, min(1.0, (local_x + 0.5) / max(1, layer["width"])))
    v = 1.0 - max(0.0, min(1.0, (local_y + 0.5) / max(1, layer["height"])))
    index = len(vertices)
    vertices.append([round(float(sx), 6), round(float(sy), 6), round(float(-(depth_byte / 255.0)), 6)])
    uvs.append([round(float(u), 6), round(float(v), 6)])
    return index


def append_strip_faces(faces, ring_a, ring_b, flip=False):
    count = min(len(ring_a), len(ring_b))
    for i in range(count - 1):
        a0 = int(ring_a[i])
        a1 = int(ring_a[i + 1])
        b0 = int(ring_b[i])
        b1 = int(ring_b[i + 1])
        if flip:
            faces.append([a0, b0, a1])
            faces.append([a1, b0, b1])
        else:
            faces.append([a0, a1, b0])
            faces.append([a1, b1, b0])


def build_visible_surface(layer):
    width = layer["width"]
    height = layer["height"]
    front_depth = layer["final_depth"]
    render_mask = (layer["mask"] & (front_depth > 0)).astype(np.uint8)
    vertices = []
    uvs = []
    faces = []
    front_index_map = np.full(width * height, -1, dtype=np.int32)

    for y in range(height):
        for x in range(width):
            local_index = y * width + x
            if not render_mask[local_index]:
                continue
            global_x = layer["left"] + x
            global_y = layer["top"] + y
            front_index_map[local_index] = append_vertex(vertices, uvs, global_x, global_y, int(front_depth[local_index]), layer)

    for y in range(height - 1):
        row = y * width
        next_row = (y + 1) * width
        for x in range(width - 1):
            a_local = row + x
            b_local = a_local + 1
            c_local = next_row + x
            d_local = c_local + 1
            if not (render_mask[a_local] and render_mask[b_local] and render_mask[c_local] and render_mask[d_local]):
                continue
            af = int(front_index_map[a_local])
            bf = int(front_index_map[b_local])
            cf = int(front_index_map[c_local])
            df = int(front_index_map[d_local])
            faces.append([af, cf, bf])
            faces.append([bf, cf, df])

    return {
        "vertices": vertices,
        "uvs": uvs,
        "faces": faces,
        "render_mask": render_mask,
        "front_index_map": front_index_map,
    }


def extract_top_seam(layer):
    mask_2d = layer["mask"].reshape(layer["height"], layer["width"])
    seam = []
    for x in range(layer["width"]):
        ys = np.where(mask_2d[:, x] > 0)[0]
        if len(ys):
            seam.append(int(ys[0] * layer["width"] + x))
    return seam


def extract_inner_side_seam(layer, head_model):
    mask_2d = layer["mask"].reshape(layer["height"], layer["width"])
    seam = []
    for y in range(layer["height"]):
        xs = np.where(mask_2d[y] > 0)[0]
        if not len(xs):
            continue
        left_global = layer["left"] + int(xs[0])
        right_global = layer["left"] + int(xs[-1])
        chosen = int(xs[0]) if abs(left_global - head_model["cx"]) < abs(right_global - head_model["cx"]) else int(xs[-1])
        seam.append(int(y * layer["width"] + chosen))
    return seam


def infer_bang_sheet(layer, head_model, surface):
    seam = extract_top_seam(layer)
    seam = [index for index in seam if surface["front_index_map"][index] >= 0]
    if len(seam) < 2:
        return {"inferred_vertices": 0, "hidden_depth_range": None}
    vertices = surface["vertices"]
    uvs = surface["uvs"]
    faces = surface["faces"]
    rings = []
    hidden_depths = []
    ring_count = 6
    for _ in range(ring_count):
        rings.append([])
    for local_index in seam:
        local_x = local_index % layer["width"]
        local_y = local_index // layer["width"]
        global_x = layer["left"] + local_x
        global_y = layer["top"] + local_y
        visible_depth = int(layer["final_depth"][local_index])
        anchor_x = head_model["cx"] + (global_x - head_model["cx"]) * 0.8
        anchor_y = min(global_y - 2.0, ellipse_top_y(head_model, anchor_x) + 4.0)
        crown_x = head_model["cx"] + (global_x - head_model["cx"]) * 0.55
        crown_y = ellipse_top_y(head_model, crown_x) - 2.0
        target_depth = sample_head_back_depth(head_model, crown_x, crown_y)
        for ring_index in range(ring_count):
            t = (ring_index + 1) / ring_count
            ease = t * t * (3.0 - 2.0 * t)
            mid_x = global_x * (1.0 - ease) + anchor_x * ease
            mid_y = global_y * (1.0 - ease) + anchor_y * ease
            next_x = mid_x * (1.0 - 0.35 * ease) + crown_x * (0.35 * ease)
            next_y = mid_y * (1.0 - 0.55 * ease) + crown_y * (0.55 * ease)
            depth = clamp_byte(visible_depth * (1.0 - ease) + target_depth * ease)
            rings[ring_index].append(append_vertex(vertices, uvs, next_x, next_y, depth, layer))
            hidden_depths.append(depth)
    seam_vertices = [int(surface["front_index_map"][index]) for index in seam]
    append_strip_faces(faces, seam_vertices, rings[0], flip=False)
    for ring_index in range(ring_count - 1):
        append_strip_faces(faces, rings[ring_index], rings[ring_index + 1], flip=False)
    inferred_vertices = sum(len(ring) for ring in rings)
    return {"inferred_vertices": inferred_vertices, "hidden_depth_range": [int(min(hidden_depths)), int(max(hidden_depths))]}


def infer_side_hair_sheet(layer, head_model, surface):
    seam = extract_inner_side_seam(layer, head_model)
    seam = [index for index in seam if surface["front_index_map"][index] >= 0]
    if len(seam) < 2:
        return {"inferred_vertices": 0, "hidden_depth_range": None}
    vertices = surface["vertices"]
    uvs = surface["uvs"]
    faces = surface["faces"]
    average_x = sum((layer["left"] + (index % layer["width"])) for index in seam) / max(1, len(seam))
    side = "left" if average_x < head_model["cx"] else "right"
    rings = []
    hidden_depths = []
    ring_count = 5
    for _ in range(ring_count):
        rings.append([])
    for local_index in seam:
        local_x = local_index % layer["width"]
        local_y = local_index // layer["width"]
        global_x = layer["left"] + local_x
        global_y = layer["top"] + local_y
        visible_depth = int(layer["final_depth"][local_index])
        scalp_x = ellipse_side_x(head_model, global_y, side)
        scalp_y = global_y - 4.0
        crown_x = scalp_x + (-8.0 if side == "left" else 8.0)
        crown_y = scalp_y - 6.0
        target_depth = sample_head_back_depth(head_model, crown_x, crown_y)
        for ring_index in range(ring_count):
            t = (ring_index + 1) / ring_count
            ease = t * t * (3.0 - 2.0 * t)
            next_x = global_x * (1.0 - ease) + crown_x * ease
            next_y = global_y * (1.0 - ease) + crown_y * ease
            depth = clamp_byte(visible_depth * (1.0 - ease) + target_depth * ease)
            rings[ring_index].append(append_vertex(vertices, uvs, next_x, next_y, depth, layer))
            hidden_depths.append(depth)
    seam_vertices = [int(surface["front_index_map"][index]) for index in seam]
    append_strip_faces(faces, seam_vertices, rings[0], flip=(side == "right"))
    for ring_index in range(ring_count - 1):
        append_strip_faces(faces, rings[ring_index], rings[ring_index + 1], flip=(side == "right"))
    inferred_vertices = sum(len(ring) for ring in rings)
    return {"inferred_vertices": inferred_vertices, "hidden_depth_range": [int(min(hidden_depths)), int(max(hidden_depths))]}


def compute_column_extents(mask, width, height):
    top = np.full(width, -1, dtype=np.int32)
    bottom = np.full(width, -1, dtype=np.int32)
    mask_2d = mask.reshape(height, width)
    for x in range(width):
        ys = np.where(mask_2d[:, x] > 0)[0]
        if len(ys):
            top[x] = int(ys[0])
            bottom[x] = int(ys[-1])
    return top, bottom


def compute_row_extents(mask, width, height):
    left = np.full(height, -1, dtype=np.int32)
    right = np.full(height, -1, dtype=np.int32)
    mask_2d = mask.reshape(height, width)
    for y in range(height):
        xs = np.where(mask_2d[y] > 0)[0]
        if len(xs):
            left[y] = int(xs[0])
            right[y] = int(xs[-1])
    return left, right


def add_deformed_hidden_surface(layer, head_model, surface, compute_hidden_vertex):
    width = layer["width"]
    height = layer["height"]
    render_mask = surface["render_mask"]
    visible_map = surface["front_index_map"]
    vertices = surface["vertices"]
    uvs = surface["uvs"]
    faces = surface["faces"]
    hidden_map = np.full(width * height, -1, dtype=np.int32)
    hidden_depths = []

    for y in range(height):
        for x in range(width):
            local_index = y * width + x
            if not render_mask[local_index]:
                continue
            global_x = layer["left"] + x
            global_y = layer["top"] + y
            visible_depth = int(layer["final_depth"][local_index])
            hidden = compute_hidden_vertex(local_index, x, y, global_x, global_y, visible_depth)
            if hidden is None:
                continue
            hx, hy, hdepth = hidden
            hidden_map[local_index] = append_vertex(vertices, uvs, hx, hy, hdepth, layer)
            hidden_depths.append(int(hdepth))

    for y in range(height - 1):
        row = y * width
        next_row = (y + 1) * width
        for x in range(width - 1):
            a = row + x
            b = a + 1
            c = next_row + x
            d = c + 1
            if hidden_map[a] < 0 or hidden_map[b] < 0 or hidden_map[c] < 0 or hidden_map[d] < 0:
                continue
            ah = int(hidden_map[a])
            bh = int(hidden_map[b])
            ch = int(hidden_map[c])
            dh = int(hidden_map[d])
            faces.append([ah, bh, ch])
            faces.append([bh, dh, ch])

    for y in range(height):
        for x in range(width):
            current = y * width + x
            if render_mask[current] == 0 or hidden_map[current] < 0:
                continue
            if x + 1 >= width or render_mask[current + 1] == 0:
                if y + 1 < height and render_mask[current + width] and hidden_map[current + width] >= 0:
                    vf0 = int(visible_map[current])
                    vh0 = int(hidden_map[current])
                    vf1 = int(visible_map[current + width])
                    vh1 = int(hidden_map[current + width])
                    faces.append([vf0, vh0, vf1])
                    faces.append([vf1, vh0, vh1])
            if y + 1 >= height or render_mask[current + width] == 0:
                if x + 1 < width and render_mask[current + 1] and hidden_map[current + 1] >= 0:
                    vf0 = int(visible_map[current])
                    vh0 = int(hidden_map[current])
                    vf1 = int(visible_map[current + 1])
                    vh1 = int(hidden_map[current + 1])
                    faces.append([vf0, vf1, vh0])
                    faces.append([vf1, vh1, vh0])
            if x == 0 or render_mask[current - 1] == 0:
                if y + 1 < height and render_mask[current + width] and hidden_map[current + width] >= 0:
                    vf0 = int(visible_map[current])
                    vh0 = int(hidden_map[current])
                    vf1 = int(visible_map[current + width])
                    vh1 = int(hidden_map[current + width])
                    faces.append([vf0, vf1, vh0])
                    faces.append([vf1, vh1, vh0])
            if y == 0 or render_mask[current - width] == 0:
                if x + 1 < width and render_mask[current + 1] and hidden_map[current + 1] >= 0:
                    vf0 = int(visible_map[current])
                    vh0 = int(hidden_map[current])
                    vf1 = int(visible_map[current + 1])
                    vh1 = int(hidden_map[current + 1])
                    faces.append([vf0, vh0, vf1])
                    faces.append([vf1, vh0, vh1])

    return {
        "hidden_map": hidden_map,
        "inferred_vertices": int(np.count_nonzero(hidden_map >= 0)),
        "hidden_depth_range": [int(min(hidden_depths)), int(max(hidden_depths))] if hidden_depths else None,
    }


def build_hair_sheet_mesh(layer, head_model):
    surface = build_visible_surface(layer)
    hidden_ranges = []
    inferred_vertices = 0
    if re.search(r"bang", layer["name"], re.IGNORECASE):
        top_by_x, bottom_by_x = compute_column_extents(layer["mask"], layer["width"], layer["height"])

        def compute_bang_hidden(local_index, x, y, global_x, global_y, visible_depth):
            col_top = int(top_by_x[x])
            col_bottom = int(bottom_by_x[x])
            if col_top < 0 or col_bottom <= col_top:
                return None
            strand_t = (y - col_top) / max(1, col_bottom - col_top)
            root_t = 1.0 - strand_t
            xy_weight = max(0.12, min(1.0, 0.12 + 0.88 * (root_t ** 0.72)))
            depth_weight = max(0.22, min(1.0, 0.22 + 0.78 * (root_t ** 0.5)))
            dx = global_x - head_model["cx"]
            side_sign = -1.0 if dx < 0 else 1.0
            edge_weight = min(1.0, abs(dx) / max(1.0, head_model["rx"]))
            outward_pixels = (10.0 + head_model["rx"] * 0.2) * ((0.2 + 0.8 * edge_weight) ** 1.1)
            target_x = global_x + side_sign * outward_pixels
            sample_x = max(head_model["left"] + 6.0, min(head_model["right"] - 6.0, target_x))
            scalp_y = ellipse_top_y(head_model, sample_x) + 1.5 + 6.0 * strand_t
            target_depth = sample_head_back_depth(head_model, sample_x, scalp_y)
            hair_depth = clamp_byte(max(head_model["back_mean_depth"] + 16.0, target_depth - 10.0 + 22.0 * strand_t))
            hidden_x = global_x * (1.0 - xy_weight) + target_x * xy_weight
            hidden_y = global_y * (1.0 - xy_weight) + scalp_y * xy_weight
            hidden_depth = clamp_byte(visible_depth * (1.0 - depth_weight) + hair_depth * depth_weight)
            return hidden_x, hidden_y, hidden_depth

        result = add_deformed_hidden_surface(layer, head_model, surface, compute_bang_hidden)
        inferred_vertices += result["inferred_vertices"]
        if result["hidden_depth_range"]:
            hidden_ranges.append(result["hidden_depth_range"])

    if re.search(r"side[\s_:]*hair", layer["name"], re.IGNORECASE):
        left_by_y, right_by_y = compute_row_extents(layer["mask"], layer["width"], layer["height"])
        layer_center = layer["left"] + layer["width"] * 0.5
        side = "left" if layer_center < head_model["cx"] else "right"

        def compute_side_hidden(local_index, x, y, global_x, global_y, visible_depth):
            row_left = int(left_by_y[y])
            row_right = int(right_by_y[y])
            if row_left < 0 or row_right <= row_left:
                return None
            inner_x = row_right if side == "left" else row_left
            outer_x = row_left if side == "left" else row_right
            seam_t = abs(x - inner_x) / max(1, abs(outer_x - inner_x))
            vertical_t = y / max(1, layer["height"] - 1)
            wrap_weight = max(0.28, min(1.0, 0.28 + 0.72 * (((1.0 - seam_t) ** 0.7) * 0.75 + ((1.0 - vertical_t) ** 0.85) * 0.25)))
            side_offset = -10.0 if side == "left" else 10.0
            target_x = ellipse_side_x(head_model, global_y, side) + side_offset
            target_y = global_y - 10.0 * (1.0 - vertical_t) - 6.0
            target_depth = sample_head_back_depth(head_model, target_x, target_y)
            hair_depth = clamp_byte(target_depth + 10.0 + 12.0 * vertical_t)
            hidden_x = global_x * (1.0 - wrap_weight) + target_x * wrap_weight
            hidden_y = global_y * (1.0 - wrap_weight) + target_y * wrap_weight
            hidden_depth = clamp_byte(visible_depth * (1.0 - wrap_weight) + hair_depth * wrap_weight)
            return hidden_x, hidden_y, hidden_depth

        result = add_deformed_hidden_surface(layer, head_model, surface, compute_side_hidden)
        inferred_vertices += result["inferred_vertices"]
        if result["hidden_depth_range"]:
            hidden_ranges.append(result["hidden_depth_range"])

    if not hidden_ranges:
        front_values = layer["final_depth"][layer["final_depth"] > 0]
        hidden_range = [int(front_values.min()), int(front_values.max())] if len(front_values) else [0, 0]
    else:
        hidden_range = [min(item[0] for item in hidden_ranges), max(item[1] for item in hidden_ranges)]
    return {
        "mesh": {
            "step": STEP,
            "vertices": surface["vertices"],
            "uvs": surface["uvs"],
            "faces": surface["faces"],
        },
        "render_mask": surface["render_mask"],
        "inferred_pixels": inferred_vertices,
        "back_depth_range": hidden_range,
    }


def build_closed_volume_mesh(layer):
    width = layer["width"]
    height = layer["height"]
    front_depth = layer["final_depth"]
    back_depth = layer["back_depth"]
    render_mask = (layer["mask"] & (front_depth > 0) & (back_depth > 0)).astype(np.uint8)
    vertices = []
    uvs = []
    faces = []
    front_index_map = np.full(width * height, -1, dtype=np.int32)
    back_index_map = np.full(width * height, -1, dtype=np.int32)

    for y in range(height):
        for x in range(width):
            local_index = y * width + x
            if not render_mask[local_index]:
                continue
            global_x = layer["left"] + x
            global_y = layer["top"] + y
            front_index_map[local_index] = append_vertex(vertices, uvs, global_x, global_y, int(front_depth[local_index]), layer)
            back_index_map[local_index] = append_vertex(vertices, uvs, global_x, global_y, int(back_depth[local_index]), layer)

    for y in range(height - 1):
        row = y * width
        next_row = (y + 1) * width
        for x in range(width - 1):
            a_local = row + x
            b_local = a_local + 1
            c_local = next_row + x
            d_local = c_local + 1
            if not (render_mask[a_local] and render_mask[b_local] and render_mask[c_local] and render_mask[d_local]):
                continue
            af = int(front_index_map[a_local])
            bf = int(front_index_map[b_local])
            cf = int(front_index_map[c_local])
            df = int(front_index_map[d_local])
            ab = int(back_index_map[a_local])
            bb = int(back_index_map[b_local])
            cb = int(back_index_map[c_local])
            db = int(back_index_map[d_local])
            faces.append([af, cf, bf])
            faces.append([bf, cf, df])
            faces.append([ab, bb, cb])
            faces.append([bb, db, cb])

    for y in range(height):
        for x in range(width):
            current = y * width + x
            if not render_mask[current]:
                continue
            if x + 1 >= width or not render_mask[current + 1]:
                top_front = int(front_index_map[current])
                top_back = int(back_index_map[current])
                if y + 1 < height and render_mask[current + width]:
                    bottom_front = int(front_index_map[current + width])
                    bottom_back = int(back_index_map[current + width])
                    faces.append([top_front, top_back, bottom_front])
                    faces.append([bottom_front, top_back, bottom_back])
            if y + 1 >= height or not render_mask[current + width]:
                left_front = int(front_index_map[current])
                left_back = int(back_index_map[current])
                if x + 1 < width and render_mask[current + 1]:
                    right_front = int(front_index_map[current + 1])
                    right_back = int(back_index_map[current + 1])
                    faces.append([left_front, right_front, left_back])
                    faces.append([right_front, right_back, left_back])
            if x == 0 or not render_mask[current - 1]:
                top_front = int(front_index_map[current])
                top_back = int(back_index_map[current])
                if y + 1 < height and render_mask[current + width]:
                    bottom_front = int(front_index_map[current + width])
                    bottom_back = int(back_index_map[current + width])
                    faces.append([top_front, bottom_front, top_back])
                    faces.append([bottom_front, bottom_back, top_back])
            if y == 0 or not render_mask[current - width]:
                left_front = int(front_index_map[current])
                left_back = int(back_index_map[current])
                if x + 1 < width and render_mask[current + 1]:
                    right_front = int(front_index_map[current + 1])
                    right_back = int(back_index_map[current + 1])
                    faces.append([left_front, left_back, right_front])
                    faces.append([right_front, left_back, right_back])

    back_values = back_depth[back_depth > 0]
    return {
        "mesh": {
            "step": STEP,
            "vertices": vertices,
            "uvs": uvs,
            "faces": faces,
        },
        "render_mask": render_mask,
        "inferred_pixels": int(layer.get("shell_inferred_pixels", 0)),
        "back_depth_range": [int(back_values.min()), int(back_values.max())] if len(back_values) else [0, 0],
    }


def build_visible_only_mesh(layer):
    surface = build_visible_surface(layer)
    front_values = layer["final_depth"][layer["final_depth"] > 0]
    return {
        "mesh": {
            "step": STEP,
            "vertices": surface["vertices"],
            "uvs": surface["uvs"],
            "faces": surface["faces"],
        },
        "render_mask": surface["render_mask"],
        "inferred_pixels": 0,
        "back_depth_range": [int(front_values.min()), int(front_values.max())] if len(front_values) else [0, 0],
    }


def build_mesh(layer, head_model):
    topology = layer["topology"]
    if topology == "hair_sheet":
        return build_hair_sheet_mesh(layer, head_model)
    if topology in ("visible_only", "thin_sheet"):
        return build_visible_only_mesh(layer)
    return build_closed_volume_mesh(layer)


def generate():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)

    depth_psd = PSDImage.open(DEPTH_PSD_PATH)
    depth_layers = flatten_visible_layers(depth_psd)
    if depth_psd.size != (IMAGE_WIDTH, IMAGE_HEIGHT):
        raise ValueError(f"Unexpected depth PSD size: {depth_psd.size}")

    prepared = []
    pair_groups = {}

    for index, depth_layer in enumerate(depth_layers):
        rgba = depth_layer["rgba"]
        if depth_layer["mask"] is not None:
            mask = (depth_layer["mask"].reshape(-1) > 127).astype(np.uint8)
        else:
            mask = (rgba[..., 3].reshape(-1) > 0).astype(np.uint8)
        grayscale = rgba[..., 0].reshape(-1).astype(np.uint8)
        direct_mask = (mask & (grayscale > 0)).astype(np.uint8)
        direct_depth = (grayscale * direct_mask).astype(np.uint8)
        filled = local_neighbor_fill(direct_depth, mask, depth_layer["width"], depth_layer["height"])
        filled = multiscale_fill(filled, mask, depth_layer["width"], depth_layer["height"])
        entry = {
            "index": index,
            "name": depth_layer["name"].replace("\x00", ""),
            "left": depth_layer["left"],
            "top": depth_layer["top"],
            "width": depth_layer["width"],
            "height": depth_layer["height"],
            "topology": classify_topology(depth_layer["name"].replace("\x00", "")),
            "mask": mask,
            "direct_mask": direct_mask,
            "direct_depth": direct_depth,
            "filled_depth": filled,
        }
        if is_single_symmetry_layer(entry["name"]):
            entry["filled_depth"] = symmetrize_within_layer(entry["filled_depth"], mask, depth_layer["width"], depth_layer["height"])
        side_info = parse_paired_symmetry_name(entry["name"])
        if side_info:
            group = pair_groups.setdefault(side_info["key"], {})
            group[side_info["side"]] = entry
        prepared.append(entry)

    for group in pair_groups.values():
        if "left" in group and "right" in group:
            symmetrize_pair(group["left"], group["right"])

    for entry in prepared:
        entry["filled_depth"] = local_neighbor_fill(entry["filled_depth"], entry["mask"], entry["width"], entry["height"], passes=64)
        entry["filled_depth"] = multiscale_fill(entry["filled_depth"], entry["mask"], entry["width"], entry["height"])
        entry["filled_depth"] = smooth_masked_depth(entry["filled_depth"], entry["mask"], entry["width"], entry["height"])

    apply_occlusion_limits(prepared)
    head_model = build_head_model(prepared)

    manifest_layers = []
    total_vertices = 0
    total_faces = 0

    for entry in prepared:
        filename = sanitize_filename(entry["index"], entry["name"])
        mesh_result = build_mesh(entry, head_model)
        final_depth = entry["final_depth"]
        direct_values = entry["direct_depth"][entry["direct_depth"] > 0]
        layer_json = {
            "name": entry["name"],
            "index": entry["index"],
            "bounds": {
                "left": entry["left"],
                "top": entry["top"],
                "right": entry["left"] + entry["width"],
                "bottom": entry["top"] + entry["height"],
                "width": entry["width"],
                "height": entry["height"],
            },
            "pixelStats": {
                "opaquePixels": int(entry["mask"].sum()),
                "frontDepthRange": [
                    int(direct_values.min()) if len(direct_values) else 0,
                    int(direct_values.max()) if len(direct_values) else 0,
                ],
                "backDepthRange": mesh_result["back_depth_range"],
                "source": DEPTH_PSD_PATH.name,
                "profile": entry["topology"],
                "frontLocked": True,
                "inferredPixels": int(entry["inferred_mask"].sum()) + int(mesh_result["inferred_pixels"]),
            },
            "mesh": mesh_result["mesh"],
        }
        (LAYERS_DIR / filename).write_text(json.dumps(layer_json, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        manifest_layers.append(
            {
                "index": entry["index"],
                "name": entry["name"],
                "path": f"layers/{filename}",
            }
        )
        total_vertices += len(mesh_result["mesh"]["vertices"])
        total_faces += len(mesh_result["mesh"]["faces"])

    manifest = {
        "source": DEPTH_PSD_PATH.name,
        "method": "visible_front_locked_with_topology_specific_occlusion_inference",
        "imageWidth": IMAGE_WIDTH,
        "imageHeight": IMAGE_HEIGHT,
        "layerCount": len(manifest_layers),
        "vertexCount": total_vertices,
        "faceCount": total_faces,
        "layers": manifest_layers,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    generate()
