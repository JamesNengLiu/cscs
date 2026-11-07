"""Prepare CPU collision from the already acquired, fixed CS2 Dust2 archive.

No downloads, global installations, render-mesh collision or gameplay changes.
Compiled PHYS shapes, interaction tags and surface-property tokens are retained.
Original and derived data belong in ignored local asset directories (ASSETS.md).
Format reference: https://github.com/ValveResourceFormat/ValveResourceFormat
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import os
import re
import struct
import subprocess
import tempfile
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
MAP_SHA1 = '7dc529cd65d843a2b8a98c297e79b9923dd70a5d'
REFERENCE_COMMIT = '7d9e6c9eb70cb3e6510415ac56e2e1ea2a355836'
SCALE = .0254
MAX_PARTS = 4096
MAX_SHAPES = 100000
MAX_MATERIALS = 65536
MAX_HULL_VERTICES = 256  # Source half-edges use one-byte vertex/edge indices.
MAX_HULL_EDGES = 256
MAX_HULL_PLANES = 256
MAX_MESH_VERTICES = 1000000
MAX_MESH_TRIANGLES = 2000000

# Region SVM and mesh acceleration nodes are not gameplay geometry. They are
# skipped without decoding their large blobs; the JS consumer builds its own BVH.
KEEP = set('''m_parts m_bindPose m_boneNames m_rnShape m_hulls m_meshes m_spheres
m_capsules m_Hull m_Mesh m_Bounds m_vMinBounds m_vMaxBounds m_vMin m_vMax
m_VertexPositions m_Vertices m_Edges m_Faces m_Planes m_Triangles m_Materials
m_nCollisionAttributeIndex m_nSurfacePropertyIndex m_nToolMaterialHash m_nFlags
m_surfacePropertyHashes m_collisionAttributes m_CollisionGroup m_CollisionGroupString
m_InteractAs m_InteractWith m_InteractExclude m_DetailLayers m_InteractAsStrings
m_InteractWithStrings m_InteractExcludeStrings m_DetailLayerStrings
m_nIncludeDetailLayerCount'''.split())


class PhysicsKV3:
    """Bounded parser for the viewer's plain KV3 dump, without eval/exec."""
    def __init__(self, text):
        marker = text.find('--- Data for block "PHYS" ---')
        if marker < 0:
            raise ValueError('The resource has no PHYS dump')
        self.text = text
        self.at = text.index('{', text.index('-->', marker) + 3)
        self.depth = 0

    def ws(self):
        text = self.text
        while self.at < len(text) and (text[self.at].isspace() or text[self.at] == ','):
            self.at += 1

    def word(self):
        self.ws()
        match = re.match(r'[^\s,\[\]{}=]+', self.text[self.at:self.at + 256])
        if not match:
            raise ValueError(f'Invalid KV3 token near {self.at}')
        self.at += len(match[0])
        return match[0]

    def value(self, keep=True):
        self.ws()
        text = self.text
        if self.depth >= 64:
            raise ValueError('KV3 nesting limit exceeded')
        if text.startswith('#[', self.at):
            begin = self.at + 2
            end = text.index(']', begin)
            self.at = end + 1
            return bytes.fromhex(text[begin:end]) if keep else None
        char = text[self.at]
        if char == '"':
            end = self.at + 1
            while True:
                end = text.index('"', end)
                slash = end - 1
                while slash >= self.at and text[slash] == '\\':
                    slash -= 1
                if (end - 1 - slash) % 2 == 0:
                    break
                end += 1
            result = json.loads(text[self.at:end + 1]) if keep else None
            self.at = end + 1
            return result
        if char == '{':
            self.at += 1
            self.depth += 1
            result = {} if keep else None
            while True:
                self.ws()
                if text[self.at] == '}':
                    self.at += 1
                    self.depth -= 1
                    return result
                key = self.word()
                self.ws()
                if text[self.at] != '=':
                    raise ValueError('Expected KV3 assignment')
                self.at += 1
                selected = keep and key in KEEP
                value = self.value(selected)
                if selected:
                    result[key] = value
        if char == '[':
            self.at += 1
            self.depth += 1
            result = [] if keep else None
            while True:
                self.ws()
                if text[self.at] == ']':
                    self.at += 1
                    self.depth -= 1
                    return result
                value = self.value(keep)
                if keep:
                    result.append(value)
        word = self.word()
        if not keep:
            return None
        if word in ('true', 'false', 'null'):
            return {'true': True, 'false': False, 'null': None}[word]
        value = float(word) if any(c in word for c in '.eE') else int(word)
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('Non-finite physics parameter')
        return value


