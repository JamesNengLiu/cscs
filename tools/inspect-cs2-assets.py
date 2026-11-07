"""Read-only Source 2 VPK preflight. No extraction, install or game startup.

The format layout is public; this parser is independently authored. Original
assets and reports stay outside Git (ASSETS.md). A readable index is not proof
that its resources can be rendered, or that a map is playable.
"""
from pathlib import Path, PurePosixPath
from collections import Counter
import argparse
import hashlib
import json
import struct
import zlib


def inspect_vpk(filename, include_resources=False, include_references=False):
    filename = Path(filename).resolve()
    size = filename.stat().st_size
    with filename.open('rb') as stream:
        prefix = stream.read(12)
        if len(prefix) != 12:
            raise ValueError('Truncated VPK header')
        magic, version, tree_size = struct.unpack('<III', prefix)
        if magic != 0x55AA1234 or version not in (1, 2):
            raise ValueError('Expected a VPK v1/v2 archive')
        header_size = 12 if version == 1 else 28
        if not 0 < tree_size <= 64 * 1024 * 1024 or header_size + tree_size > size:
            raise ValueError('Invalid VPK index size')
        stream.seek(header_size)
        tree = stream.read(tree_size)
    cursor, entries = 0, []

    def token():
        nonlocal cursor
        end = tree.find(b'\0', cursor)
        if end < 0:
            raise ValueError('Unterminated VPK index token')
        value = tree[cursor:end].decode('utf-8')
        cursor = end + 1
        return value

    while extension := token():
        while folder := token():
            while name := token():
                if cursor + 18 > len(tree):
                    raise ValueError('Truncated VPK index entry')
                crc, preload, archive, offset, length, marker = struct.unpack_from('<IHHIIH', tree, cursor)
                cursor += 18
                if marker != 0xFFFF or cursor + preload > len(tree):
                    raise ValueError('Invalid VPK entry/preload data')
                preload_offset = cursor
                cursor += preload
                path = ('' if folder == ' ' else folder + '/') + name + ('' if extension == ' ' else '.' + extension)
                if '\\' in path or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
                    raise ValueError('Unsafe path in VPK index')
                entries.append({'path': path, 'extension': extension, 'crc32': f'{crc:08x}',
                                'preloadBytes': preload, 'archive': archive,
                                'preloadOffset': preload_offset, 'offset': offset, 'bytes': length})
    if cursor != len(tree):
        raise ValueError('Trailing bytes in VPK index')
    paths = [entry['path'] for entry in entries]
    if len(set(paths)) != len(paths):
        raise ValueError('Duplicate VPK resource path')
    missing, invalid = set(), []
    stem = filename.stem.removesuffix('_dir')
    for entry in entries:
        inline = entry['archive'] == 0x7FFF
        part = filename if inline else filename.with_name(f"{stem}_{entry['archive']:03d}.vpk")
        if not part.is_file():
            missing.add(str(part))
        elif entry['offset'] + entry['bytes'] + (header_size + tree_size if inline else 0) > part.stat().st_size:
            invalid.append(entry['path'])
    result = {'archive': str(filename), 'format': f'vpk{version}', 'bytes': size,
            'indexSHA256': hashlib.sha256(tree).hexdigest(), 'entries': len(entries),
            'resourceTypes': dict(sorted(Counter(entry['extension'] for entry in entries).items())),
            'missingArchives': sorted(missing), 'invalidRanges': invalid,
            'indexComplete': not missing and not invalid,
            'mapResources': [entry['path'] for entry in entries if entry['extension'] in
                             ('vmap_c', 'vwrld_c', 'vwnod_c', 'vents_c', 'vphys_c', 'vvis_c')],
            'scope': 'Index and byte-range preflight only; no resource conversion, lighting or collision certification.'}
    if include_resources:
        result['resources'] = entries
    if include_references:
        references = set()
        for entry in entries:
            if entry['extension'].endswith('_c'):
                data = read_entry(filename, entry)
                references.update(resource_references(data))
        result['references'] = sorted(references)
    return result


def read_entry(filename, entry):
    """Read an indexed resource, checking its range and CRC before decoding."""
    filename = Path(filename).resolve()
    with filename.open('rb') as stream:
        _, version, tree_size = struct.unpack('<III', stream.read(12))
        header_size = 12 if version == 1 else 28
        stream.seek(header_size + entry['preloadOffset'])
        preload = stream.read(entry['preloadBytes'])
    part = filename if entry['archive'] == 0x7FFF else filename.with_name(
        f"{filename.stem.removesuffix('_dir')}_{entry['archive']:03d}.vpk")
    offset = entry['offset'] + (header_size + tree_size if entry['archive'] == 0x7FFF else 0)
    with part.open('rb') as stream:
        if offset + entry['bytes'] > part.stat().st_size:
            raise ValueError('Resource exceeds its archive')
        stream.seek(offset)
        data = preload + stream.read(entry['bytes'])
    if f'{zlib.crc32(data):08x}' != entry['crc32']:
        raise ValueError('VPK resource CRC mismatch: ' + entry['path'])
    return data


def resource_references(data):
    """Source 2 resource headers/RERL contain uncompressed relative pointers."""
    if len(data) < 16:
        return []
    _, header_version, _, directory, count = struct.unpack_from('<IHHII', data)
    if header_version != 12:
        return []
    directory += 8
    if count > 4096 or directory + count * 12 > len(data):
        raise ValueError('Invalid Source 2 block directory')
    references = []
    for i in range(count):
        pos = directory + i * 12
        kind, offset, size = struct.unpack_from('<4sII', data, pos)
        if kind != b'RERL':
            continue
        start = pos + 4 + offset
        if start + size > len(data) or size < 8:
            raise ValueError('Invalid Source 2 reference block')
        rows, n = struct.unpack_from('<II', data, start)
        rows += start
        if n > 100000 or rows + n * 16 > start + size:
            raise ValueError('Invalid Source 2 reference rows')
        for j in range(n):
            field = rows + j * 16 + 8
            pointer = field + struct.unpack_from('<q', data, field)[0]
            end = data.find(b'\0', pointer, start + size)
            if pointer < start or end < pointer:
                raise ValueError('Invalid Source 2 reference string')
            name = data[pointer:end].decode('utf-8')
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name:
                raise ValueError('Unsafe Source 2 reference path')
            references.append(name if name.endswith('_c') else name + '_c')
    return references


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--resources', action='store_true', help='Include indexed resource metadata')
    parser.add_argument('--references', action='store_true', help='Read/CRC-check resources and list their external references')
    args = parser.parse_args()
    try:
        report = inspect_vpk(args.archive, args.resources, args.references)
    except (OSError, ValueError, UnicodeDecodeError, struct.error) as error:
        parser.exit(2, f'Cannot inspect VPK: {error}\n')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
    return 2 if args.require_complete and not report['indexComplete'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
