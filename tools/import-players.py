#!/usr/bin/env python3
"""Convert original embedded MDLv10 players/p_* models, including every blend.

Uses the unchanged, locally owned import-weapons.py geometry/palette decoder.
No source file, coordinate, bone name, palette entry or UV is modified.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import runpy

HERE = Path(__file__).resolve().parent
BASE = runpy.run_path(str(HERE / 'import-weapons.py'))
FETCH = runpy.run_path(str(HERE / 'fetch-player-assets.py'))
Reader, MDLError, require = BASE['Reader'], BASE['MDLError'], BASE['require']
ROOT, IDS, WEAPON_IDS = FETCH['ROOT'], FETCH['IDS'], FETCH['WEAPON_IDS']
MAX_SAMPLES = 16_000_000
MAX_CHANNELS = 1_000_000
MAX_OUTPUT = 256 * 1024 * 1024


def bounded_read(path, limit):
    require(path.stat().st_size <= limit, f'File exceeds {limit} byte budget')
    with path.open('rb') as handle:
        data = handle.read(limit + 1)
    require(len(data) <= limit, 'File grew beyond byte budget')
    return data


def contained(root, relative):
    require(isinstance(relative, str) and not Path(relative).is_absolute(), 'Expected relative asset path')
    path = (root / relative).resolve()
    require(path.is_relative_to(root.resolve()), 'Asset path escapes output root')
    return path


def decode_channel(reader, offset, frames):
    require(0 < frames <= 10000, 'Invalid animation frame count')
    require(offset >= 244, 'Animation overlaps header')
    return BASE['decode_channel'](reader, offset, frames)


def preflight(r):
    """Aggregate budgets are checked before the shared parser allocates geometry."""
    bones = r.i(140)
    require(0 < bones <= 128, 'Invalid bone count')
    r.table(bones, r.i(144), 112, 128)
    require(r.i(172) > 0, 'Missing sequence group table')
    groups = list(r.table(r.i(172), r.i(176), 104, 32))
    # This importer deliberately rejects external companions rather than dropping tracks.
    # The legacy group-0 data-base field is not handled by the reused geometry decoder.
    require(r.i(groups[0] + 100) == 0, 'Nonzero legacy sequence group data base is unsupported')
    samples = channels = slots = 0
    for off in r.table(r.i(164), r.i(168), 176, 2048):
        frames, blends, start = r.i(off + 56), r.i(off + 120), r.i(off + 124)
        fps = r.unpack('f', off + 32)[0]
        require(0 < frames <= 10000 and 0 < blends <= 16 and 0 < fps <= 1000,
                'Invalid sequence frames/fps/blends')
        require(r.i(off + 156) == 0, 'External sequence groups are unsupported; no partial conversion')
        slots += bones * blends * 6
        require(slots <= MAX_CHANNELS, 'Animation channel-slot budget exceeded')
        for ao in r.table(bones * blends, start, 12, 2048):
            for relative in r.unpack('6H', ao):
                if relative:
                    require(relative >= 12, 'Animation channel overlaps its descriptor')
                    r.span(ao + relative, 2)
                    channels += 1
                    samples += frames
                    require(samples <= MAX_SAMPLES, 'Animation sample budget exceeded across blends')
        require(channels <= MAX_CHANNELS, 'Animation channel budget exceeded')
        # Obsolete automove fields have no known payload layout here: never silently omit.
        require(r.i(off + 88) == 0 and r.i(off + 92) == 0, 'Obsolete automove data is unsupported')
        for pivot in r.table(r.i(off + 60), r.i(off + 64), 20, 1024):
            r.unpack('3f2i', pivot)

    vertices = normals = meshes = submodels = triangles = command_corners = 0
    for bp in r.table(r.i(204), r.i(208), 76, 32):
        count = r.i(bp + 64)
        require(0 < count <= 32, 'Invalid bodypart model count')
        for mo in r.table(count, r.i(bp + 72), 112, 32):
            submodels += 1
            nv, nn = r.i(mo + 80), r.i(mo + 92)
            require(0 <= nv <= 65536 and 0 <= nn <= 65536, 'Invalid source geometry count')
            vertices += nv
            normals += nn
            require(vertices <= 262144 and normals <= 262144 and submodels <= 256, 'Source geometry budget exceeded')
            r.unpack('f', mo + 68)
            require(r.i(mo + 104) == 0, 'Obsolete deformation groups are unsupported')
            for me in r.table(r.i(mo + 72), r.i(mo + 76), 20, 256):
                meshes += 1
                ntris, cursor = r.unpack('2i', me)
                require(0 <= ntris <= 20000 and meshes <= 1024, 'Mesh count/triangle budget exceeded')
                triangles += ntris
                require(triangles <= 200000, 'Total triangle budget exceeded')
                require(cursor >= 244, 'Triangle commands overlap header')
                seen = 0
                while True:
                    command = r.unpack('h', cursor)[0]
                    cursor += 2
                    if command == 0:
                        break
                    corners = abs(command)
                    seen += corners - 2
                    command_corners += corners
                    require(3 <= corners <= 32767 and seen <= ntris, 'Invalid triangle command count')
                    require(command_corners <= 1000000, 'Triangle command budget exceeded')
                    r.span(cursor, corners * 8)
                    cursor += corners * 8
                require(seen == ntris, 'Triangle command count differs from mesh header')
    return samples, channels


def convert(data, identity, source, asset_kind='player'):
    require(asset_kind in ('player', 'third-person-weapon'), 'Invalid asset kind')
    r = Reader(data)
    sample_count, channel_count = preflight(r)
    hitboxes = []
    for off in r.table(r.i(156), r.i(160), 32, 256):
        bone, group = r.unpack('2i', off)
        low, high = list(r.unpack('3f', off + 8)), list(r.unpack('3f', off + 20))
        require(0 <= bone < r.i(140) and 0 <= group <= 255, 'Invalid hitbox bone/group')
        require(all(a <= b for a, b in zip(low, high)), 'Inverted hitbox bounds')
        hitboxes.append({'bone': bone, 'group': group, 'min': low, 'max': high})

    result, pngs = BASE['convert'](data, identity, source)
    result['schema'] = 'goldsrc-player-v1'
    result['hitboxes'] = hitboxes
    result['sequenceGroups'] = [
        {'label': r.name(off, 32), 'name': r.name(off + 32, 64),
         'unused1': r.i(off + 96), 'dataOffset': r.i(off + 100)}
        for off in r.table(r.i(172), r.i(176), 104, 32)]
    for sequence, off in zip(result['sequences'], r.table(r.i(164), r.i(168), 176, 2048)):
        sequence.update({'blendType': list(r.unpack('2i', off + 128)),
                         'blendStart': list(r.unpack('2f', off + 136)),
                         'blendEnd': list(r.unpack('2f', off + 144)), 'blendParent': r.i(off + 152),
                         'bbMin': list(r.unpack('3f', off + 96)), 'bbMax': list(r.unpack('3f', off + 108)),
                         'entryNode': r.i(off + 160), 'exitNode': r.i(off + 164),
                         'nodeFlags': r.i(off + 168), 'nextSequence': r.i(off + 172),
                         'sourceOffset': off, 'animationOffset': r.i(off + 124),
                         'autoMovePositionOffset': r.i(off + 88), 'autoMoveAngleOffset': r.i(off + 92),
                         'pivots': []})
        for po in r.table(r.i(off + 60), r.i(off + 64), 20, 1024):
            sequence['pivots'].append({'origin': list(r.unpack('3f', po)),
                                       'start': r.i(po + 12), 'end': r.i(po + 16)})
        blend_tracks = []
        for blend in range(sequence['blendCount']):
            tracks = []
            for bone in range(len(result['bones'])):
                ao = sequence['animationOffset'] + (blend * len(result['bones']) + bone) * 12
                tracks.append([decode_channel(r, ao + relative, sequence['frames']) if relative else None
                               for relative in r.unpack('6H', ao)])
            blend_tracks.append(tracks)
        sequence['blendTracks'] = blend_tracks
        sequence['tracks'] = blend_tracks[0]

    # Keep even unused source vertices/normals, plus the original submodel metadata.
    for bodypart, off in zip(result['bodyparts'], r.table(r.i(204), r.i(208), 76, 32)):
        bodypart['sourceOffset'] = off
        for model, mo in zip(bodypart['models'], r.table(r.i(off + 64), r.i(off + 72), 112, 32)):
            nv, nn = r.i(mo + 80), r.i(mo + 92)
            model.update({'sourceOffset': mo, 'type': r.i(mo + 64), 'boundingRadius': r.unpack('f', mo + 68)[0],
                          'sourceGeometry': {'positions': list(r.unpack(f'{nv * 3}f', r.i(mo + 88))),
                                             'normals': list(r.unpack(f'{nn * 3}f', r.i(mo + 100))),
                                             'vertexBones': list(r.span(r.i(mo + 84), nv)),
                                             'normalBones': list(r.span(r.i(mo + 96), nn))}})
            for index, me in zip(model['meshIndices'], r.table(r.i(mo + 72), r.i(mo + 76), 20, 256)):
                result['meshes'][index].update({'sourceOffset': me, 'sourceNormalCount': r.i(me + 12),
                                                'sourceNormalOffset': r.i(me + 16)})
    for attachment, off in zip(result['attachments'], r.table(r.i(212), r.i(216), 88, 64)):
        attachment['type'] = r.i(off + 32)
    for texture, off in zip(result['textures'], r.table(r.i(180), r.i(184), 80, 256)):
        start = r.i(off + 76)
        pixels = r.span(start, texture['width'] * texture['height'])
        texture['paletteRGB'] = list(r.span(start + len(pixels), 768))
        texture['pixelIndicesSHA256'] = hashlib.sha256(pixels).hexdigest()
        texture['sourceOffset'] = off
        texture['sourcePixelOffset'] = start

    transition_count = r.i(236)
    require(0 <= transition_count <= 256, 'Invalid transition count')
    r.table(transition_count * transition_count, r.i(240), 1)
    result['transitions'] = [list(r.span(r.i(240) + i * transition_count, transition_count))
                             for i in range(transition_count)]
    result['sourceHeader'] = {'name': r.name(8, 64), 'version': 10, 'length': len(data),
                              'eyePosition': list(r.unpack('3f', 76)), 'min': list(r.unpack('3f', 88)),
                              'max': list(r.unpack('3f', 100)), 'bbMin': list(r.unpack('3f', 112)),
                              'bbMax': list(r.unpack('3f', 124)), 'flags': r.i(136),
                              'soundTable': r.i(220), 'soundIndex': r.i(224),
                              'soundGroups': r.i(228), 'soundGroupIndex': r.i(232)}
    heads = [{'index': index, 'name': bone['name']} for index, bone in enumerate(result['bones'])
             if 'head' in bone['name'].lower()]
    metadata = result['metadata']
    metadata.update({'id': identity, 'assetKind': asset_kind, 'provenance': source,
                     'rights': source.get('rights', FETCH['RIGHTS']), 'retailHashVerified': False,
                     'sourceModelName': result['sourceHeader']['name'],
                     'animationSupport': 'all-embedded-blends', 'headBones': heads,
                     'headBoneIndices': [head['index'] for head in heads],
                     'headBoneNames': [head['name'] for head in heads],
                     'runtimeUnitScale': 1 / 40,
                     'warnings': [warning for warning in metadata['warnings'] if 'blends imported' not in warning]})
    metadata['counts'].update({'hitboxes': len(hitboxes), 'sequences': len(result['sequences']),
                               'blends': sum(s['blendCount'] for s in result['sequences']),
                               'multiblendSequences': sum(s['blendCount'] > 1 for s in result['sequences']),
                               'animationSamples': sample_count, 'animationChannels': channel_count,
                               'skinFamilies': len(result['skins'])})
    return result, pngs


def write_model(path, model):
    """Stream JSON into a bounded temporary file; hash exactly the saved bytes."""
    temporary = path.with_suffix('.json.tmp')
    digest, total = hashlib.sha256(), 0
    try:
        with temporary.open('wb') as handle:
            for part in json.JSONEncoder(separators=(',', ':'), allow_nan=False).iterencode(model):
                data = part.encode()
                total += len(data)
                require(total <= MAX_OUTPUT, 'Converted JSON byte budget exceeded')
                handle.write(data)
                digest.update(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return digest.hexdigest(), total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--ids', nargs='+', choices=IDS, default=IDS)
    parser.add_argument('--weapons', action='store_true')
    parser.add_argument('--weapons-only', action='store_true')
    parser.add_argument('--weapon-ids', nargs='+', choices=WEAPON_IDS + FETCH['OPTIONAL_WEAPONS'], default=WEAPON_IDS)
    args = parser.parse_args()
    root = args.root.resolve()
    require(root.is_relative_to(ROOT.resolve()), 'Output must remain under ignored public/assets/players/')
    sources = json.loads(bounded_read(contained(root, 'sources.json'), 2 * 1024 * 1024))
    manifest_file = contained(root, 'manifest.json')
    manifest = json.loads(bounded_read(manifest_file, 2 * 1024 * 1024)) if manifest_file.exists() else {}
    manifest.update({'schema': 'goldsrc-players-v1', 'rights': FETCH['RIGHTS'], 'retailHashVerified': False})
    manifest.setdefault('models', {})
    manifest.setdefault('weapons', {})
    jobs = [] if args.weapons_only else [('models', i) for i in dict.fromkeys(args.ids)]
    if args.weapons or args.weapons_only:
        jobs += [('weapons', i) for i in dict.fromkeys(args.weapon_ids)]
    failed = False
    for kind, identity in jobs:
        source = sources.get(kind, {}).get(identity, {})
        try:
            require('file' in source and 'sha256' in source, source.get('error', 'Original source not acquired'))
            path = contained(root, source['file'])
            data = bounded_read(path, FETCH['MAX_BYTES'])
            require(hashlib.sha256(data).hexdigest() == source['sha256'], 'Source manifest SHA256 mismatch')
            model, pngs = convert(data, identity, source, 'player' if kind == 'models' else 'third-person-weapon')
            directory = contained(root, identity if kind == 'models' else f'weapons/{identity}')
            directory.mkdir(parents=True, exist_ok=True)
            for name, png in pngs.items():
                contained(root, str((directory / name).relative_to(root))).write_bytes(png)
            output_file = contained(root, str((directory / 'model.json').relative_to(root)))
            checksum, size = write_model(output_file, model)
            manifest[kind][identity] = {**model['metadata'], 'file': str(output_file.relative_to(root)),
                                        'convertedSHA256': checksum, 'convertedBytes': size}
            print(kind, identity, json.dumps(model['metadata']['counts']), flush=True)
        except (OSError, ValueError, KeyError, TypeError) as error:
            failed = True
            manifest[kind][identity] = {'id': identity, 'source': 'unavailable', 'sourceSHA256': source.get('sha256'),
                                        'provenance': source, 'rights': FETCH['RIGHTS'], 'error': str(error)}
            print(kind, identity, 'FAILED:', error, flush=True)
    manifest['convertedUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    FETCH['atomic_json'](manifest_file, manifest)
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