def string_token(name):
    """Source 2 case-insensitive Murmur2 token (seed is pi)."""
    if not name:
        return 0
    data = ''.join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in name).encode('utf-8')
    h, multiplier, cursor = 0x31415926 ^ len(data), 0x5BD1E995, 0
    while cursor + 4 <= len(data):
        value = int.from_bytes(data[cursor:cursor + 4], 'little')
        value = value * multiplier & 0xFFFFFFFF
        value ^= value >> 24
        value = value * multiplier & 0xFFFFFFFF
        h = ((h * multiplier) & 0xFFFFFFFF) ^ value
        cursor += 4
    if cursor < len(data):
        h = ((h ^ int.from_bytes(data[cursor:], 'little')) * multiplier) & 0xFFFFFFFF
    h ^= h >> 13
    h = h * multiplier & 0xFFFFFFFF
    return (h ^ (h >> 15)) & 0xFFFFFFFF


def channels_for(attributes):
    """Explicit port of the pinned viewer's named static-geometry filters.

    This preserves engine tags but is not a claim to reproduce every retail
    VPhysics interaction. Audio uses ordinary solid geometry, not render PVS.
    """
    def tags_for(key):
        values = attributes.get(key, [])
        if not isinstance(values, list) or len(values) > 256 or any(not isinstance(x, str) or len(x) > 256 for x in values):
            raise ValueError('Invalid PHYS interaction tags')
        return {x.lower() for x in values}
    tags = tags_for('m_InteractAsStrings')
    excluded = tags_for('m_InteractExcludeStrings')
    if not tags or 'contents_solid' in tags:
        result = ['player', 'bullet', 'grenade', 'audio']
    else:
        result = []
        if tags.intersection({'playerclip', 'passbullets', 'window'}):
            result.append('player')
        if tags.intersection({'csgo_grenadeclip', 'passbullets', 'window'}):
            result.append('grenade')
    return [channel for channel in result if channel not in excluded]


def floats(blob, width):
    if width not in (3, 4) or not isinstance(blob, bytes) or len(blob) % (4 * width):
        raise ValueError('Invalid PHYS float blob')
    result = list(struct.iter_unpack('<' + 'f' * width, blob))
    if any(not all(math.isfinite(x) for x in row) for row in result):
        raise ValueError('Non-finite PHYS coordinate')
    return result


def world(point):
    return [point[1] * SCALE, point[2] * SCALE, point[0] * SCALE]


def bounds(vertices):
    return {'min': [min(v[i] for v in vertices) for i in range(3)],
            'max': [max(v[i] for v in vertices) for i in range(3)]}


def material_table(physics, lookup):
    hashes = physics.get('m_surfacePropertyHashes')
    if not isinstance(hashes, list) or not 0 < len(hashes) <= MAX_MATERIALS or any(type(value) is not int or not 0 <= value <= 0xFFFFFFFF for value in hashes):
        raise ValueError('Invalid PHYS surface property count or token')
    return [{'hash': f'{value:08x}', 'name': lookup.get(value),
             'source': 'verified-compiled-string-token-match' if value in lookup else 'original-phys-token-unresolved'}
            for value in physics['m_surfacePropertyHashes']]


