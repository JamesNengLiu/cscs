"""Build a local *subset* download plan from an already obtained Steam manifest.

This is not an official/full manifest: original chunk IDs, offsets and checksums
are preserved, but unrelated chunks are omitted. Sparse VPK parts are temporary
and must never be distributed or reported as complete files. Requested resources
are subsequently checked against the original VPK index CRC before extraction.
No credentials, global install, or automatic software downloads.

Schema: https://github.com/SteamDatabase/Protobufs/blob/master/steam/content_manifest.proto
Downloader cache: https://github.com/SteamRE/DepotDownloader (3.4.0)
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import zlib


def varint(data, at):
    value = 0
    for shift in range(0, 70, 7):
        if at >= len(data):
            raise ValueError('Truncated protobuf varint')
        byte = data[at]
        at += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, at
    raise ValueError('Oversized protobuf varint')


def encode_varint(value):
    if not isinstance(value, int) or value < 0:
        raise ValueError('Expected non-negative protobuf integer')
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def fields(data):
    at, result = 0, []
    while at < len(data):
        start = at
        key, at = varint(data, at)
        number, wire = key >> 3, key & 7
        if number == 0:
            raise ValueError('Invalid protobuf field')
        if wire == 0:
            value, at = varint(data, at)
        elif wire in (1, 5):
            size = 8 if wire == 1 else 4
            value = data[at:at + size]
            at += size
        elif wire == 2:
            size, at = varint(data, at)
            value = data[at:at + size]
            at += size
        else:
            raise ValueError('Unsupported protobuf wire type')
        if at > len(data):
            raise ValueError('Truncated protobuf field')
        result.append((number, wire, value, data[start:at]))
    return result


def field(number, value, wire=2):
    return encode_varint(number << 3 | wire) + (
        encode_varint(value) if wire == 0 else encode_varint(len(value)) + value)


def read_manifest(data):
    sections, at, ended = {}, 0, False
    while at + 4 <= len(data):
        magic = struct.unpack_from('<I', data, at)[0]
        at += 4
        if magic == 0x32C415AB:
            ended = True
            if at != len(data):
                raise ValueError('Trailing manifest bytes')
            break
        if magic not in (0x71F617D0, 0x1F4812BE, 0x1B81B817) or magic in sections:
            raise ValueError('Unexpected manifest section')
        size = struct.unpack_from('<I', data, at)[0]
        at += 4
        sections[magic] = data[at:at + size]
        at += size
        if at > len(data):
            raise ValueError('Truncated manifest section')
    if len(sections) != 3 or not ended:
        raise ValueError('Incomplete manifest')
    metadata = {n: v for n, _, v, _ in fields(sections[0x1F4812BE])}
    if metadata.get(4):
        raise ValueError('Manifest names must already be decrypted by the downloader')
    return sections, metadata


def subset_manifest(data, ranges):
    sections, metadata = read_manifest(data)
    selected, audit, found = [], [], set()
    for n, wire, mapping, _ in fields(sections[0x71F617D0]):
        if n != 1 or wire != 2:
            raise ValueError('Unknown manifest payload field')
        rows = fields(mapping)
        properties = {n: v for n, _, v, _ in rows if n != 6}
        name = properties[1].decode().replace('\\', '/')
        if name not in ranges:
            continue
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
            raise ValueError('Unsafe depot path')
        found.add(name)
        keep, chunk_audit = [], []
        for number, _, chunk, raw in rows:
            if number != 6:
                keep.append(raw)
                continue
            values = {n: v for n, _, v, _ in fields(chunk)}
            offset, size = values.get(3, 0), values[4]
            if any(offset < end and offset + size > begin for begin, end in ranges[name]):
                keep.append(raw)
                chunk_audit.append({'offset': offset, 'bytes': size, 'compressedBytes': values[5], 'sha1': values[1].hex()})
        if not chunk_audit:
            raise ValueError('No chunks cover requested ranges: ' + name)
        for begin, end in ranges[name]:
            cursor = begin
            for chunk in sorted(chunk_audit, key=lambda c: c['offset']):
                if chunk['offset'] <= cursor < chunk['offset'] + chunk['bytes']:
                    cursor = chunk['offset'] + chunk['bytes']
            if cursor < end or end > properties[2]:
                raise ValueError('Requested range is not fully covered: ' + name)
        selected.append(field(1, b''.join(keep)))
        audit.append({'path': name, 'fullFileBytes': properties[2], 'fullFileSHA1': properties[5].hex(), 'chunks': chunk_audit})
    if found != set(ranges):
        raise ValueError('Depot paths missing: ' + repr(set(ranges) - found))
    payload = b''.join(selected)
    updates = {5: sum(c['bytes'] for f in audit for c in f['chunks']),
               6: sum(c['compressedBytes'] for f in audit for c in f['chunks']),
               7: len({c['sha1'] for f in audit for c in f['chunks']}),
               9: zlib.crc32(struct.pack('<I', len(payload)) + payload)}
    meta = b''.join(field(n, updates[n], 0) if n in updates else raw
                    for n, _, _, raw in fields(sections[0x1F4812BE]))
    result = b''.join(struct.pack('<II', magic, len(block)) + block for magic, block in
                      [(0x71F617D0, payload), (0x1F4812BE, meta), (0x1B81B817, b'')])
    return result + struct.pack('<I', 0x32C415AB), metadata, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--requests', type=Path, required=True, help='JSON list of exact resource paths')
    parser.add_argument('--download-dir', type=Path, required=True)
    parser.add_argument('--downloader', type=Path)
    parser.add_argument('--extract', type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('vpk', Path(__file__).with_name('inspect-cs2-assets.py'))
    vpk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vpk)
    data = args.manifest.read_bytes()
    if args.manifest.with_suffix('.manifest.sha').read_bytes() != hashlib.sha1(data).digest():
        parser.error('Original manifest cache SHA-1 mismatch')
    requests = set(json.loads(args.requests.read_text()))
    index = {}
    for folder in ['game/csgo', 'game/core']:
        archive = args.source_root / folder / 'pak01_dir.vpk'
        for entry in vpk.inspect_vpk(archive, True)['resources']:
            index.setdefault(entry['path'], (folder, archive, entry))
    ranges = {}
    for name in requests:
        if name not in index:
            parser.error('Resource absent from official index: ' + name)
        folder, archive, entry = index[name]
        if entry['archive'] != 0x7FFF:
            part = folder + f"/pak01_{entry['archive']:03d}.vpk"
            ranges.setdefault(part, []).append((entry['offset'], entry['offset'] + entry['bytes']))
    subset, metadata, audit = subset_manifest(data, ranges)
    output = args.download_dir.resolve()
    if output == args.source_root.resolve():
        parser.error('Subset directory must differ from original source/cache')
    config = output / '.DepotDownloader'
    config.mkdir(parents=True, exist_ok=True)
    cached = config / f'{metadata[1]}_{metadata[2]}.manifest'
    cached.write_bytes(subset)
    cached.with_suffix('.manifest.sha').write_bytes(hashlib.sha1(subset).digest())
    filelist = output / 'subset-files.txt'
    filelist.write_text('\n'.join(sorted(ranges)) + '\n')
    receipt = {'scope': 'LOCAL SUBSET PLAN; sparse parts are not full VPK files',
               'sourceManifestSHA256': hashlib.sha256(data).hexdigest(), 'manifest': str(metadata[2]),
               'resources': sorted(requests), 'files': audit,
               'selectedCompressedBytes': sum(c['compressedBytes'] for f in audit for c in f['chunks'])}
    (output / 'subset-plan.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps({k: v for k, v in receipt.items() if k not in ('resources', 'files')}), flush=True)
    for folder in ['game/csgo', 'game/core']:
        destination = output / folder / 'pak01_dir.vpk'
        destination.parent.mkdir(parents=True, exist_ok=True)
        # The VPK reader resolves the index path before locating part files.
        # Copy this small index; a symlink would resolve to the original folder.
        if destination.is_symlink():
            destination.unlink()
        if not destination.exists():
            shutil.copyfile(args.source_root / folder / 'pak01_dir.vpk', destination)
    if args.downloader:
        env = dict(os.environ)
        env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = str(Path(__file__).resolve().parents[1] / '.local/cs2/tools/bundle')
        subprocess.run([str(args.downloader.resolve()), '-app', '730', '-depot', str(metadata[1]),
                        '-manifest', str(metadata[2]), '-dir', str(output), '-filelist', str(filelist),
                        '-validate', '-max-downloads', '16'], env=env, check=True)
    if args.extract:
        count = 0
        for name in sorted(requests):
            folder, original, entry = index[name]
            data = vpk.read_entry(output / folder / 'pak01_dir.vpk', entry)
            destination = args.extract / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            count += 1
        print(f'CRC-verified {count} exact resources from sparse temporary parts', flush=True)


if __name__ == '__main__':
    main()
