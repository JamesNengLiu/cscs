#!/usr/bin/env python3
"""Fetch MDLv10 DATA ONLY for private validation; no redistribution grant implied."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

IDS = 'glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249 knife hegrenade flashbang smokegrenade c4 shield'.split()
ROOT = Path(__file__).resolve().parents[1] / 'public/assets/weapons'
GITHUB = 'https://raw.githubusercontent.com/professorDeveloper/CS-1.6/main/'
MIRROR = 'https://www.vertigogaming.org/downloads/cstrike/models/'
MAX_BYTES = 16 * 1024 * 1024


def filename(weapon):
    return 'shield/v_shield_knife.mdl' if weapon == 'shield' else f'v_{"mp5" if weapon == "mp5navy" else weapon}.mdl'


def download(url):
    if not url.startswith('https://'):
        raise ValueError('Only HTTPS data sources are accepted')
    request = urllib.request.Request(url, headers={'User-Agent': 'MDL-data-validation/1.0'})
    with urllib.request.urlopen(request, timeout=35) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Refusing non-HTTPS redirect')
        data = response.read(MAX_BYTES + 1)
        final_url = response.url
    if not 244 <= len(data) <= MAX_BYTES or data[:8] != b'IDST\x0a\x00\x00\x00':
        raise ValueError('Response is not a bounded GoldSrc MDLv10 file')
    if struct.unpack_from('<i', data, 72)[0] != len(data):
        raise ValueError('MDL declared length differs from downloaded bytes')
    return data, final_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT)
    parser.add_argument('--ids', nargs='+', choices=IDS, default=IDS)
    parser.add_argument('--compare-mirror', action='store_true', help='Record an independent mirror hash comparison (not retail authentication)')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / 'sources.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'assets': {}}
    manifest.update({'schemaVersion': 1, 'rights': 'Private local validation only. Public availability does not establish a redistribution license.',
                     'authenticity': 'Original-format source assets from public mirrors; not authenticated against a licensed retail installation.'})

    def fetch(weapon):
        name = filename(weapon)
        urls = [GITHUB + name, MIRROR + name] if weapon != 'shield' else [MIRROR + name, GITHUB + name]
        failures = []
        for url in urls:
            try:
                data, final = download(url)
                path = args.out / 'raw' / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                entry = {'id': weapon, 'file': str(path.relative_to(args.out)), 'url': url, 'resolvedURL': final,
                         'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'format': 'GoldSrc MDLv10',
                         'retrievedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                         'retailHashVerified': False, 'failedAttempts': failures}
                if args.compare_mirror:
                    other = next(x for x in urls if x != url)
                    try:
                        other_data, other_final = download(other)
                        entry['mirrorComparison'] = {'url': other_final, 'sha256': hashlib.sha256(other_data).hexdigest(), 'identical': data == other_data}
                    except Exception as error:
                        entry['mirrorComparison'] = {'url': other, 'error': str(error)}
                return weapon, entry
            except Exception as error:
                failures.append({'url': url, 'error': str(error)})
        return weapon, {'id': weapon, 'error': 'No valid MDLv10 download', 'failedAttempts': failures}

    failed = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for weapon, entry in pool.map(fetch, args.ids):
            manifest['assets'][weapon] = entry
            print(weapon, entry.get('sha256', entry.get('error')), flush=True)
            failed |= 'error' in entry
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