def extract_shapes(physics, resource, lookup, prefix='world'):
    if physics.get('m_bindPose') or physics.get('m_boneNames'):
        raise ValueError('Unsupported transformed/animated PHYS aggregate')
    materials = material_table(physics, lookup)
    attrs = physics['m_collisionAttributes']
    parts = physics.get('m_parts')
    if not isinstance(parts, list) or len(parts) > MAX_PARTS:
        raise ValueError('Invalid PHYS part count')
    if not isinstance(attrs, list) or not 0 < len(attrs) <= MAX_MATERIALS or any(not isinstance(attr, dict) for attr in attrs):
        raise ValueError('Invalid PHYS collision attribute count')
    output, stats = [], Counter()
    for part_index, part in enumerate(parts):
        collection = part['m_rnShape']
        if collection.get('m_spheres') or collection.get('m_capsules'):
            raise ValueError('Unsupported sphere/capsule world shape; do not silently omit it')
        for kind in ('hulls', 'meshes'):
            descriptors = collection.get('m_' + kind, [])
            if not isinstance(descriptors, list) or len(descriptors) > MAX_SHAPES or len(output) + len(descriptors) > MAX_SHAPES:
                raise ValueError('Invalid PHYS shape count')
            for index, descriptor in enumerate(descriptors):
                collision_index = descriptor['m_nCollisionAttributeIndex']
                surface_index = descriptor['m_nSurfacePropertyIndex']
                if type(collision_index) is not int or type(surface_index) is not int or not 0 <= collision_index < len(attrs) or not 0 <= surface_index < len(materials):
                    raise ValueError('Invalid PHYS descriptor indices')
                material = materials[surface_index]
                attributes = attrs[collision_index]
                shape = {'id': f'{prefix}:{part_index}:{kind}:{index}',
                         'type': 'hull' if kind == 'hulls' else 'mesh',
                         'material': material['name'], 'materialHash': material['hash'],
                         'surfacePropertyIndex': surface_index,
                         'collisionAttributeIndex': collision_index,
                         'channels': channels_for(attributes),
                         'source': {'resource': resource, 'part': part_index, 'shape': index,
                                    'partFlags': part.get('m_nFlags', 0),
                                    'toolMaterialHash': descriptor.get('m_nToolMaterialHash', 0),
                                    'interactAs': attributes.get('m_InteractAsStrings', []),
                                    'interactExclude': attributes.get('m_InteractExcludeStrings', [])}}
                if kind == 'hulls':
                    hull = descriptor['m_Hull']
                    if not isinstance(hull.get('m_VertexPositions'), bytes) or not 4 * 12 <= len(hull['m_VertexPositions']) <= MAX_HULL_VERTICES * 12:
                        raise ValueError('Invalid PHYS hull vertex count')
                    if not isinstance(hull.get('m_Edges'), bytes) or len(hull['m_Edges']) % 4 or not 12 <= len(hull['m_Edges']) // 4 <= MAX_HULL_EDGES:
                        raise ValueError('Invalid PHYS half-edge count')
                    if not isinstance(hull.get('m_Faces'), bytes) or not 4 <= len(hull['m_Faces']) <= MAX_HULL_PLANES:
                        raise ValueError('Invalid PHYS hull face count')
                    if not isinstance(hull.get('m_Planes'), bytes) or len(hull['m_Planes']) % 16 or len(hull['m_Planes']) // 16 != len(hull['m_Faces']):
                        raise ValueError('Invalid PHYS hull plane count')
                    vertices = [world(point) for point in floats(hull['m_VertexPositions'], 3)]
                    raw_edges = list(struct.iter_unpack('<BBBB', hull['m_Edges']))
                    faces, edges = [], set()
                    for start in hull['m_Faces']:
                        cursor, face, seen = start, [], set()
                        while cursor not in seen:
                            if cursor >= len(raw_edges):
                                raise ValueError('PHYS half-edge exceeds range')
                            seen.add(cursor)
                            next_edge, twin, origin, face_index = raw_edges[cursor]
                            if origin >= len(vertices) or twin >= len(raw_edges):
                                raise ValueError('Invalid PHYS half-edge')
                            face.append(origin)
                            cursor = next_edge
                        if cursor != start or len(face) < 3:
                            raise ValueError('Invalid PHYS face loop')
                        faces.append(face)
                        for a, b in zip(face, face[1:] + face[:1]):
                            if a != b:
                                edges.add(tuple(sorted((a, b))))
                    planes = []
                    max_residual = 0.0
                    for nx, ny, nz, distance in floats(hull['m_Planes'], 4):
                        length = math.sqrt(nx * nx + ny * ny + nz * nz)
                        if not .5 < length < 1.5:
                            raise ValueError('Invalid hull plane normal')
                        plane = [ny / length, nz / length, nx / length, distance * SCALE / length]
                        residual = max(sum(v[k] * plane[k] for k in range(3)) - plane[3] for v in vertices)
                        max_residual = max(max_residual, residual)
                        if residual > .002:
                            raise ValueError('Hull plane/vertex or coordinate orientation mismatch')
                        planes.append(plane)
                    shape.update(vertices=[x for v in vertices for x in v], planes=planes,
                                 edges=[list(e) for e in sorted(edges)], faces=faces, bounds=bounds(vertices))
                    shape['source']['flags'] = hull.get('m_nFlags', 0)
                    shape['source']['maxPlaneVertexResidualMetres'] = max_residual
                    stats['hulls'] += 1
                    stats['hullFaces'] += len(planes)
                    stats['maxPlaneVertexResidualMetres'] = max(stats['maxPlaneVertexResidualMetres'], max_residual)
                else:
                    mesh = descriptor['m_Mesh']
                    if not isinstance(mesh.get('m_Vertices'), bytes) or not 3 * 12 <= len(mesh['m_Vertices']) <= MAX_MESH_VERTICES * 12:
                        raise ValueError('Invalid PHYS mesh vertex count')
                    vertices = [world(point) for point in floats(mesh['m_Vertices'], 3)]
                    blob = mesh['m_Triangles']
                    if not isinstance(blob, bytes) or len(blob) % 12 or not 1 <= len(blob) // 12 <= MAX_MESH_TRIANGLES:
                        raise ValueError('Invalid triangle index blob')
                    ids = list(struct.unpack('<' + 'I' * (len(blob) // 4), blob))
                    if any(index >= len(vertices) for index in ids):
                        raise ValueError('PHYS mesh index out of range')
                    triangle_materials = mesh['m_Materials']
                    if not isinstance(triangle_materials, list) or triangle_materials and (len(triangle_materials) != len(ids) // 3 or
                                               any(type(i) is not int or not 0 <= i < len(materials) for i in triangle_materials)):
                        raise ValueError('Invalid per-triangle material indices')
                    shape.update(vertices=[x for v in vertices for x in v], indices=ids,
                                 triangleMaterials=triangle_materials, bounds=bounds(vertices), twoSided=None)
                    shape['source'].update(flags=mesh.get('m_nFlags', 0),
                                           backfaceSemantics='not-retail-validated; preserve source winding and flags')
                    stats['meshes'] += 1
                    stats['meshTriangles'] += len(ids) // 3
                output.append(shape)
    return output, materials, dict(stats)


def import_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--map', type=Path, default=ROOT / '.local/cs2/source/game/csgo/maps/de_dust2.vpk')
    parser.add_argument('--viewer', type=Path, default=ROOT / '.local/cs2/tools/source2viewer/Source2Viewer-CLI')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/cs2-physics')
    parser.add_argument('--material-dump', type=Path, default=ROOT / '.local/cs2/textured/materials-all.txt')
    parser.add_argument('--export-nav', action='store_true')
    args = parser.parse_args()
    source, viewer, output = args.map.resolve(), args.viewer.resolve(), args.output.resolve()
    if not any(output.is_relative_to(base.resolve()) for base in
               [ROOT / 'public/assets', ROOT / '.local', Path(tempfile.gettempdir())]):
        parser.error('Derived physics data must stay in an ignored asset/local directory or temporary directory')
    if hashlib.sha1(source.read_bytes()).hexdigest() != MAP_SHA1:
        parser.error('Map differs from the pinned rendering sample')
    vpk = import_module('cs2_vpk', 'inspect-cs2-assets.py')
    entities_parser = import_module('cs2_entities', 'prepare-cs2-benchmark.py')
    resources = {e['path']: e for e in vpk.inspect_vpk(source, True)['resources']}
    # Name reversal uses only explicit PhysicsSurfaceProperties in real compiled
    # materials; unresolved tokens stay unresolved. No filename heuristics.
    names, lookup_provenance = set(), None
    if args.material_dump.is_file():
        dump = args.material_dump.read_text()
        names.update(re.findall(r'PhysicsSurfaceProperties = "([^\"]+)"', dump))
        names.update(re.findall(r'm_name = "PhysicsSurfaceProperties"\s+m_value = "([^\"]+)"', dump))
        lookup_provenance = {'fileSHA256': hashlib.sha256(args.material_dump.read_bytes()).hexdigest(),
                             'kind': 'Source2Viewer compiled VMAT dump; explicit PhysicsSurfaceProperties only'}
    lookup = {string_token(name): name.lower() for name in sorted(names)}
    # The actual compiled collision attributes also spell the string Default.
    lookup[string_token('default')] = 'default'
    env = dict(os.environ)
    env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = str(ROOT / '.local/cs2/tools/bundle')
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='cscs-cs2-physics-') as folder:
        work = Path(folder)
        def dump_resource(resource, block, destination):
            if resource not in resources:
                raise ValueError('Missing original resource ' + resource)
            original = vpk.read_entry(source, resources[resource])
            target = work / destination
            with target.open('w') as log:
                result = subprocess.run([str(viewer), '-i', str(source), '-f', resource, '-b', block],
                                        cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=120)
            if result.returncode or 'Exception:' in target.read_text():
                raise ValueError('Resource dump failed: ' + resource)
            return target.read_text(), hashlib.sha256(original).hexdigest()
        entity_resource = 'maps/de_dust2/entities/default_ents.vents_c'
        # Entity lump has a dedicated text representation, not a generic DATA dump.
        vpk.read_entry(source, resources[entity_resource])
        with (work / 'entities.log').open('w') as log:
            subprocess.run([str(viewer), '-i', str(source), '-f', entity_resource, '-d', '-o', str(work / 'entities.txt')],
                           cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        entities = entities_parser.parse_entities((work / 'entities.txt').read_text())
        resource = 'maps/de_dust2/world_physics.vmdl_c'
        text, sha = dump_resource(resource, 'PHYS', 'world.txt')
        physics = PhysicsKV3(text).value()
        shapes, materials, stats = extract_shapes(physics, resource, lookup)
        collision_attributes = physics['m_collisionAttributes']
        del physics, text
        triggers = []
        for entity in entities:
            kind = entity.get('classname')
            if kind not in ('func_bomb_target', 'func_buyzone'):
                continue
            if any(entity.get('origin', [0, 0, 0])) or any(entity.get('angles', [0, 0, 0])) or entity.get('scales', [1, 1, 1]) != [1, 1, 1]:
                raise ValueError('Unsupported non-identity trigger transform; do not guess its placement')
            model = entity['model'] + '_c'
            trigger_text, trigger_sha = dump_resource(model, 'PHYS', f'trigger-{len(triggers)}.txt')
            trigger_shapes, trigger_materials, _ = extract_shapes(PhysicsKV3(trigger_text).value(), model, lookup, f'trigger{len(triggers)}')
            for shape in trigger_shapes:
                shape['channels'] = []
            triggers.append({'id': entity.get('hammeruniqueid'), 'kind': 'bombsite' if kind == 'func_bomb_target' else 'buyzone',
                             'name': ('B' if str(entity.get('bomb_site_designation')) == '1' else 'A') if kind == 'func_bomb_target' else None,
                             'team': {2: 'T', 3: 'CT'}.get(entity.get('teamnum')),
                             'sourceEntity': entity, 'sourceSHA256': trigger_sha,
                             'materials': trigger_materials, 'shapes': trigger_shapes})
        spawns = {'T': [], 'CT': []}
        for entity in entities:
            team = {'info_player_terrorist': 'T', 'info_player_counterterrorist': 'CT'}.get(entity.get('classname'))
            if team:
                spawns[team].append({'position': world(entity['origin']), 'sourceOrigin': entity['origin'],
                                     'sourceAngles': entity.get('angles', [0, 0, 0]),
                                     'sourceId': entity.get('hammeruniqueid'),
                                     'anchor': 'original entity origin; consumer must verify feet against collision'})
        if len(spawns['T']) != 15 or len(spawns['CT']) != 15 or len(triggers) != 4:
            raise ValueError('Incomplete spawn/trigger coverage')
        data = {'schema': 'cs2-physics-v1', 'units': 'metres',
                'source': {'mapSHA1': MAP_SHA1, 'worldPhysicsResource': resource, 'worldPhysicsSHA256': sha,
                           'coordinateMapping': '(SourceY,SourceZ,SourceX)*.0254', 'materialLookup': lookup_provenance,
                           'filterReference': f'https://github.com/ValveResourceFormat/ValveResourceFormat/blob/{REFERENCE_COMMIT}/Renderer/Renderer/Rubikon.cs'},
                'collisionAttributes': collision_attributes, 'materials': materials,
                'shapes': shapes, 'triggers': triggers, 'spawns': spawns,
                'stats': stats,
                'limitations': ['Collision tag policy follows the pinned open-source viewer; not complete retail VPhysics',
                                'Unresolved surface tokens remain null, never guessed from material filenames',
                                'Mesh backface behavior is not retail-validated; source winding/flags retained',
                                'Spawn origins are original anchors; no legacy BSP eye/feet subtraction was applied']}
        encoded = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
        compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
        (output / 'physics.json.gz').write_bytes(compressed)
        manifest = {'schema': 'cs2-physics-package-v1', 'mapSHA1': MAP_SHA1, 'file': 'physics.json.gz',
                    'bytes': len(encoded), 'downloadBytes': len(compressed), 'sha256': hashlib.sha256(encoded).hexdigest(),
                    'stats': stats, 'shapes': len(shapes), 'triggers': len(triggers),
                    'spawns': {team: len(points) for team, points in spawns.items()},
                    'materialsResolved': sum(m['name'] is not None for m in materials), 'materials': len(materials)}
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        if args.export_nav:
            nav = next((name for name in resources if name.endswith('.nav')), None)
            if nav:
                original_nav = work / 'source.nav'
                original_nav.write_bytes(vpk.read_entry(source, resources[nav]))
                with (work / 'nav.log').open('w') as log:
                    subprocess.run([str(viewer), '-i', str(original_nav), '-d', '--gltf_export_format', 'gltf', '-o', str(work / 'nav.gltf')],
                                   cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
                if (work / 'nav.gltf').is_file():
                    nav_files = {}
                    for file in work.glob('nav*'):
                        if file.suffix in ('.gltf', '.bin'):
                            (output / file.name).write_bytes(file.read_bytes())
                            nav_files[file.name] = {'bytes': file.stat().st_size,
                                                   'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                    (output / 'nav-manifest.json').write_text(json.dumps({
                        'schema': 'cs2-navigation-debug-v1', 'mapSHA1': MAP_SHA1,
                        'sourceResource': nav, 'sourceSHA256': hashlib.sha256(original_nav.read_bytes()).hexdigest(),
                        'scope': 'Navigation visualization for route validation, not player/world collision',
                        'coordinates': 'Apply the glTF node matrix; POSITION accessors remain in Source units',
                        'files': nav_files}, indent=2))
        print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main()
