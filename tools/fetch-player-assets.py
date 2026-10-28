#!/usr/bin/env python3
"""Acquire bounded raw MDLv10 data; rights unknown, private ignored output only."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'public/assets/players'
IDS = 'terror leet arctic guerilla urban gsg9 sas gign'.split()
WEAPON_IDS = 'glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249'.split()
OPTIONAL_WEAPONS = 'knife hegrenade flashbang smokegrenade'.split()
PRIMARY = 'https://www.vertigogaming.org/downloads/cstrike/models/'
COMPARISON = 'https://raw.githubusercontent.com/professorDeveloper/CS-1.6/main/'
MAX_BYTES = 16 * 1024 * 1024
RIGHTS = 'unknown; public availability does not establish redistribution rights'


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def asset_path(kind, identity):
    if kind == 'models' and identity in IDS:
        return f'player/{identity}/{identity}.mdl'
    if kind == 'weapons' and identity in WEAPON_IDS + OPTIONAL_WEAPONS:
        return f'p_{"mp5" if identity == "mp5navy" else identity}.mdl'
    raise ValueError('Unknown asset kind or ID')


def validate(data):
    if not 244 <= len(data) <= MAX_BYTES or data[:8] != b'IDST\x0a\0\0\0':
        raise ValueError('Response is not a bounded MDLv10 file')
    if struct.unpack_from('<i', data, 72)[0] != len(data):
        raise ValueError('MDL declared length differs from downloaded bytes')


def download(url):
    if not url.startswith('https://'):
        raise ValueError('Only HTTPS data sources are accepted')
    request = urllib.request.Request(url, headers={'User-Agent': 'MDLv10-player-data-validation/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Refusing non-HTTPS redirect')
        length = response.headers.get('Content-Length')
        if length is not None and not 244 <= int(length) <= MAX_BYTES:
            raise ValueError('Invalid or excessive response length')
        data = response.read(MAX_BYTES + 1)
        final = response.url
    validate(data)
    return data, final


def contained(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Asset path escapes output root')
    return path


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT)
    parser.add_argument('--ids', nargs='+', choices=IDS, default=IDS)
    parser.add_argument('--compare-mirror', action='store_true')
    parser.add_argument('--weapons', action='store_true', help='Also fetch the 24 canonical p_* firearm models')
    parser.add_argument('--weapons-only', action='store_true')
    parser.add_argument('--weapon-ids', nargs='+', choices=WEAPON_IDS + OPTIONAL_WEAPONS, default=WEAPON_IDS)
    args = parser.parse_args()
    root = args.out.resolve()
    if not root.is_relative_to(ROOT.resolve()):
        parser.error('Output must remain under ignored public/assets/players/')
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = contained(root, 'sources.json')
    if manifest_path.exists() and manifest_path.stat().st_size > 2 * 1024 * 1024:
        parser.error('Source manifest exceeds 2 MiB')
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.update({'schema': 'goldsrc-player-sources-v1', 'rights': RIGHTS,
                     'retailHashVerified': False, 'authenticity': 'Public mirrors; not authenticated against a licensed retail installation'})
    manifest.setdefault('models', {})
    manifest.setdefault('weapons', {})
    jobs = [] if args.weapons_only else [('models', i) for i in dict.fromkeys(args.ids)]
    if args.weapons or args.weapons_only:
        jobs += [('weapons', i) for i in dict.fromkeys(args.weapon_ids)]

    def fetch(job):
        kind, identity = job
        name = asset_path(kind, identity)
        url = PRIMARY + name
        entry = {'id': identity, 'url': url, 'attemptedUTC': utc(), 'rights': RIGHTS, 'retailHashVerified': False}
        try:
            data, final = download(url)
            relative = f'raw/{name}'
            path = contained(root, relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            # Immutable source: never overwrite an acquired binary, even if a mirror changes.
            if path.exists():
                if path.stat().st_size != len(data) or path.read_bytes() != data:
                    raise ValueError('Existing raw source differs; refusing to overwrite it')
            else:
                with path.open('xb') as output:
                    output.write(data)
            entry.update({'file': relative, 'resolvedURL': final, 'retrievedUTC': utc(),
                          'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'format': 'GoldSrc MDLv10'})
            previous = manifest[kind].get(identity, {})
            entry['firstRetrievedUTC'] = previous.get('firstRetrievedUTC', previous.get('retrievedUTC', entry['retrievedUTC']))
            if args.compare_mirror:
                other_url = COMPARISON + name
                comparison = {'url': other_url, 'attemptedUTC': utc(), 'rights': RIGHTS}
                try:
                    other, resolved = download(other_url)
                    comparison.update({'resolvedURL': resolved, 'retrievedUTC': utc(), 'bytes': len(other),
                                       'sha256': hashlib.sha256(other).hexdigest(), 'identical': data == other})
                except (OSError, ValueError) as error:
                    comparison['error'] = str(error)
                entry['mirrorComparison'] = comparison
            elif previous.get('mirrorComparison'):
                entry['mirrorComparison'] = previous['mirrorComparison']
        except (OSError, ValueError) as error:
            entry.update({'status': 'unavailable', 'error': str(error)})
            previous = manifest[kind].get(identity)
            if previous and previous.get('sha256'):
                # Keep the original acquisition evidence and record the failed refresh separately.
                entry = {**previous, 'lastFetchFailure': entry}
        return kind, identity, entry

    failed = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for kind, identity, entry in pool.map(fetch, jobs):
            manifest[kind][identity] = entry
            failure = entry.get('error') or entry.get('lastFetchFailure')
            failed |= bool(failure)
            print(kind, identity, 'FAILED: ' + str(failure) if failure else entry['sha256'], flush=True)
    manifest['updatedUTC'] = utc()
    atomic_json(manifest_path, manifest)
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
