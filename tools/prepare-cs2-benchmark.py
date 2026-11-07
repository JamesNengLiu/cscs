"""Prepare the isolated map benchmark from an already acquired CS2 Dust2 VPK.

Never downloads software/resources or changes the v1.0 map. Source 2 Viewer
20.1 is an optional local, standalone conversion tool (not a game dependency):
https://github.com/ValveResourceFormat/ValveResourceFormat
Original/derived assets must remain ignored, per ASSETS.md.
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
PINNED_MAP_SHA1 = '7dc529cd65d843a2b8a98c297e79b9923dd70a5d'


def parse_entities(text):
    result = []
    for block in re.split(r'^====\d+====\s*$', text, flags=re.M)[1:]:
        entity = {}
        for line in block.splitlines():
            match = re.match(r'^(\w+)\s+(.+)$', line)
            if not match:
                continue
            key, value = match.groups()
            if value.startswith('resource_name:'):
                entity[key] = value.split(':', 1)[1].strip('"')
            else:
                try:
                    entity[key] = json.loads(value)
                except ValueError:
                    entity[key] = value
        result.append(entity)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--map', type=Path, required=True)
    parser.add_argument('--viewer', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/cs2-benchmark')
    args = parser.parse_args()
    source, viewer, output = args.map.resolve(), args.viewer.resolve(), args.output.resolve()
    if not viewer.is_file():
        parser.error('Provide the existing standalone Source2Viewer-CLI executable')
    digest = hashlib.sha1()
    with source.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    if digest.hexdigest() != PINNED_MAP_SHA1:
        parser.error('Map differs from the pinned benchmark dataset; re-audit before changing the reference')
    spec = importlib.util.spec_from_file_location('cs2_inspect', ROOT / 'tools/inspect-cs2-assets.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    report = module.inspect_vpk(source, include_resources=True)
    if not report['indexComplete']:
        parser.error('Map archive is incomplete')
    # A VPK symlink gives the exporter correct Windows-style resource lookup on
    # macOS; unpacked paths alone can silently omit the main world. Do not mount
    # the global gameinfo/shared packages: this sample uses simplified materials.
    with tempfile.TemporaryDirectory(prefix='cscs-cs2-bench-') as directory:
        work = Path(directory)
        (work / 'maps').mkdir()
        archive = work / 'maps/de_dust2.vpk'
        archive.symlink_to(source)
        info = work / 'gameinfo.gi'
        info.write_text('"GameInfo" { "game" "Isolated CS2 benchmark" "FileSystem" { "SearchPaths" { "Game" "' + str(work) + '" } } }\n')
        material_map = {}
        for entry in report['resources']:
            if entry['extension'] == 'vmdl_c':
                material_map[Path(entry['path']).name.removesuffix('.vmdl_c')] = [
                    p for p in module.resource_references(module.read_entry(source, entry)) if p.endswith('.vmat_c')]
        (work / 'source-material-map.json').write_text(json.dumps(material_map))
        env = dict(os.environ)
        env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = str(ROOT / '.local/cs2/tools/bundle')
        for resource, name, geometry in [
                ('maps/de_dust2/entities/default_ents.vents_c', 'entities.txt', False),
                ('maps/de_dust2.vmap_c', 'geometry.gltf', True)]:
            command = [str(viewer), '-i', str(archive), '-f', resource, '-d', '--game', str(info), '-o', str(work / name)]
            if geometry:
                command += ['--gltf_export_format', 'gltf', '--gltf_export_extras']
            completed = subprocess.run(command, cwd=viewer.parent, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
            # The converter can log an exception while returning zero.
            if completed.returncode or 'Exception:' in completed.stdout or not (work / name).is_file():
                raise RuntimeError('Source 2 export failed: ' + completed.stdout[-3000:])
        entities = parse_entities((work / 'entities.txt').read_text())
        (work / 'entities.json').write_text(json.dumps(entities))
        subprocess.run(['node', str(ROOT / 'tools/build-cs2-benchmark.mjs'), '--input', str(work / 'geometry.gltf'), '--output', str(output)], cwd=ROOT, check=True)
        print('Prepared benchmark; temporary unpacked/exported resources have been removed.')


if __name__ == '__main__':
    main()
