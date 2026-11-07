"""Offline native-texture preparation for the isolated CS2 map benchmark.

Uses local CRC-verified resources and the optional Source 2 Viewer CLI only.
No global installs, Wasm, gameplay edits, or automatic network downloads.
Native BC blocks retain the authored mip chain (top mip bounded by --texture-max).
"""
from pathlib import Path
import argparse
import ctypes
import gzip
import hashlib
import importlib.util
import json
import os
import re
import struct
import subprocess
import tempfile
import shutil
import zlib

ROOT = Path(__file__).resolve().parents[1]


def resource_blocks(data):
    if len(data) < 16:
        raise ValueError('Truncated resource')
    _, version, _, offset, count = struct.unpack_from('<IHHII', data)
    if version != 12 or count > 4096:
        raise ValueError('Unsupported resource header')
    result = {}
    for i in range(count):
        at = 8 + offset + i * 12
        kind, relative, size = struct.unpack_from('<4sII', data, at)
        begin = at + 4 + relative
        if begin + size > len(data):
            raise ValueError('Resource block exceeds file')
        result[kind.decode()] = (begin, size)
    return result


def vpk_bytes(resources):
    """Small self-contained VPK v1, preserving compiled resource bytes/CRC."""
    tree, payload, cursor, by_extension = bytearray(), [], 0, {}
    for name, data in sorted(resources.items()):
        p = Path(name)
        by_extension.setdefault(p.suffix[1:], {}).setdefault(str(p.parent), []).append((p.stem, data))
    for extension, folders in by_extension.items():
        tree += extension.encode() + b'\0'
        for folder, entries in folders.items():
            tree += folder.encode() + b'\0'
            for name, data in entries:
                tree += name.encode() + b'\0' + struct.pack('<IHHIIH', zlib.crc32(data), 0, 0x7FFF, cursor, len(data), 0xFFFF)
                payload.append(data)
                cursor += len(data)
            tree += b'\0'
        tree += b'\0'
    tree += b'\0'
    return struct.pack('<III', 0x55AA1234, 1, len(tree)) + tree + b''.join(payload)


def material_metadata(text):
    """Read only typed, flat VMAT parameter rows from the viewer's DATA dump."""
    result = {}
    for chunk in re.split(r'^\[\d+/\d+\] ', text, flags=re.M)[1:]:
        filename = chunk.splitlines()[0].strip()
        if not filename.startswith('/') and filename.endswith('.vmat_c'):
            name = filename
        elif '/materials/' in filename:
            name = 'materials/' + filename.split('/materials/', 1)[1]
        elif '/models/' in filename:
            name = 'models/' + filename.split('/models/', 1)[1]
        else:
            continue
        data = chunk.split('--- Data for block "DATA" ---', 1)[1].split('--- Data for block ', 1)[0]
        shader = re.search(r'm_shaderName = "([^"]+)"', data).group(1)
        properties = {'IntParams': {}, 'FloatParams': {}, 'VectorParams': {}, 'TextureParams': {}}
        for match in re.finditer(r'm_name = "([^"]+)"\s+(m_nValue|m_flValue|m_value|m_pValue) = ([^\n]+)', data):
            key, kind, value = match.groups()
            if kind == 'm_pValue':
                properties['TextureParams'][key] = re.search(r'"([^"]+)"', value).group(1) + '_c'
            elif kind == 'm_nValue':
                properties['IntParams'][key] = int(value)
            elif kind == 'm_flValue':
                properties['FloatParams'][key] = float(value)
            elif value.startswith('['):
                properties['VectorParams'][key] = json.loads(value)
        result[name] = {'Name': name, 'ShaderName': shader, **properties}
    return result


def decode_lz4(data, size):
    # macOS system codec; no Python extension, .NET SDK or browser Wasm runtime.
    library = ctypes.CDLL('/usr/lib/libcompression.dylib')
    decode = library.compression_decode_buffer
    decode.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_int]
    decode.restype = ctypes.c_size_t
    output = ctypes.create_string_buffer(size)
    source = ctypes.create_string_buffer(data)
    written = decode(output, size, source, len(data), None, 0x101)
    if written != size:
        raise ValueError(f'LZ4 mip size mismatch: {written} != {size}')
    return output.raw


