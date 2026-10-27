#!/usr/bin/env python3
"""Bounds-checked GoldSrc MDLv10 to JSON/PNG converter (Python standard library).

Reads data only. All copyrighted inputs AND derived outputs must stay local/ignored.
Schema reference: Valve HLSDK studio.h; no SDK implementation is incorporated.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'public/assets/weapons'
IDS = 'glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249 knife hegrenade flashbang smokegrenade c4 shield'.split()


class MDLError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise MDLError(message)


class Reader:
    def __init__(self, data):
        require(244 <= len(data) <= 16 * 1024 * 1024, 'Invalid MDL file size')
        self.data = data
        require(self.unpack('4si', 0) == (b'IDST', 10), 'Expected IDST version 10')
        require(self.i(72) == len(data), 'Header length must equal actual bytes')

    def span(self, offset, size):
        require(isinstance(offset, int) and offset >= 0 and size >= 0 and offset + size <= len(self.data), f'Out-of-bounds span {offset}+{size}/{len(self.data)}')
        return self.data[offset:offset + size]

    def unpack(self, fmt, offset):
        size = struct.calcsize('<' + fmt)
        values = struct.unpack('<' + fmt, self.span(offset, size))
        require(all(not isinstance(x, float) or math.isfinite(x) for x in values), 'Non-finite MDL number')
        return values

    def i(self, offset):
        return self.unpack('i', offset)[0]

    def name(self, offset, size):
        return self.span(offset, size).split(b'\0', 1)[0].decode('ascii', 'replace')

    def table(self, count, offset, stride, limit=65536):
        require(0 <= count <= limit, f'Invalid table count {count}')
        require(not count or offset >= 244, 'Table overlaps MDL header')
        self.span(offset, count * stride)
        return range(offset, offset + count * stride, stride)


def png_rgba(width, height, pixels):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    scanlines = b''.join(b'\0' + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b'')


def decode_channel(r, offset, frames):
    """Return int16 samples and frame boundaries where GoldSrc holds position.

    A run is (valid,total) bytes followed by valid signed shorts. Remaining
    samples repeat its last value. Zero-length/invalid runs are rejected.
    """
    values, hold = [], []
    while len(values) < frames:
        valid, total = r.unpack('BB', offset)
        require(0 < valid <= total, 'Invalid animation RLE run')
        samples = list(r.unpack(f'{valid}h', offset + 2))
        # StudioCalcBonePosition holds the final explicit sample even when
        # valid==total; rotation interpolation crosses that run boundary.
        hold.append(len(values) + valid - 1)
        values.extend(samples + [samples[-1]] * (total - valid))
        offset += (valid + 1) * 2
    return {'values': values[:frames], 'positionHold': [i for i in hold if i < frames - 1]}


def convert(data, weapon, source):
    r = Reader(data)
    bones = []
    controller_count = r.i(148)
    for off in r.table(r.i(140), r.i(144), 112, 128):
        parent, flags = r.unpack('2i', off + 32)
        controllers = list(r.unpack('6i', off + 40))
        require(-1 <= parent < len(bones), 'Bone hierarchy must be parent-first and acyclic')
        require(all(-1 <= c < controller_count for c in controllers), 'Invalid bone controller reference')
        bones.append({'name': r.name(off, 32), 'parent': parent, 'flags': flags, 'controllers': controllers,
                      'value': list(r.unpack('6f', off + 64)), 'scale': list(r.unpack('6f', off + 88))})
    require(bones, 'No bones')
    controllers = []
    for off in r.table(controller_count, r.i(152), 24, 32):
        bone, kind, start, end, rest, index = r.unpack('iiffii', off)
        require(-1 <= bone < len(bones) and 0 <= rest <= 255, 'Invalid bone controller')
        controllers.append({'bone': bone, 'type': kind, 'start': start, 'end': end, 'rest': rest, 'index': index})

    textures, pngs = [], {}
    pixel_budget = 0
    for index, off in enumerate(r.table(r.i(180), r.i(184), 80, 256)):
        flags, width, height, pixels_offset = r.unpack('4i', off + 64)
        require(0 < width <= 4096 and 0 < height <= 4096, 'Invalid texture dimensions')
        pixel_budget += width * height
        require(pixel_budget <= 16 * 1024 * 1024, 'Texture pixel budget exceeded')
        indices = r.span(pixels_offset, width * height)
        palette = r.span(pixels_offset + width * height, 768)
        rgba = bytes(component for value in indices for component in (*palette[value * 3:value * 3 + 3], 0 if flags & 64 and value == 255 else 255))
        file = f'texture-{index}.png'
        png = png_rgba(width, height, rgba)
        pngs[file] = png
        textures.append({'name': r.name(off, 64), 'flags': flags, 'width': width, 'height': height, 'file': file,
                         'sha256': hashlib.sha256(png).hexdigest(), 'paletteSHA256': hashlib.sha256(palette).hexdigest()})
    require(textures, 'External texture companion MDL is unsupported; supply an embedded-texture viewmodel')
    skinrefs, families = r.i(192), r.i(196)
    require(0 < skinrefs <= 256 and 0 < families <= 256, 'Invalid skin table dimensions')
    r.table(skinrefs * families, r.i(200), 2)
    skins = [list(r.unpack(f'{skinrefs}h', r.i(200) + i * skinrefs * 2)) for i in range(families)]
    require(all(0 <= t < len(textures) for row in skins for t in row), 'Skin references missing texture')

    bodyparts, meshes = [], []
    source_vertices = source_normals = total_triangles = 0
    corner_budget = 0
    for body_index, off in enumerate(r.table(r.i(204), r.i(208), 76, 32)):
        count, base, model_offset = r.unpack('3i', off + 64)
        require(count > 0 and base > 0, 'Invalid bodypart count/base')
        part = {'name': r.name(off, 64), 'base': base, 'models': []}
        for model_index, mo in enumerate(r.table(count, model_offset, 112, 32)):
            mesh_count, mesh_offset, nv, vb_offset, v_offset, nn, nb_offset, n_offset = r.unpack('8i', mo + 72)
            r.table(nv, v_offset, 12, 65536)
            r.table(nn, n_offset, 12, 65536)
            vb, nb = r.span(vb_offset, nv), r.span(nb_offset, nn)
            require(all(b < len(bones) for b in vb + nb), 'Invalid vertex/normal bone')
            verts = [r.unpack('3f', v_offset + i * 12) for i in range(nv)]
            norms = [r.unpack('3f', n_offset + i * 12) for i in range(nn)]
            source_vertices += nv
            source_normals += nn
            model = {'name': r.name(mo, 64), 'meshIndices': [], 'sourceVertices': nv, 'sourceNormals': nn}
            for me in r.table(mesh_count, mesh_offset, 20, 256):
                ntris, cursor, skinref, _, _ = r.unpack('5i', me)
                require(0 <= ntris <= 20000 and 0 <= skinref < skinrefs, 'Invalid mesh triangle count/skinref')
                geometry = {'bodypart': body_index, 'model': model_index, 'skinref': skinref,
                            'positions': [], 'normals': [], 'vertexBones': [], 'normalBones': [], 'uvPixels': [], 'indices': []}
                lookup = {}
                commands = triangles = 0
                while True:
                    command = r.unpack('h', cursor)[0]
                    cursor += 2
                    if command == 0:
                        break
                    count = abs(command)
                    require(3 <= count <= 32767 and commands < 20000, 'Invalid or excessive triangle commands')
                    commands += 1
                    corners = []
                    for ci in range(count):
                        vi, ni, s, t = key = r.unpack('4h', cursor + ci * 8)
                        require(0 <= vi < nv and 0 <= ni < nn, 'Triangle vertex/normal out of range')
                        if key not in lookup:
                            corner_budget += 1
                            require(corner_budget <= 1000000, 'Geometry budget exceeded')
                            lookup[key] = len(lookup)
                            geometry['positions'].extend(verts[vi])
                            geometry['normals'].extend(norms[ni])
                            geometry['vertexBones'].append(vb[vi])
                            geometry['normalBones'].append(nb[ni])
                            geometry['uvPixels'].extend((s, t))
                        corners.append(lookup[key])
                    cursor += count * 8
                    for ci in range(2, count):
                        # GL_TRIANGLE_STRIP alternates winding; negative is GL_TRIANGLE_FAN.
                        tri = (corners[0], corners[ci - 1], corners[ci]) if command < 0 else ((corners[ci - 2], corners[ci - 1], corners[ci]) if ci % 2 == 0 else (corners[ci - 1], corners[ci - 2], corners[ci]))
                        # Stock studio commands use clockwise outward faces.
                        # Convert to Three's CCW convention, preserving topology.
                        geometry['indices'].extend((tri[0], tri[2], tri[1]))
                        triangles += 1
                    require(triangles <= ntris, 'Triangle commands exceed declared count')
                require(triangles == ntris, 'Triangle command count differs from mesh header')
                total_triangles += triangles
                require(total_triangles <= 200000, 'Total triangle budget exceeded')
                geometry['triangleCommands'] = commands
                model['meshIndices'].append(len(meshes))
                meshes.append(geometry)
            part['models'].append(model)
        bodyparts.append(part)
    require(meshes and total_triangles, 'No mesh triangles')

    attachments = []
    for off in r.table(r.i(212), r.i(216), 88, 64):
        bone = r.i(off + 36)
        require(0 <= bone < len(bones), 'Invalid attachment bone')
        attachments.append({'name': r.name(off, 32), 'bone': bone, 'origin': list(r.unpack('3f', off + 40)), 'vectors': list(r.unpack('9f', off + 52))})

    sequences, warnings = [], []
    r.table(r.i(172), r.i(176), 104, 32)
    sample_budget = 0
    for off in r.table(r.i(164), r.i(168), 176, 2048):
        fps, flags, activity, weight, event_count, event_offset, frames = r.unpack('f6i', off + 32)
        blends, anim_offset, seqgroup = r.i(off + 120), r.i(off + 124), r.i(off + 156)
        require(0 < frames <= 10000 and 0 < fps <= 1000 and 0 < blends <= 16, 'Invalid sequence frames/fps/blends')
        require(0 <= seqgroup < r.i(172), 'Invalid sequence group')
        motiontype, motionbone = r.unpack('2i', off + 68)
        require(0 <= motionbone < len(bones), 'Invalid motion bone')
        sequence = {'name': r.name(off, 32), 'fps': fps, 'flags': flags, 'activity': activity, 'activityWeight': weight,
                    'frames': frames, 'blendCount': blends, 'sequenceGroup': seqgroup, 'motionType': motiontype, 'motionBone': motionbone,
                    'linearMovement': list(r.unpack('3f', off + 76)), 'events': [], 'tracks': None}
        for ev in r.table(event_count, event_offset, 76, 1024):
            frame, event, kind = r.unpack('3i', ev)
            sequence['events'].append({'frame': frame, 'event': event, 'type': kind, 'options': r.name(ev + 12, 64)})
        if seqgroup != 0:
            warnings.append(f'{sequence["name"]}: external sequence group {seqgroup} not imported')
        else:
            r.table(len(bones) * blends, anim_offset, 12, 2048)
            # All fetched stock viewmodels use one blend. Preserve metadata and
            # explicitly decline blend interpolation if a different asset needs it.
            tracks = []
            for bi in range(len(bones)):
                ao = anim_offset + bi * 12
                offsets = r.unpack('6H', ao)
                channels = []
                for relative in offsets:
                    if relative:
                        sample_budget += frames
                        require(sample_budget <= 16000000, 'Animation sample budget exceeded')
                        channels.append(decode_channel(r, ao + relative, frames))
                    else:
                        channels.append(None)
                tracks.append(channels)
            sequence['tracks'] = tracks
            if blends != 1:
                warnings.append(f'{sequence["name"]}: only first of {blends} blends imported')
        sequences.append(sequence)
    if controllers:
        warnings.append('Runtime uses bone controller rest values; gameplay controller input is not wired')
    if any(t['flags'] & 2 for t in textures):
        warnings.append('Chrome texture flag retained; camera-dependent GoldSrc chrome UV generation is not reproduced')
    if any(t['flags'] & 16 for t in textures):
        warnings.append('Legacy STUDIO_NF_ALPHA material flag retained but not emulated')
    available = sum(s['tracks'] is not None for s in sequences)
    metadata = {'id': weapon, 'source': 'original-mdl', 'sourceSHA256': hashlib.sha256(data).hexdigest(),
                'sourceURL': source.get('url'), 'sourceBytes': len(data), 'retailHashVerified': source.get('retailHashVerified', False),
                'sourceAuthenticity': 'Public mirror MDLv10; not authenticated against licensed retail files',
                'animationSupport': 'embedded-sequences' if available else 'bind-pose-only',
                'importedSequences': available, 'totalSequences': len(sequences), 'warnings': warnings,
                'counts': {'bones': len(bones), 'bodyparts': len(bodyparts), 'meshes': len(meshes), 'sourceVertices': source_vertices,
                           'sourceNormals': source_normals, 'renderVertices': corner_budget, 'triangles': total_triangles, 'textures': len(textures), 'animationSamples': sample_budget}}
    if weapon == 'shield':
        metadata['representation'] = 'Original shield + knife combination viewmodel; CS has no standalone shield viewmodel'
    result = {'schema': 'goldsrc-viewmodel-v1', 'metadata': metadata, 'coordinateSystem': 'Unmodified GoldSrc bone-local coordinates; radians; original pixel S/T; triangle winding converted CW to CCW',
              'bones': bones, 'controllers': controllers, 'textures': textures, 'skins': skins, 'bodyparts': bodyparts,
              'meshes': meshes, 'attachments': attachments, 'sequences': sequences}
    return result, pngs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--ids', nargs='+', choices=IDS, default=IDS)
    args = parser.parse_args()
    sources = json.loads((args.root / 'sources.json').read_text())
    manifest_file = args.root / 'manifest.json'
    manifest = json.loads(manifest_file.read_text()) if manifest_file.exists() else {'schema': 'goldsrc-viewmodels-v1', 'weapons': {}}
    manifest['rights'] = 'Private validation only; source and derived assets are not licensed for redistribution.'
    failed = False
    for weapon in args.ids:
        try:
            entry = sources['assets'][weapon]
            path = (args.root / entry['file']).resolve()
            require(path.is_relative_to(args.root.resolve()), 'Source path escapes asset root')
            data = path.read_bytes()
            require(hashlib.sha256(data).hexdigest() == entry['sha256'], 'Source manifest SHA256 mismatch')
            model, pngs = convert(data, weapon, entry)
            directory = args.root / weapon
            directory.mkdir(parents=True, exist_ok=True)
            for name, png in pngs.items():
                (directory / name).write_bytes(png)
            output = json.dumps(model, separators=(',', ':'), allow_nan=False).encode()
            (directory / 'model.json').write_bytes(output)
            manifest['weapons'][weapon] = {**model['metadata'], 'file': f'{weapon}/model.json', 'convertedSHA256': hashlib.sha256(output).hexdigest()}
            print(weapon, json.dumps(model['metadata']['counts']), flush=True)
        except (OSError, ValueError, KeyError) as error:
            failed = True
            manifest['weapons'][weapon] = {'id': weapon, 'source': 'procedural-fallback', 'sourceSHA256': None, 'error': str(error)}
            print(weapon, 'FAILED:', error, flush=True)
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n')
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
