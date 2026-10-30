#!/usr/bin/env python3
"""Bounded local-only preparation of original-name WAVs (no redistribution grant).

--source DIR accepts a sound/ directory. --fetch explicitly opts in to community
mirrors; cached/local files are never overwritten, including corrupt files.
--materials optionally prepares sound/materials.txt. See the audio sources doc.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import io
import json
import os
import re
import struct
import time
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/sounds'
MIRRORS = [
    'https://luxserv.ge/cstrike/sound/',
    'https://packnt.com/files/games/gamecache/cstrike_new/pb/sound/',
]
SAFE = re.compile(r'(?:weapons|player|items|radio|buttons|debris|ambience|common)/[a-zA-Z0-9_-]+\.wav', re.ASCII)
BUDGET = 512
MAX_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 20
MAX_MATERIAL_BYTES = 256 * 1024
MAX_MODELS = 64
MAX_MODEL_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024


def safe_sound(name):
    return isinstance(name, str) and SAFE.fullmatch(name) is not None


def collect_names(root=ROOT):
    text = (root / 'public/sound-catalog.js').read_text()
    # Extract quoted literal paths ONLY (not JS source evaluation). Both quote styles.
    literals = re.findall(r'''["']((?:weapons|player|items|radio|buttons|debris|ambience|common)/[^"'\r\n]+\.wav)["']''', text)
    names = set()
    for name in literals:
        if not safe_sound(name):
            raise ValueError('Unsafe catalog sound: ' + name)
        names.add(name)
    models = sorted((root / 'public/assets/weapons').glob('*/model.json'))
    if len(models) > MAX_MODELS:
        raise ValueError('Model scan budget exceeded')
    model_refs = {}
    for path in models:
        if path.stat().st_size > MAX_MODEL_BYTES:
            raise ValueError('Model JSON byte limit: ' + str(path))
        model = json.loads(path.read_text())
        for seq in model.get('sequences', []):
            for event in seq.get('events', []):
                if event.get('event') != 5004:
                    continue
                name = event.get('options', '')
                if not safe_sound(name):
                    raise ValueError('Unsafe MDL5004 sound: ' + repr(name))
                names.add(name)
                model_refs.setdefault(name, []).append({'model': path.parent.name, 'sequence': seq.get('label', seq.get('name')), 'frame': event.get('frame')})
    if not names or len(names) > BUDGET:
        raise ValueError('Sound budget exceeded or empty catalog: ' + str(len(names)))
    return sorted(names), model_refs


def validate_wav(data):
    if not 44 <= len(data) <= MAX_BYTES:
        raise ValueError('WAV byte limit (44..2097152)')
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('Not RIFF/WAVE')
    if struct.unpack_from('<I', data, 4)[0] + 8 != len(data):
        raise ValueError('RIFF declared size mismatch/truncation')
    # Some legacy GoldSrc WAVs omit RIFF odd-byte padding (also before LIST).
    # Preserve bytes; accept only a complete chunk at the unpadded boundary,
    # never relax declared RIFF size or PCM completeness.
    warnings = []
    pos = 12
    known_chunks = {b'fmt ', b'data', b'LIST', b'cue ', b'fact', b'JUNK', b'smpl', b'PAD '}
    while pos < len(data):
        if pos + 8 > len(data):
            raise ValueError('Truncated RIFF chunk header')
        size = struct.unpack_from('<I', data, pos + 4)[0]
        end = pos + 8 + size
        if end > len(data):
            raise ValueError('Truncated RIFF chunk')
        pos = end
        if size & 1:
            if end == len(data):
                warnings.append('legacy-missing-final-odd-byte-padding')
            elif data[end:end + 4] in known_chunks and end + 8 <= len(data) and end + 8 + struct.unpack_from('<I', data, end + 4)[0] <= len(data):
                warnings.append('legacy-missing-interchunk-odd-byte-padding')
            else:
                pos += 1
                if pos > len(data):
                    raise ValueError('Missing RIFF padding')
    with wave.open(io.BytesIO(data), 'rb') as wav:
        channels, width, rate, frames = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
        if wav.getcomptype() != 'NONE' or channels not in (1, 2) or width not in (1, 2, 3, 4) or not 8000 <= rate <= 96000 or frames <= 0:
            raise ValueError('Unsupported PCM format/channels/rate/frames')
        duration = frames / rate
        if duration > MAX_SECONDS:
            raise ValueError('WAV duration >20 seconds')
        if len(wav.readframes(frames)) != frames * channels * width:
            raise ValueError('Truncated PCM data')
    return {'channels': channels, 'sampleWidth': width, 'sampleRate': rate, 'frames': frames, 'durationSeconds': duration, 'validationWarnings': warnings}


def validate_materials(data):
    if not data or len(data) > MAX_MATERIAL_BYTES or b'\x00' in data:
        raise ValueError('materials.txt byte/encoding limit')
    text = data.decode('ascii')
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        line = line.split('//', 1)[0].strip()
        if not re.fullmatch(r'[CMDVGTSWPXYFN]\s+[^\s]{1,32}', line):
            raise ValueError('Invalid materials.txt row: ' + line[:80])
        entries.append(line)
    if not entries or len(entries) > 4096:
        raise ValueError('materials.txt entry limit')
    return {'entries': len(entries)}


def checked_target(out, name):
    target = out / name
    resolved = target.resolve()
    if target.is_symlink() or not resolved.is_relative_to(out.resolve()):
        raise ValueError('Unsafe/symlink target: ' + name)
    return target


def get_bytes(url, limit, timeout=12, deadline=None):
    if urllib.parse.urlsplit(url).scheme not in ('https', 'http'):
        raise ValueError('Mirror must be HTTP(S)')
    request = urllib.request.Request(url, headers={'User-Agent': 'LAN-Strike-local-audio-preparer/2'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        final_url = response.geturl()
        if urllib.parse.urlsplit(final_url).scheme not in ('https', 'http'):
            raise ValueError('Unsafe mirror redirect')
        length = response.headers.get('Content-Length')
        if length is not None and int(length) > limit:
            raise ValueError('HTTP Content-Length exceeds byte limit')
        data = bytearray()
        while True:
            if deadline is not None and time.monotonic() > deadline:
                raise TimeoutError('Overall fetch deadline')
            # HTTPResponse.read1 performs at most one underlying read, so the
            # overall deadline is checked even on a slowly trickling response.
            chunk = response.read1(min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > limit:
                raise ValueError('HTTP body exceeds byte limit')
        if length is not None and len(data) != int(length):
            raise ValueError('HTTP Content-Length mismatch')
        return bytes(data), final_url


def prepare_one(name, args, previous, deadline):
    validator = validate_materials if name == 'materials.txt' else validate_wav
    limit = MAX_MATERIAL_BYTES if name == 'materials.txt' else MAX_BYTES
    errors, attempts = [], []
    try:
        target = checked_target(OUT, name)
        old = previous.get(name, {})
        if target.exists():
            if not target.is_file() or target.stat().st_size > limit:
                raise ValueError('Existing file type/byte limit')
            data = target.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if old.get('sha256') and digest != old['sha256']:
                raise ValueError('Existing asset SHA256 mismatch; preserved, not refetched')
            info = validator(data)
            return name, {**old, **info, 'source': 'local-wav' if name != 'materials.txt' else 'local-materials', 'acquiredBy': old.get('acquiredBy', 'existing-unattributed'), 'sha256': digest, 'bytes': len(data), 'cacheIntegrity': 'sha256-match' if old.get('sha256') else 'first-seen-valid', 'retailHashVerified': False, 'redistributionLicense': 'unknown'}
        data, origin, info = None, {}, {}
        if args.source:
            source = args.source.resolve() / name
            if not source.resolve().is_relative_to(args.source.resolve()):
                raise ValueError('Source path escapes root')
            if source.is_file():
                if source.stat().st_size > limit:
                    raise ValueError('Local source byte limit')
                data = source.read_bytes()
                info = validator(data)
                origin = {'acquiredBy': 'local-source', 'sourcePath': str(source)}
        if data is None and args.fetch:
            for base in args.mirrors:
                url = base.rstrip('/') + '/' + name
                attempt = {'url': url}
                attempts.append(attempt)
                try:
                    if time.monotonic() > deadline:
                        raise TimeoutError('Overall fetch deadline')
                    candidate, final_url = get_bytes(url, limit, args.timeout, deadline)
                    info = validator(candidate)  # Validate fully before accepting a mirror.
                    data = candidate
                    attempt.update({'ok': True, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
                    origin = {'acquiredBy': 'community-mirror', 'url': url, 'resolvedURL': final_url}
                    break
                except Exception as error:
                    attempt['error'] = str(error)
                    errors.append(url + ': ' + str(error))
        if data is None:
            return name, {'source': 'unavailable', 'errors': errors, 'attempts': attempts}
        target.parent.mkdir(exist_ok=True, parents=True)
        # Exclusive creation prevents accidentally overwriting user files/a concurrent worker.
        with target.open('xb') as handle:
            handle.write(data)
        return name, {**info, **origin, 'source': 'local-wav' if name != 'materials.txt' else 'local-materials', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'attempts': attempts, 'retailHashVerified': False, 'redistributionLicense': 'unknown'}
    except Exception as error:
        # Keep prior checksum/provenance even for corruption, so reruns cannot bless a changed cache.
        return name, {**previous.get(name, {}), 'source': 'unavailable', 'errors': errors + [str(error)], 'attempts': attempts, 'preservedExisting': (OUT / name).exists()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--materials', action='store_true')
    parser.add_argument('--mirror', action='append', default=[], help='Additional fallback sound/ root (max 6 total mirrors)')
    parser.add_argument('--timeout', type=float, default=12, help='Per-request socket timeout (1..30 seconds)')
    parser.add_argument('--deadline', type=float, default=600, help='Whole fetch run deadline (1..1800 seconds)')
    parser.add_argument('--strict', action='store_true', help='Exit nonzero if any requested asset is unavailable')
    args = parser.parse_args()
    if not args.source and not args.fetch:
        parser.error('Choose --source or --fetch (cache is validated in either mode)')
    if not 1 <= args.timeout <= 30 or not 1 <= args.deadline <= 1800:
        parser.error('Timeout/deadline outside bounds')
    args.mirrors = list(dict.fromkeys(MIRRORS + args.mirror))
    if len(args.mirrors) > 6:
        parser.error('Mirror budget exceeded')
    for base in args.mirrors:
        parts = urllib.parse.urlsplit(base)
        if parts.scheme not in ('https', 'http') or not parts.netloc or parts.query or parts.fragment or parts.username or parts.password:
            parser.error('Invalid HTTP(S) mirror root')
    names, model_refs = collect_names()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = checked_target(OUT, 'manifest.json')
    previous_manifest = json.loads(manifest.read_text()) if manifest.is_file() else {}
    previous = previous_manifest.get('assets', {})
    selected = names + (['materials.txt'] if args.materials else [])
    entries = {}
    deadline = time.monotonic() + args.deadline
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(prepare_one, name, args, previous, deadline) for name in selected]
        for future in concurrent.futures.as_completed(futures):
            name, entry = future.result()
            entries[name] = entry
            print(('Ready: ' if entry['source'] != 'unavailable' else 'Unavailable: ') + name, flush=True)
    ready = sorted(n for n in names if entries[n]['source'] == 'local-wav')
    missing = sorted(set(names) - set(ready))
    total_bytes = sum(e.get('bytes', 0) for e in entries.values() if e['source'] != 'unavailable')
    if total_bytes > MAX_TOTAL_BYTES:
        raise ValueError('Aggregate asset byte budget exceeded')
    document = {
        'schema': 'local-sounds-v2', 'preparedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'policy': 'Local testing only; community mirrors not retail verified; redistribution permission unknown',
        'limits': {'sounds': BUDGET, 'bytesPerWav': MAX_BYTES, 'secondsPerWav': MAX_SECONDS, 'totalBytes': MAX_TOTAL_BYTES},
        'summary': {'requested': len(names), 'ready': len(ready), 'missing': len(missing), 'readyNames': ready, 'missingNames': missing, 'bytes': total_bytes},
        'modelEvent5004': model_refs,
        # Preserve unselected receipts (e.g. an earlier optional materials.txt fetch).
        'assets': {**previous, **dict(sorted(entries.items()))},
    }
    temp = OUT / ('manifest.' + str(os.getpid()) + '.tmp')
    with temp.open('x') as handle:
        json.dump(document, handle, indent=2)
        handle.write('\n')
    temp.replace(manifest)
    print(f'Prepared {len(ready)}/{len(names)} local WAV files; {len(missing)} missing; {total_bytes} validated bytes; assets remain ignored.')
    if args.strict and (missing or (args.materials and entries['materials.txt']['source'] == 'unavailable')):
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
