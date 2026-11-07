"""Prepare only the isolated optimization sample from existing local assets.
No downloads, global tools, gameplay edits, or retained export intermediates.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--map', type=Path, default=ROOT / '.local/cs2/source/game/csgo/maps/de_dust2.vpk')
    parser.add_argument('--viewer', type=Path, default=ROOT / '.local/cs2/tools/source2viewer/Source2Viewer-CLI')
    args = parser.parse_args()
    source, viewer = args.map.resolve(), args.viewer.resolve()
    if hashlib.sha1(source.read_bytes()).hexdigest() != '7dc529cd65d843a2b8a98c297e79b9923dd70a5d':
        parser.error('Map does not match the pinned rendering control')
    def module(name, file):
        spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file)
        result = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(result)
        return result
    vpk = module('vpk', 'inspect-cs2-assets.py')
    texture = module('resource', 'prepare-cs2-textured.py')
    entry = next(e for e in vpk.inspect_vpk(source, True)['resources'] if e['path'].endswith('/world_visibility.vvis_c'))
    raw = vpk.read_entry(source, entry)
    offset, length = texture.resource_blocks(raw)['VXVS']
    payload = raw[offset:offset + length]
    env = dict(os.environ)
    env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = str(ROOT / '.local/cs2/tools/bundle')
    dumped = subprocess.check_output([str(viewer), '-i', str(source), '-f', entry['path'], '-b', 'DATA'], cwd=viewer.parent, env=env, text=True)
    meta = {'clusterCount': 4096, 'bytesPerRow': 512, 'grid': 8,
            'min': [-8768, -7136, -7768], 'max': [7616, 9248, 8616], 'bytes': len(payload),
            'sourceCRC32': entry['crc32'], 'sha256': hashlib.sha256(payload).hexdigest()}
    for name in ['m_NodeBlock', 'm_RegionBlock', 'm_EnclosedClusterListBlock', 'm_EnclosedClustersBlock', 'm_MasksBlock', 'm_nVisBlocks']:
        match = re.search(name + r' =\s*\{\s*m_nOffset = (\d+)\s*m_nElementCount = (\d+)', dumped)
        if not match:
            parser.error('Unsupported compiled visibility layout')
        meta[name] = {'offset': int(match[1]), 'count': int(match[2])}
    with tempfile.TemporaryDirectory(prefix='cscs-cs2-opt-') as folder:
        work = Path(folder)
        (work / 'visibility.json').write_text(json.dumps(meta))
        (work / 'visibility.bin').write_bytes(payload)
        subprocess.run(['node', str(ROOT / 'tools/build-cs2-optimized.mjs'), '--visibility-dir', str(work)], cwd=ROOT, check=True)
        subprocess.run(['node', str(ROOT / 'tools/build-cs2-texture-tiers.mjs')], cwd=ROOT, check=True)
    print('Prepared optimized sample; temporary visibility export removed.')


if __name__ == '__main__':
    main()
