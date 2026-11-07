"""Prepare an isolated, provenance-checked CS2 content pilot.

No global install, game startup, 1.0 writes, or automatic executable downloads.
Inputs are Valve's already acquired VPK index and sparse CRC-checked resources.
Run stages explicitly: catalog -> requests -> sparse downloader -> expand
(repeat download/expand for material closure) -> metadata -> export -> manifest.
Original/derived content is private local data and must not be committed.

Primary format/converter: https://github.com/ValveResourceFormat/ValveResourceFormat
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
kv3 = importlib.import_module('cs2-content-kv3')
vpk = importlib.import_module('inspect-cs2-assets')
MANIFEST_ID = '6679288287140932208'
WEAPONS = {
    'ak47': 'weapon_ak47', 'm4a4': 'weapon_m4a1',
    'm4a1_silencer': 'weapon_m4a1_silencer', 'awp': 'weapon_awp',
    'usp_silencer': 'weapon_usp_silencer', 'glock': 'weapon_glock',
    'deagle': 'weapon_deagle', 'mp5sd': 'weapon_mp5sd', 'p90': 'weapon_p90',
    'knife': 'weapon_knife', 'hegrenade': 'weapon_hegrenade',
    'flashbang': 'weapon_flashbang', 'smokegrenade': 'weapon_smokegrenade',
    'p250': 'weapon_p250', 'elite': 'weapon_elite', 'fiveseven': 'weapon_fiveseven',
    'nova': 'weapon_nova', 'xm1014': 'weapon_xm1014', 'mac10': 'weapon_mac10',
    'mp9': 'weapon_mp9', 'ump45': 'weapon_ump45', 'galilar': 'weapon_galilar',
    'famas': 'weapon_famas', 'aug': 'weapon_aug', 'sg556': 'weapon_sg556',
    'ssg08': 'weapon_ssg08', 'g3sg1': 'weapon_g3sg1', 'scar20': 'weapon_scar20',
    'm249': 'weapon_m249', 'c4': 'weapon_c4',
}
LEGACY_MODEL_KEYS = {'glock18': 'glock', 'usp': 'usp_silencer', 'p228': 'p250', 'm3': 'nova',
                     'tmp': 'mp9', 'mp5navy': 'mp5sd', 'galil': 'galilar', 'm4a1': 'm4a1_silencer',
                     'sg552': 'sg556', 'scout': 'ssg08', 'sg550': 'scar20'}
MODELS = {
    'ctm_sas': 'agents/models/ctm_sas/ctm_sas.vmdl_c',
    'tm_phoenix': 'agents/models/tm_phoenix/tm_phoenix.vmdl_c',
    'arms': 'weapons/models/shared/arms/weapon_arms.vmdl_c',
}
WORLD_CLIPS = [f'{action}_{direction}_rifle' for action in ('run', 'walk', 'crouch')
               for direction in ('n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw')] + [
    'idle_rifle', 'idle_crouch_rifle', 'jump_stand_rifle', 'inair_stand_rifle',
    'shoot_rifle', 'shoot_rifle.vnmclip+non_additive.vnmclip',
]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def safe_resource(value):
    if not isinstance(value, str) or '\\' in value or PurePosixPath(value).is_absolute() or '..' in PurePosixPath(value).parts:
        raise ValueError('Unsafe resource path')
    return value if value.endswith('_c') else value + '_c'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_record(raw, resource):
    path = raw / safe_resource(resource)
    return {'path': resource, 'sha256': sha256(path), 'bytes': path.stat().st_size,
            'app': 730, 'depot': 2347770, 'manifest': MANIFEST_ID}


def source_index(index_root):
    rows = {}
    for folder in ('game/csgo', 'game/core'):
        index = index_root / folder / 'pak01_dir.vpk'
        for row in vpk.inspect_vpk(index, True)['resources']:
            if row['path'] in rows:
                raise ValueError('Ambiguous resource path in core/csgo: ' + row['path'])
            rows[row['path']] = {**row, 'folder': folder}
    return rows


def verify_originals(raw, index):
    """Check resource CRC against the original Valve index before conversion."""
    count, size = 0, 0
    for path in sorted(raw.rglob('*')):
        if not path.is_file():
            continue
        name = str(path.relative_to(raw))
        if name not in index:
            raise ValueError('Unindexed source resource: ' + name)
        crc = 0
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                crc = zlib.crc32(chunk, crc)
        expected = index[name]
        actual_size = path.stat().st_size
        if actual_size != expected['bytes'] + expected['preloadBytes'] or f'{crc:08x}' != expected['crc32']:
            raise ValueError('Original resource CRC/size mismatch: ' + name)
        count += 1
        size += actual_size
    return {'crcVerifiedResources': count, 'sourceBytes': size}


def dump(viewer, work, raw, resource, block):
    path = work / 'metadata-dumps' / (resource.replace('/', '__') + '.' + block + '.txt')
    path.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'DOTNET_BUNDLE_EXTRACT_BASE_DIR': str(ROOT / '.local/cs2/tools/bundle')}
    with path.open('w') as log:
        subprocess.run([str(viewer), '-i', str(raw / resource), '-b', block],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    return kv3.untyped(kv3.blocks(path.read_text(), block))


def load_weapon_data(viewer, work, raw):
    rows = dump(viewer, work, raw, 'scripts/weapons.vdata_c', 'DATA')[0]
    return {key: kv3.resolve_bases(rows, name) for key, name in WEAPONS.items()}


def model_resources(weapons):
    return {**MODELS, **{key: safe_resource(row['m_szWorldModel']) for key, row in weapons.items()}}


def select_roots(index, weapons):
    roots = set(model_resources(weapons).values()) | {
        'scripts/weapons.vdata_c', 'soundevents/game_sounds_weapons.vsndevts_c',
        'animation/skeletons/characters/viewmodel.vnmskel_c',
        'animation/skeletons/characters/worldmodel.vnmskel_c',
    }
    for name in WORLD_CLIPS:
        suffix = name if name.endswith('.vnmclip') else name + '.vnmclip'
        roots.add('animation/anims/world/rifle/_default_rifle/' + suffix + '_c')
    for family in ('pistol', 'knife'):
        names = [f'{action}_{direction}_{family}' for action in ('run', 'walk', 'crouch')
                 for direction in ('n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw')]
        names += [f'idle_{family}', f'idle_crouch_{family}', f'jump_stand_{family}', f'inair_stand_{family}']
        roots.update(f'animation/anims/world/{family}/_default_{family}/{name}.vnmclip_c' for name in names)
    for folder, names in {
        'pistol/pistol_glock': ['idle_glock', 'idle_crouch_glock', 'shoot_glock'],
        'pistol/pistol_deagle': ['idle_deagle', 'idle_crouch_deagle', 'shoot_deagle'],
        'pistol/pistol_usp': ['idle_usp', 'idle_crouch_usp', 'shoot_usp'],
        'knife/default_ct': ['idle_default_ct', 'idle_crouch_default_ct'],
        'grenade/_default_grenade': ['idle_grenade', 'idle_crouch_grenade'],
    }.items():
        roots.update(f'animation/anims/world/{folder}/{name}.vnmclip+non_additive.vnmclip_c' for name in names)
    # Only playable first-person basics: no hundreds of rare inspect variants.
    folders = ['rifle/_default_rifle/', 'pistol/_default_pistol/', 'knife/_default_knife/',
               'grenade/_default_grenade/', 'equipment/c4/']
    for key in WEAPONS:
        source_key = 'glock18' if key == 'glock' else 'ak' if key == 'ak47' else key
        folders += [f'rifle/rifle_{source_key}/', f'pistol/pistol_{source_key}/']
    folders += [f'grenade/grenade_{key}/' for key in ('hegrenade', 'flashbang', 'smokegrenade')]
    for path in index:
        if any(path.startswith('animation/anims/viewmodel/' + folder) for folder in folders):
            name = PurePosixPath(path).name
            if re.match(r'(draw_|idle\d?_|reload_|shoot\d?_|pullpin_|throw_|throwcharge_|attack_|stab_|slash_|heavy_|light_|plant_|arm_|silencer_|ironsight_)', name):
                roots.add(path)
    roots.update(f'animation/anims/world/knife/_default_knife/{name}.vnmclip_c'
                 for name in ('frontstab_knife', 'backstab_knife', 'backstab_overhead_knife'))
    for suffix in ('', '_pistol', '_knife'):
        for location in ('chest', 'head'):
            roots.add(f'animation/anims/world/shared/flinch_{location}{suffix}.vnmclip+non_additive.vnmclip_c')
    roots.update(f'animation/anims/world/shared/{name}.vnmclip_c'
                 for name in ('death_chest_a', 'death_gut_a', 'death_rknee_a'))
    # Audio is selected from authoritative sound-event definitions in metadata
    # stage; this small deterministic set boots the initial sample.
    for prefix in ('ak47', 'awp', 'm4a1', 'm4a4', 'usp', 'glock18', 'deagle', 'mp5sd', 'p90'):
        candidates = [path for path in index if path.startswith('sounds/weapons/' + prefix + '/')
                      and path.endswith('.vsnd_c') and re.search(r'(_01|single|fire|shoot|zoom|draw|clipout|clipin|boltpull)\.', path)]
        roots.update(sorted(candidates)[:7])
    missing = sorted(roots - index.keys())
    # Missing configured model is fatal, never replaced by orange/error mesh.
    model_missing = set(model_resources(weapons).values()) & set(missing)
    if model_missing:
        raise ValueError('Configured model missing from Valve index: ' + repr(model_missing))
    return roots & index.keys(), missing


def expand_resources(raw, index, requested):
    refs, missing, deferred = set(), set(), set()
    for resource in sorted(requested):
        path = raw / resource
        if not path.is_file():
            continue
        if resource.endswith(('.vnmgraph_c', '.vpcf_c', '.vsndevts_c')):
            # Full engine graph/particle traversal pulls unrelated game content;
            # retain these original roots as metadata, not claimed runtime support.
            deferred.add(resource)
            continue
        for ref in vpk.resource_references(path.read_bytes()):
            if ref in index:
                refs.add(ref)
            else:
                missing.add(ref)
    return requested | refs, sorted(missing), sorted(deferred)


def clip_sound_events(work, events):
    receipt_path = work / 'export-receipts.json'
    if not receipt_path.is_file():
        return {}
    rows = json.loads(receipt_path.read_text())
    clips = {row['key']: row for row in rows if '/animations/' in row['url']}
    used = {key for row in rows for key in row.get('viewmodelActions', {}).values()}
    names = {item['m_name'] for key in used for item in clips[key].get('events', [])
             if item.get('_class') == 'CNmSoundEvent'}
    result = {}
    for name in sorted(names):
        event = events.get(name.casefold())
        if event is None:
            raise ValueError('Clip references an unknown Source sound event: ' + name)
        resources = [safe_resource(path) for path in event.get('vsnd_files_track_01', [])]
        if not resources:
            raise ValueError('Clip sound event has no direct native track: ' + name)
        result[name.casefold()] = {'name': name, 'resources': resources,
                                  'volume': event.get('volume', 1), 'pitch': event.get('pitch', 1),
                                  'mixgroup': event.get('mixgroup'), 'metadata': event.get('metadata', []),
                                  'children': [child for key, value in event.items() if key.startswith('soundevent_')
                                               for child in value if child]}
    return result


def audio_selection(viewer, work, raw):
    events = dump(viewer, work, raw, 'soundevents/game_sounds_weapons.vsndevts_c', 'DATA')[0]
    # Source sound-event lookup uses case-insensitive tokens. The vdata spells
    # Elite/SG556/scar20 differently from the event script definitions.
    events = {name.casefold(): row for name, row in events.items()}
    rows = dump(viewer, work, raw, 'scripts/weapons.vdata_c', 'DATA')[0]
    weapons = {name: kv3.resolve_bases(rows, name) for name in rows if name.startswith('weapon_')
               and name != 'weapon_base' and not rows[name].get('_not_pickable')}
    selected, by_weapon = set(), {}
    for key, row in weapons.items():
        mapped = {}
        for action, event_name in row.get('m_aShootSounds', {}).items():
            event = events.get(event_name.casefold(), {})
            # Track01 is the local direct shot; distant child events are selected
            # separately rather than flattened into an invented engine mix.
            resources = [safe_resource(name) for name in event.get('vsnd_files_track_01', [])[:2]]
            if resources:
                mapped[action] = {'event': event_name, 'resources': resources}
                selected.update(resources)
        by_weapon[key] = mapped
    selected.update({
        'sounds/player/headshot_armor_01.vsnd_c', 'sounds/player/headshot_noarmor_01.vsnd_c',
        'sounds/player/kevlar_01.vsnd_c', 'sounds/physics/flesh/flesh_impact_bullet1.vsnd_c',
        'sounds/weapons/flashbang/flashbang_explode1.vsnd_c',
        'sounds/weapons/hegrenade/pinpull.vsnd_c',
        'sounds/weapons/smokegrenade/grenade_hit1.vsnd_c',
        'sounds/weapons/smokegrenade/smoke_emit.vsnd_c',
        'sounds/weapons/knife/knife_hit_light_flesh_01.vsnd_c',
    })
    for n in range(1, 5):
        selected.add(f'sounds/player/footsteps/concrete_ct_{n:02}.vsnd_c')
    for event_name in ('BaseGrenade.Explode', 'HEGrenade.Bounce', 'Flashbang.Explode',
                       'SmokeGrenade.Bounce', 'HEGrenade.Throw', 'HEGrenade.Draw'):
        selected.update(safe_resource(name) for name in events.get(event_name.casefold(), {}).get('vsnd_files_track_01', [])[:2])
    for cue in clip_sound_events(work, events).values():
        selected.update(cue['resources'])
    return selected, by_weapon


def export_audio(viewer, work, raw, output):
    selected, by_weapon = audio_selection(viewer, work, raw)
    # Main weapon action Foley was acquired alongside the model pilot as well.
    selected.update(str(path.relative_to(raw)) for path in raw.rglob('*.vsnd_c'))
    env = {**os.environ, 'DOTNET_BUNDLE_EXTRACT_BASE_DIR': str(ROOT / '.local/cs2/tools/bundle')}
    sounds = {}
    for resource in sorted(selected):
        if not (raw / resource).is_file():
            continue
        relative = PurePosixPath(resource).relative_to('sounds').with_suffix('.wav')
        target = output / 'sounds' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        log_path = work / 'audio-logs' / (resource.replace('/', '__') + '.log')
        log_path.parent.mkdir(exist_ok=True)
        with log_path.open('w') as log:
            subprocess.run([str(viewer), '-i', str(raw / resource), '-d', '-o', str(target)],
                           env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        header = target.read_bytes()[:12]
        if header.startswith(b'RIFF') and header[8:12] == b'WAVE':
            codec = 'wav'
        elif header.startswith(b'ID3') or (header[0] == 0xff and header[1] & 0xe0 == 0xe0):
            codec = 'mp3'
            renamed = target.with_suffix('.mp3')
            target.replace(renamed)
            target = renamed
            relative = relative.with_suffix('.mp3')
        else:
            raise ValueError('Expected verified native WAV/MP3: ' + resource)
        # Decompiler source .vsnd text is useful metadata but not browser audio.
        target.with_suffix('.vsnd').unlink(missing_ok=True)
        sounds[resource] = {'url': '/assets/cs2-content/sounds/' + str(relative), 'codec': codec,
                            'bytes': target.stat().st_size, 'sha256': sha256(target),
                            'source': source_record(raw, resource)}
    aliases = {'glock18': 'glock', 'usp': 'usp_silencer', 'm4a1': 'm4a1',
               'mp5navy': 'mp5sd', 'galil': 'galilar', 'sg552': 'sg556',
               'scout': 'ssg08', 'sg550': 'scar20', 'p228': 'p250', 'm3': 'nova', 'tmp': 'mp9'}
    legacy = {}
    catalog = (ROOT / 'public/sound-catalog.js').read_text()
    shots = catalog.split('export const SHOT_SOUNDS = Object.freeze({', 1)[1].split('});', 1)[0]
    for old_key, old_sound in re.findall(r"([a-z0-9]+):'([^']+)'", shots):
        key = 'weapon_' + aliases.get(old_key, old_key)
        event = by_weapon.get(key, {}).get('WEAPON_SOUND_SINGLE', {})
        first = next((sounds[ref]['url'] for ref in event.get('resources', []) if ref in sounds), None)
        if first:
            legacy[old_sound] = first
    # Existing CS1.6 playback's randomized alternate shot names bridge to the
    # corresponding real CS2 direct-shot family, never to distant/reverb layers.
    for old, new in list(legacy.items()):
        if old.endswith('-1.wav'):
            legacy.setdefault(old.removesuffix('-1.wav') + '-2.wav', new)
    special = {
        'weapons/ak47-2.wav': 'sounds/weapons/ak47/ak47_01.vsnd_c',
        'weapons/zoom.wav': 'sounds/weapons/awp/zoom.vsnd_c',
        'player/bhit_helmet-1.wav': 'sounds/player/headshot_armor_01.vsnd_c',
        'player/headshot1.wav': 'sounds/player/headshot_noarmor_01.vsnd_c',
        'player/bhit_kevlar-1.wav': 'sounds/player/kevlar_01.vsnd_c',
        'player/bhit_flesh-1.wav': 'sounds/physics/flesh/flesh_impact_bullet1.vsnd_c',
        'weapons/pinpull.wav': 'sounds/weapons/hegrenade/pinpull.vsnd_c',
        'weapons/flashbang-1.wav': 'sounds/weapons/flashbang/flashbang_explode1.vsnd_c',
        'weapons/flashbang-2.wav': 'sounds/weapons/flashbang/flashbang_explode2.vsnd_c',
        'weapons/hegrenade-1.wav': 'sounds/weapons/hegrenade/hegrenade_detonate_02.vsnd_c',
        'weapons/hegrenade-2.wav': 'sounds/weapons/hegrenade/hegrenade_detonate_03.vsnd_c',
        'weapons/he_bounce-1.wav': 'sounds/weapons/hegrenade/he_bounce-1.vsnd_c',
        'weapons/sg_explode.wav': 'sounds/weapons/smokegrenade/smoke_emit.vsnd_c',
        'weapons/glock18-1.wav': 'sounds/weapons/glock18/glock_02.vsnd_c',
        'weapons/m4a1-1.wav': 'sounds/weapons/m4a1/m4a1_silencer_01.vsnd_c',
        'weapons/usp1.wav': 'sounds/weapons/usp/usp_01.vsnd_c',
        'weapons/usp2.wav': 'sounds/weapons/usp/usp_02.vsnd_c',
    }
    special.update({f'player/pl_step{n}.wav': f'sounds/player/footsteps/concrete_ct_{n:02}.vsnd_c' for n in range(1, 5)})
    for old, resource in special.items():
        if resource in sounds:
            legacy[old] = sounds[resource]['url']
    bank = dump(viewer, work, raw, 'soundevents/game_sounds_weapons.vsndevts_c', 'DATA')[0]
    cue_events = clip_sound_events(work, {name.casefold(): value for name, value in bank.items()})
    for name, cue in cue_events.items():
        if any(resource not in sounds for resource in cue['resources']):
            raise ValueError('Missing native clip cue resource: ' + name)
        cue['urls'] = [sounds[resource]['url'] for resource in cue['resources']]
    write_json(output / 'audio.json', {'schema': 'cscs.cs2.audio.v1', 'sounds': sounds, 'events': cue_events,
               'eventBankSource': source_record(raw, 'soundevents/game_sounds_weapons.vsndevts_c'),
               'weaponEvents': by_weapon, 'legacy': legacy,
               'limitations': ['Direct-shot sample selection; Source2 mixer curves and engine effects are not reproduced.',
                               'Unmapped legacy names require explicit fallback policy.']})
    print('Audio decoded:', len(sounds), 'legacy bridges:', len(legacy))


def metadata(viewer, work, raw, output):
    weapons = load_weapon_data(viewer, work, raw)
    all_rows = dump(viewer, work, raw, 'scripts/weapons.vdata_c', 'DATA')[0]
    all_weapons = {name: kv3.resolve_bases(all_rows, name) for name, row in all_rows.items()
                   if name.startswith('weapon_') and name != 'weapon_base' and not row.get('_not_pickable')}
    write_json(output / 'weapons-reference.json', {
        'schema': 'cscs.cs2.weapon-reference.v1',
        'source': source_record(raw, 'scripts/weapons.vdata_c'),
        'units': {'distance': 'Source units', 'time': 'seconds', 'speed': 'Source units per second',
                  'spread': 'tangent angular ratio'},
        'legacyAliases': LEGACY_MODEL_KEYS,
        'weapons': all_weapons,
    })
    for name, resource in model_resources(weapons).items():
        if not (raw / resource).is_file():
            continue
        data = dump(viewer, work, raw, resource, 'DATA')[0]
        try:
            meshes = dump(viewer, work, raw, resource, 'MDAT')
        except ValueError:
            meshes = []
        sets, attachments = {}, {}
        for mesh in meshes:
            for row in mesh.get('m_hitboxsets', []):
                if row['key'] in sets and sets[row['key']] != row['value']:
                    raise ValueError('Hitbox sets disagree across meshes')
                sets[row['key']] = row['value']
            for row in mesh.get('m_attachments', []):
                attachments[row['key']] = row['value']
        write_json(output / 'models' / (name + '.metadata.json'), {
            'schema': 'cscs.cs2.model-metadata.v1', 'source': source_record(raw, resource),
            'units': {'distance': 'Source units', 'scaleToMeters': .0254,
                      'sourceAxes': 'X forward, Y left, Z up', 'gltfMapping': '[Y,Z,X] * 0.0254',
                      'boneLocalToGltf': 'Scale endpoint by 0.0254 only, then apply exported bone world matrix; root contains axis conversion.'},
            'modelInfo': data.get('m_modelInfo', {}), 'skeleton': data.get('m_modelSkeleton', {}),
            'hitboxSets': sets, 'attachments': attachments,
            'meshGroups': data.get('m_meshGroups', []),
            'defaultMeshGroupMask': data.get('m_nDefaultMeshGroupMask'),
            'limitations': ['Native runtime animation graphs are not executed by glTF.',
                            'Capsule endpoints and radii are bone-local Source units.'],
        })
    return weapons


def verify_gltf(path, *, require_skin=False):
    value = json.loads(path.read_text())
    if not value.get('nodes') or not value.get('meshes') or (require_skin and not value.get('skins')):
        raise ValueError('Incomplete glTF export: ' + str(path))
    for row in [*value.get('buffers', []), *value.get('images', [])]:
        uri = row.get('uri')
        if uri and not uri.startswith('data:'):
            target = path.parent / uri
            if PurePosixPath(uri).is_absolute() or '..' in PurePosixPath(uri).parts or not target.is_file():
                raise ValueError('Missing/unsafe glTF dependency: ' + str(uri))
    return value


def build_mount(raw, target):
    """Stream a compact local VPK: a texture closure need not fit twice in RAM."""
    by_extension, offset, payload = {}, 0, []
    for path in sorted(raw.rglob('*_c')):
        name = path.relative_to(raw)
        crc = 0
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                crc = zlib.crc32(chunk, crc)
        size = path.stat().st_size
        by_extension.setdefault(name.suffix[1:], {}).setdefault(str(name.parent), []).append(
            (name.stem, crc, offset, size))
        payload.append(path)
        offset += size
    if offset > 0xffffffff:
        raise ValueError('Content pilot exceeds single VPK offset limit')
    tree = bytearray()
    for extension, folders in by_extension.items():
        tree += extension.encode() + b'\0'
        for folder, entries in folders.items():
            tree += folder.encode() + b'\0'
            for name, crc, offset, size in entries:
                tree += name.encode() + b'\0' + struct.pack('<IHHIIH', crc, 0, 0x7fff, offset, size, 0xffff)
            tree += b'\0'
        tree += b'\0'
    tree += b'\0'
    temporary = target.with_suffix('.tmp')
    with temporary.open('wb') as stream:
        stream.write(struct.pack('<III', 0x55AA1234, 1, len(tree)))
        stream.write(tree)
        for path in payload:
            with path.open('rb') as source:
                shutil.copyfileobj(source, stream, 1024 * 1024)
    temporary.replace(target)


def assign_viewmodel_actions(receipts, weapons, weapon_source=None):
    available = {row['key']: row for row in receipts if '/animations/' in row['url']}
    for row in receipts:
        key = row['key']
        if key not in weapons:
            continue
        weapon = weapons[key]
        weapon_type = weapon.get('m_WeaponType', '')
        family = 'pistol' if weapon_type == 'WEAPONTYPE_PISTOL' else 'grenade' if weapon_type == 'WEAPONTYPE_GRENADE' else 'knife' if key == 'knife' else 'equipment' if key == 'c4' else 'rifle'
        source_key = {'ak47': 'ak', 'smokegrenade': 'smoke'}.get(key, key)
        expected = weapon['m_szAnimSkeleton']
        mapping, approximate = {}, []
        actions = {'draw': 'draw', 'idle': 'idle'}
        if family in ('rifle', 'pistol'):
            actions.update({'reload': 'reload', 'fire': 'shoot1'})
        elif family == 'grenade':
            actions.update({'pullpin': 'pullpin', 'pin': 'pullpin', 'hold': 'throwcharge_high',
                            'throw': 'throw_overhand', 'fire': 'throw_overhand'})
        elif family == 'knife':
            actions.update({'light': 'light_miss1', 'heavy': 'heavy_miss1', 'fire': 'light_miss1'})
        elif family == 'equipment':
            actions['plant'] = 'plant'
        if key in ('m4a1_silencer', 'usp_silencer'):
            actions.update({'silencerOn': 'silencer_attach', 'silencerOff': 'silencer_detach'})
        if key == 'elite':
            actions.update({'fire': 'shoot_left1', 'fireAlt': 'shoot_right1'})
        if key in ('aug', 'sg556'):
            actions.update({'zoomIdle': 'ironsight_fidget', 'zoomFire': 'ironsight_shoot'})
        for action, prefix in actions.items():
            specific = f'viewmodel.{family}.{prefix}_{source_key}'
            pattern = re.compile(r'^' + (r'idle\d?_' if prefix == 'idle' else re.escape(prefix) + '_'))
            candidates = [entry for candidate, entry in available.items()
                          if candidate.startswith(f'viewmodel.{family}.')
                          and pattern.match(candidate.split('.', 2)[2])
                          and expected in entry.get('secondarySkeletons', [])
                          and not entry.get('additive')]
            candidates.sort(key=lambda entry: (entry['key'] != specific,
                            any(word in entry['key'] for word in ('empty', 'silent', 'from_activity', 'slide_back')),
                            len(entry['key']), entry['key']))
            if not candidates:
                raise ValueError(f'No matching secondary skeleton for {key} {action}: {expected}')
            selected = candidates[0]['key']
            mapping[action] = selected
            # Shared directory does not imply a wrong skeleton: the original
            # default pistol/rifle clips are authored for USP-S/M4A1-S exactly.
        row['viewmodelActions'] = mapping
        row['viewmodelFamilyApproximation'] = approximate
        row['weaponSourceId'] = WEAPONS[key]
        row['weaponSkeleton'] = expected
        if key in ('aug', 'sg556'):
            row['ads'] = {'source': 'scripts/weapons.vdata_c',
                          'parameters': {name: weapon[name] for name in weapon if 'IronSight' in name},
                          'missingNativeClips': ['zoomIn', 'zoomOut'],
                          'scopeAttachments': [],
                          'limitation': 'Original model has no named scope/eye/reticle attachment. Zoom-in/out transition and reticle/lens alignment require an explicitly approximate runtime adapter.'}
            source_fields = {'pullUpSpeed': 'm_flIronSightPullUpSpeed',
                             'putDownSpeed': 'm_flIronSightPutDownSpeed', 'FOV': 'm_flIronSightFOV',
                             'pivotForward': 'm_flIronSightPivotForward', 'looseness': 'm_flIronSightLooseness'}
            row['ironSight'] = {**{name: weapon[field] for name, field in source_fields.items()},
                                'sourceFields': source_fields, 'source': weapon_source or {'path': 'scripts/weapons.vdata_c'},
                                'units': {'pivotForward': 'Source units', 'FOV': 'degrees'},
                                'limitation': 'Factual original parameters; browser lens/reticle and transition interpretation remain approximate.'}


def export_content(viewer, work, raw, output, weapons, texture_size, model_filter=None, clip_filter=None):
    from PIL import Image
    mount = work / 'mount'
    mount.mkdir(exist_ok=True)
    build_mount(raw, mount / 'pak01_dir.vpk')
    (mount / 'gameinfo.gi').write_text('"GameInfo" { "FileSystem" { "SearchPaths" { "Game" "' + str(mount) + '" } } }')
    env = {**os.environ, 'DOTNET_BUNDLE_EXTRACT_BASE_DIR': str(ROOT / '.local/cs2/tools/bundle')}
    models = model_resources(weapons)
    targets = [(key, resource, output / 'models' / key / (key + '.gltf'), True)
               for key, resource in models.items() if (raw / resource).is_file()
               and (model_filter is None or key in model_filter)]
    for path in sorted(raw.rglob('*.vnmclip_c')):
        resource = str(path.relative_to(raw))
        parts = PurePosixPath(resource).parts
        scope, family, name = parts[2], parts[3], path.stem
        clip_key = f'{scope}.{family}.{name}'
        if clip_filter is not None and clip_key not in clip_filter:
            continue
        targets.append((clip_key, resource,
                        output / 'animations' / scope / family / (name + '.gltf'), False))
    receipt_path = work / 'export-receipts.json'
    target_keys = {row[0] for row in targets}
    receipts = [row for row in json.loads(receipt_path.read_text()) if row['key'] not in target_keys] if receipt_path.is_file() else []
    for key, resource, target, model in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        log_path = work / 'export-logs' / (key + '.log')
        log_path.parent.mkdir(exist_ok=True)
        command = [str(viewer), '-i', str(mount / 'pak01_dir.vpk'), '-f', resource, '-d',
                   '--game', str(mount / 'gameinfo.gi'), '--gltf_export_format', 'gltf',
                   '--gltf_export_animations', '--gltf_export_extras', '-o', str(target)]
        if model:
            command += ['--gltf_export_materials', '--gltf_textures_adapt']
            if key in ('ctm_sas', 'tm_phoenix'):
                command += ['--gltf_mesh_list', 'thirdperson_body,thirdperson_default_gloves,defusekit']
            if key not in MODELS:
                ctrl = dump(viewer, work, raw, resource, 'CTRL')[0]
                mesh_names = [row.get('m_Name') for row in ctrl.get('embedded_meshes', [])]
                if 'body_hd' in mesh_names:
                    command += ['--gltf_mesh_list', 'body_hd']
        with log_path.open('w') as log:
            subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        text = log_path.read_text()
        if any(token in text for token in ('Exception:', 'Failed to export', 'Failed to load texture', 'ERROR:')):
            raise ValueError('Converter reported an incomplete export: ' + str(log_path))
        gltf = verify_gltf(target, require_skin=model and key not in ('hegrenade', 'flashbang', 'smokegrenade'))
        if not model and not gltf.get('animations'):
            raise ValueError('Animation clip exported without animation: ' + resource)
        # Original glTF/PNG is retained only in local raw/export cache. Browser
        # delivery is capped to 1k by default to avoid multi-hundred-MB textures.
        for image in gltf.get('images', []):
            path = target.parent / image['uri']
            with Image.open(path) as source:
                if max(source.size) > texture_size:
                    source.thumbnail((texture_size, texture_size), Image.Resampling.LANCZOS)
                    source.save(path)
        receipt = {'key': key, 'source': source_record(raw, resource),
                         'url': '/assets/cs2-content/' + str(target.relative_to(output)),
                         'meshes': len(gltf.get('meshes', [])), 'skins': len(gltf.get('skins', [])),
                         'bones': [node.get('name') for node in gltf['nodes'] if 'mesh' not in node],
                         'animations': [row.get('name') for row in gltf.get('animations', [])]}
        receipt['deferredEngineDependencies'] = [line.strip() for line in text.splitlines()
                                                  if line.startswith(('Failed to load "animation/graphs/', 'Failed to find shader '))]
        if model:
            receipt['metadata'] = '/assets/cs2-content/models/' + key + '.metadata.json'
            if key in ('ctm_sas', 'tm_phoenix'):
                receipt['actions'] = {action: 'world.rifle.' + name for action, name in {
                    'idle': 'idle_rifle', 'run': 'run_n_rifle', 'walk': 'walk_n_rifle',
                    'crouch': 'idle_crouch_rifle', 'crouchMove': 'crouch_n_rifle',
                    'jump': 'jump_stand_rifle', 'inair': 'inair_stand_rifle',
                    'fire': 'shoot_rifle.vnmclip+non_additive',
                }.items()}
        else:
            data = dump(viewer, work, raw, resource, 'DATA')[0]
            receipt.update({'name': gltf['animations'][0].get('name'),
                            'skeleton': data['m_skeleton'], 'frames': data['m_nNumFrames'],
                            'secondarySkeletons': [row['m_skeleton'] for row in data.get('m_secondaryAnimations', [])],
                            'duration': data['m_flDuration'], 'additive': data['m_bIsAdditive'],
                            'staticPose': data['m_nNumFrames'] == 1 and data['m_flDuration'] == 0,
                            'events': data.get('m_events', []),
                            'rootMotion': {'source': data.get('m_rootMotion', {}),
                                           'runtimePolicy': 'inPlace: remove horizontal root translation identically on server and client'}})
        receipts.append(receipt)
        print('Exported', key, flush=True)
    for row in receipts:
        if row['key'] in ('ctm_sas', 'tm_phoenix'):
            row['actions']['fire'] = 'world.rifle.shoot_rifle.vnmclip+non_additive'
            present = {entry['key'] for entry in receipts}
            for action, name in {'hit': 'flinch_chest.vnmclip+non_additive',
                                 'hitHead': 'flinch_head.vnmclip+non_additive',
                                 'death': 'death_chest_a'}.items():
                if 'world.shared.' + name in present:
                    row['actions'][action] = 'world.shared.' + name
            row['hitActionsByFamily'] = {family: {
                action: f'world.shared.flinch_{location}{suffix}.vnmclip+non_additive'
                for action, location in [('hit', 'chest'), ('hitHead', 'head')]}
                for family, suffix in [('rifle', ''), ('pistol', '_pistol'), ('knife', '_knife')]}
    assign_viewmodel_actions(receipts, weapons, source_record(raw, 'scripts/weapons.vdata_c'))
    write_json(receipt_path, receipts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('catalog', 'requests', 'expand', 'audio-requests', 'delta', 'metadata', 'export', 'audio', 'manifest'))
    parser.add_argument('--index-root', type=Path, default=ROOT / '.local/cs2/textured/source-index')
    parser.add_argument('--work', type=Path, default=ROOT / '.local/cs2/content')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/cs2-content')
    parser.add_argument('--viewer', type=Path, default=ROOT / '.local/cs2/tools/source2viewer/Source2Viewer-CLI')
    parser.add_argument('--texture-size', type=int, default=1024)
    parser.add_argument('--models', help='Optional comma-separated model keys for staged export')
    parser.add_argument('--clips', help='Optional comma-separated clip keys for incremental export')
    args = parser.parse_args()
    work, output, viewer = args.work.resolve(), args.output.resolve(), args.viewer.resolve()
    if not 128 <= args.texture_size <= 2048:
        parser.error('Texture delivery cap must be 128..2048')
    work.mkdir(parents=True, exist_ok=True)
    raw = work / 'raw'
    if args.stage in ('metadata', 'export', 'audio'):
        index = {row['path']: row for row in json.loads((work / 'index.json').read_text())}
        verified = verify_originals(raw, index)
        write_json(work / 'original-verification.json', verified)
    if args.stage == 'catalog':
        write_json(work / 'index.json', list(source_index(args.index_root).values()))
    elif args.stage == 'delta':
        index = {row['path']: row for row in json.loads((work / 'index.json').read_text())}
        missing = []
        for name in json.loads((work / 'requests.json').read_text()):
            safe_resource(name)  # Validate traversal; plain cfg/txt keeps its extension.
            path = raw / name
            if not path.is_file():
                missing.append(name)
                continue
            crc = 0
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    crc = zlib.crc32(chunk, crc)
            row = index[name]
            if path.stat().st_size != row['bytes'] + row['preloadBytes'] or f'{crc:08x}' != row['crc32']:
                missing.append(name)
        write_json(work / 'requests-delta.json', missing)
        print('Missing or CRC-invalid resources:', len(missing))
    elif args.stage in ('requests', 'expand', 'audio-requests'):
        index = {row['path']: row for row in json.loads((work / 'index.json').read_text())}
        if args.stage == 'requests':
            weapons = load_weapon_data(viewer, work, raw)
            requested, missing = select_roots(index, weapons)
            deferred = []
        elif args.stage == 'expand':
            requested, missing, deferred = expand_resources(raw, index, set(json.loads((work / 'requests.json').read_text())))
        else:
            selected, _ = audio_selection(viewer, work, raw)
            requested = set(json.loads((work / 'requests.json').read_text())) | (selected & index.keys())
            missing, deferred = sorted(selected - index.keys()), []
        write_json(work / 'requests.json', sorted(requested))
        write_json(work / 'closure-report.json', {'requestedResources': len(requested),
                   'resourceBytes': sum(index[path]['bytes'] + index[path]['preloadBytes'] for path in requested),
                   'missingReferences': missing, 'deferredEngineGraphsAndParticles': deferred})
        print((work / 'closure-report.json').read_text())
    elif args.stage == 'metadata':
        metadata(viewer, work, raw, output)
    elif args.stage == 'export':
        export_content(viewer, work, raw, output, load_weapon_data(viewer, work, raw), args.texture_size,
                       set(args.models.split(',')) if args.models else None,
                       set(args.clips.split(',')) if args.clips else None)
    elif args.stage == 'audio':
        export_audio(viewer, work, raw, output)
    else:
        receipts = json.loads((work / 'export-receipts.json').read_text())
        files = [{'path': str(path.relative_to(output)), 'bytes': path.stat().st_size, 'sha256': sha256(path)}
                 for path in sorted(output.rglob('*')) if path.is_file()
                 and path.name not in ('manifest.json', 'runtime.json')
                 and path.relative_to(output).parts[0] != 'rigs']
        old_manifest = json.loads((output / 'manifest.json').read_text()) if (output / 'manifest.json').is_file() else {}
        write_json(output / 'manifest.json', {**old_manifest,
                   'schema': 'cscs.cs2.content.v1', 'sourceManifest': MANIFEST_ID,
                   'gltfUnits': 'meters', 'gltfAxes': 'Y up; Source (X,Y,Z) maps to (Y,Z,X)', 'sourceUnitsToMeters': .0254,
                   'legacyModelKeys': {key: LEGACY_MODEL_KEYS.get(key, key) for key in
                       ('glock18','usp','p228','deagle','elite','fiveseven','m3','xm1014','mac10','tmp','mp5navy','ump45','p90',
                        'galil','famas','ak47','m4a1','aug','sg552','scout','awp','g3sg1','sg550','m249','knife','hegrenade','flashbang','smokegrenade','c4')},
                   'models': [row for row in receipts if '/models/' in row['url']],
                   'clips': [row for row in receipts if '/animations/' in row['url']],
                   'audio': '/assets/cs2-content/audio.json' if (output / 'audio.json').is_file() else None,
                   'files': files, 'totalBytes': sum(row['bytes'] for row in files),
                   'limitations': ['A content pilot, not the Source 2 runtime.',
                                   'Engine anim graphs and shaders require explicit application adapters.',
                                   'Material glTF PBR is an approximation; delivered textures capped to 1024.']})


if __name__ == '__main__':
    main()