def texture_mips(data, maximum):
    blocks = resource_blocks(data)
    at, size = blocks['DATA']
    version, flags = struct.unpack_from('<HH', data, at)
    width, height, depth, format_id, count = struct.unpack_from('<HHHBB', data, at + 20)
    if version != 1 or not 0 < count <= 16 or not width or not height or depth != 1 or flags & 0x20:
        raise ValueError(f'Unsupported texture dimensions/flags: {width}x{height}x{depth}, {flags}')
    # Source 2 texture data begins immediately after its DATA block.
    cursor = at + size
    compression, compressed = 0, None
    relative, extras = struct.unpack_from('<II', data, at + 32)
    if extras > 100:
        raise ValueError('Invalid texture extras')
    for i in range(extras):
        field = at + 32 + relative + i * 12
        kind, offset, length = struct.unpack_from('<III', data, field)
        begin = field + 4 + offset
        if begin + length > at + size:
            raise ValueError('Invalid texture extra span')
        if kind == 4:
            compression, mip_offset, mip_count = struct.unpack_from('<III', data, begin)
            if mip_count != count:
                raise ValueError('Mip count mismatch')
            compressed = struct.unpack_from('<' + 'I' * count, data, begin + 4 + mip_offset)
    block_bytes = {1: 8, 2: 16, 19: 16, 20: 16, 21: 16, 27: 8}
    if format_id not in block_bytes and format_id not in (3, 4, 22, 28, 32, 33):
        raise ValueError(f'Unsupported native texture format: {format_id}')
    pixels = {3: 1, 4: 4, 22: 2, 28: 4, 32: 1, 33: 1}
    mips = []
    faces = 6 if flags & 0x10 else 1
    for level in reversed(range(count)):
        w, h = max(1, width >> level), max(1, height >> level)
        expected = ((w + 3) // 4) * ((h + 3) // 4) * block_bytes[format_id] if format_id in block_bytes else w * h * pixels[format_id]
        expected *= faces
        stored = min(expected, compressed[level]) if compressed else expected
        if cursor + stored > len(data):
            raise ValueError('Truncated texture mip')
        if max(w, h) <= maximum or level == count - 1:
            raw = data[cursor:cursor + stored]
            if stored < expected:
                if compression != 1:
                    raise ValueError('Unsupported mip compression method')
                raw = decode_lz4(raw, expected)
            mips.append({'width': w, 'height': h, 'data': raw, 'sourceLevel': level})
        cursor += stored
    if cursor != len(data):
        raise ValueError(f'Texture tail mismatch: {cursor} != {len(data)}')
    return {'sourceWidth': width, 'sourceHeight': height, 'format': format_id, 'flags': flags, 'faces': faces}, list(reversed(mips))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    parser.add_argument('--map', type=Path, required=True)
    parser.add_argument('--viewer', type=Path, required=True)
    parser.add_argument('--work', type=Path, default=ROOT / '.local/cs2/textured/export-materials')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/cs2-textured')
    parser.add_argument('--stage', choices=['geometry', 'textures', 'all'], default='all')
    parser.add_argument('--texture-max', type=int, default=1024)
    parser.add_argument('--lightmap-max', type=int, default=4096)
    args = parser.parse_args()
    work, output, resources, viewer = args.work.resolve(), args.output.resolve(), args.resources.resolve(), args.viewer.resolve()
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = str(ROOT / '.local/cs2/tools/bundle')
    if args.stage in ('geometry', 'all'):
        if hashlib.sha1(args.map.read_bytes()).hexdigest() != '7dc529cd65d843a2b8a98c297e79b9923dd70a5d':
            parser.error('Dust2 map differs from the fixed geometry benchmark dataset')
        # Only real VMATs are mounted for geometry export. The exported placeholder
        # PNGs are discarded: runtime textures come from verified native VTEX mips.
        materials = {str(p.relative_to(resources)): p.read_bytes() for p in resources.rglob('*.vmat_c')}
        (work / 'pak01_dir.vpk').write_bytes(vpk_bytes(materials))
        with (work / 'materials.txt').open('w') as log:
            subprocess.run([str(viewer), '-i', str(work / 'pak01_dir.vpk'), '-e', 'vmat_c', '-a'],
                           cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        metadata = material_metadata((work / 'materials.txt').read_text())
        if len(metadata) != len(materials):
            raise ValueError('Material metadata coverage mismatch')
        (work / 'source-materials.json').write_text(json.dumps(metadata))
        (work / 'maps').mkdir(exist_ok=True)
        link = work / 'maps/de_dust2.vpk'
        if not link.exists():
            link.symlink_to(args.map.resolve())
        info = work / 'gameinfo.gi'
        info.write_text('"GameInfo" { "game" "Isolated textured map export" "FileSystem" { "SearchPaths" { "Game" "' + str(work) + '" } } }')
        with (work / 'export.log').open('w') as log:
            subprocess.run([str(viewer), '-i', str(link), '-f', 'maps/de_dust2.vmap_c', '-d', '--game', str(info),
                            '--gltf_export_format', 'gltf', '--gltf_export_extras', '--gltf_export_materials',
                            '-o', str(work / 'geometry.gltf')], cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        gltf = json.loads((work / 'geometry.gltf').read_text())
        if len(gltf['meshes']) < 3000 or len(gltf.get('materials', [])) < 200:
            raise ValueError('Incomplete material/geometry export')
        # Material input signatures identify the lightmap channel, which the
        # exporter scales by the world atlas factor. Preserve an unscaled export
        # as comparison evidence instead of guessing a TEXCOORD channel number.
        with tempfile.TemporaryDirectory(prefix='cscs-cs2-uv-') as directory:
            uv = Path(directory)
            (uv / 'maps').mkdir()
            (uv / 'maps/de_dust2.vpk').symlink_to(args.map.resolve())
            (uv / 'gameinfo.gi').write_text('"GameInfo" { "FileSystem" { "SearchPaths" { "Game" "' + str(uv) + '" } } }')
            with (work / 'uv-reference.log').open('w') as log:
                subprocess.run([str(viewer), '-i', str(uv / 'maps/de_dust2.vpk'), '-f', 'maps/de_dust2.vmap_c', '-d',
                                '--game', str(uv / 'gameinfo.gi'), '--gltf_export_format', 'gltf', '--gltf_export_extras',
                                '-o', str(uv / 'uv-reference.gltf')], cwd=viewer.parent, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            for file in uv.glob('uv-reference*'):
                if file.suffix in ('.gltf', '.bin') and not file.name.startswith('uv-reference_physics'):
                    shutil.copyfile(file, work / file.name)
        print('Material-indexed geometry exported', len(gltf['meshes']), len(gltf['materials']), flush=True)
    if args.stage in ('textures', 'all'):
        supported_channels = {'g_tColor', 'g_tNormal', 'g_tAmbientOcclusion', 'g_tMetalness',
                              'g_tLayer1NormalRoughness', 'g_tLayer1AmbientOcclusion', 'g_tLayer2Color',
                              'g_tLayer2NormalRoughness', 'g_tLayer2AmbientOcclusion', 'g_tBlendModulation',
                              'g_tSelfIllumMask', 'g_tTintMask', 'g_tRoughness'}
        gltf = json.loads((work / 'geometry.gltf').read_text())
        used_names = {Path(name).name + '_c' for material in gltf['materials']
                      for key, name in material.get('extras', {}).get('vmat', {}).get('TextureParams', {}).items()
                      if key in supported_channels}
        used_names.add('sky_de_dust2_exr_908a35ba.vtex_c')
        files = sorted(p for p in resources.rglob('*.vtex_c') if p.name in used_names or '/lightmaps/' in str(p))
        texture_index = {}
        target = output / 'textures'
        target.mkdir(exist_ok=True)
        total = 0
        for file in files:
            name = str(file.relative_to(resources))
            # LPV volumes/debug charts are not represented as ordinary 2D textures.
            if '/lightmaps/' in name and Path(name).name not in ['irradiance.vtex_c', 'directional_irradiance.vtex_c', 'direct_light_shadows.vtex_c']:
                continue
            data = file.read_bytes()
            meta, mips = texture_mips(data, args.lightmap_max if '/lightmaps/' in name else args.texture_max)
            blob, cursor = [], 0
            metadata = []
            for mip in mips:
                raw = mip.pop('data')
                metadata.append({**mip, 'offset': cursor, 'bytes': len(raw)})
                blob.append(raw)
                cursor += len(raw)
            binary = b''.join(blob)
            filename = hashlib.sha256(name.encode()).hexdigest()[:20] + '.bin.gz'
            compressed = gzip.compress(binary, compresslevel=6, mtime=0)
            (target / filename).write_bytes(compressed)
            texture_index[name] = {**meta, 'file': 'textures/' + filename, 'bytes': len(binary), 'downloadBytes': len(compressed),
                                   'sourceSHA256': hashlib.sha256(data).hexdigest(), 'sha256': hashlib.sha256(binary).hexdigest(), 'mips': metadata}
            total += len(binary)
        (output / 'textures.json').write_text(json.dumps({'format': 'cs2-native-textures-v1', 'textureMax': args.texture_max,
                                                        'lightmapMax': args.lightmap_max, 'bytes': total, 'textures': texture_index}))
        print('Prepared native textures', len(texture_index), 'GPU bytes', total, flush=True)
    if args.stage == 'all':
        subprocess.run(['node', str(ROOT / 'tools/build-cs2-textured.mjs'), '--input', str(work / 'geometry.gltf'),
                        '--output', str(output)], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
