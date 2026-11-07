"""Bounded reader for Source2Viewer's text KV3 metadata (never executes input).

Compiled game resources remain local. This independently authored parser only
accepts the text subset emitted by the pinned viewer, including typed strings.
"""
import argparse
import json
import math
from pathlib import Path
import re


class TextKV3:
    def __init__(self, text, *, max_bytes=64 * 1024 * 1024):
        if len(text.encode('utf-8')) > max_bytes:
            raise ValueError('KV3 text limit exceeded')
        self.text, self.at, self.depth, self.items = text, 0, 0, 0

    def ws(self):
        while self.at < len(self.text):
            if self.text[self.at].isspace() or self.text[self.at] == ',':
                self.at += 1
            elif self.text.startswith('<!--', self.at):
                end = self.text.find('-->', self.at + 4)
                if end < 0:
                    raise ValueError('Unterminated KV3 header')
                self.at = end + 3
            else:
                break

    def string(self):
        if self.text.startswith('"""', self.at):
            end = self.text.find('"""', self.at + 3)
            if end < 0:
                raise ValueError('Unterminated KV3 multiline string')
            value = self.text[self.at + 3:end]
            self.at = end + 3
            return value
        try:
            value, consumed = json.JSONDecoder().raw_decode(self.text[self.at:])
        except json.JSONDecodeError as error:
            raise ValueError('Invalid KV3 string') from error
        if not isinstance(value, str):
            raise ValueError('Expected a quoted string')
        self.at += consumed
        return value

    def word(self):
        self.ws()
        match = re.match(r'[^\s,\[\]{}=:"#]+', self.text[self.at:self.at + 4096])
        if not match:
            raise ValueError(f'Invalid KV3 token at {self.at}')
        self.at += len(match[0])
        return match[0]

    def value(self):
        self.ws()
        self.items += 1
        if self.items > 2000000 or self.depth > 64 or self.at >= len(self.text):
            raise ValueError('KV3 size/nesting limit exceeded')
        char = self.text[self.at]
        if char == '"':
            return self.string()
        if self.text.startswith('#[', self.at):
            end = self.text.find(']', self.at + 2)
            if end < 0:
                raise ValueError('Unterminated KV3 binary blob')
            raw = self.text[self.at + 2:end]
            if not re.fullmatch(r'[\s0-9A-Fa-f]*', raw) or len(''.join(raw.split())) % 2:
                raise ValueError('Invalid KV3 binary blob')
            self.at = end + 1
            return {'$binaryHex': ''.join(raw.split()).lower()}
        if char in '{[':
            self.at += 1
            self.depth += 1
            result = {} if char == '{' else []
            end = '}' if char == '{' else ']'
            while True:
                self.ws()
                if self.at >= len(self.text):
                    raise ValueError('Unterminated KV3 collection')
                if self.text[self.at] == end:
                    self.at += 1
                    self.depth -= 1
                    return result
                if char == '{':
                    key = self.string() if self.text[self.at] == '"' else self.word()
                    self.ws()
                    if self.at >= len(self.text) or self.text[self.at] != '=':
                        raise ValueError('Expected KV3 assignment')
                    if key in result:
                        raise ValueError('Duplicate KV3 key: ' + key)
                    self.at += 1
                    result[key] = self.value()
                else:
                    result.append(self.value())
        word = self.word()
        self.ws()
        if self.at < len(self.text) and self.text[self.at] == ':':
            self.at += 1
            self.ws()
            if self.at >= len(self.text) or self.text[self.at] != '"':
                raise ValueError('Expected typed KV3 string')
            # Type tags are retained, rather than silently stripping resource /
            # soundevent / resource_name distinctions used by weapon metadata.
            return {'$type': word, 'value': self.string()}
        if word in ('true', 'false', 'null'):
            return {'true': True, 'false': False, 'null': None}[word]
        try:
            value = float(word) if any(c in word for c in '.eE') else int(word, 16 if word.startswith('0x') else 10)
        except ValueError as error:
            raise ValueError('Unknown KV3 scalar: ' + word) from error
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('Non-finite KV3 scalar')
        return value

    def read(self):
        result = self.value()
        self.ws()
        if self.at != len(self.text):
            raise ValueError('Trailing KV3 data')
        return result


def blocks(text, kind='DATA'):
    pattern = re.compile(r'^--- Data for block "([^"]+)" ---\s*$', re.M)
    matches = list(pattern.finditer(text))
    result = []
    for i, match in enumerate(matches):
        if match[1] == kind:
            value = text[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)]
            result.append(TextKV3(value).read())
    if not result:
        raise ValueError('Missing resource block: ' + kind)
    return result


def untyped(value):
    if isinstance(value, dict):
        if set(value) == {'$type', 'value'}:
            return value['value']
        return {key: untyped(item) for key, item in value.items()}
    if isinstance(value, list):
        return [untyped(item) for item in value]
    return value


def resolve_bases(rows, name, stack=()):
    if name in stack or name not in rows:
        raise ValueError('Missing/cyclic KV3 base: ' + name)
    row = rows[name]
    if not isinstance(row, dict):
        raise ValueError('KV3 inheritance entry must be an object')
    result = resolve_bases(rows, row['_base'], (*stack, name)) if row.get('_base') else {}
    # Source data members here are scalar/array or whole nested config objects;
    # recursively merge nested config fields rather than losing inherited ones.
    def merge(target, source):
        for key, item in source.items():
            if isinstance(item, dict) and isinstance(target.get(key), dict):
                target[key] = merge(dict(target[key]), item)
            else:
                target[key] = item
        return target
    return merge(result, row)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--block', default='DATA')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(blocks(args.input.read_text(), args.block), indent=2) + '\n')
