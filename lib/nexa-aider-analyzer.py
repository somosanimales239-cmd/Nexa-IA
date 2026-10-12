#!/usr/bin/env python3
"""Nexa Developer: bounded read-only analysis using Aider's installed grep-ast parsers.
No Aider chat, no LLM calls, no project execution, no git init, no writes.
The JavaScript host is responsible for URL auth, Windows path authorization and timeouts.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sys

PROTOCOL = 'nexa-aider-symbols/v1'
ALLOWED = {'.php', '.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs'}
BLOCK_DIRS = {'.git', '.svn', '.hg', '.aider', '.venv', 'venv', 'node_modules', 'vendor',
              'dist', 'build', 'release', 'coverage', '.next', 'uploads', 'private',
              'sessions', 'secrets', 'logs', '__pycache__'}
MAX_SIZE = 450000


def tag_name(node, text):
    if node is None:
        return ''
    raw = text[node.start_byte:node.end_byte].decode('utf-8', errors='replace')
    return raw.strip().strip('`').lstrip('$')


def symbol_type(node):
    kinds = {
        'class_declaration': 'class', 'class_definition': 'class', 'class': 'class',
        'interface_declaration': 'interface', 'interface_definition': 'interface',
        'trait_declaration': 'trait', 'enum_declaration': 'enum',
        'function_declaration': 'function', 'function_definition': 'function',
        'method_declaration': 'method', 'method_definition': 'method',
        'function_signature': 'function',
    }
    if node.type in kinds:
        return kinds[node.type]
    if node.type == 'variable_declarator':
        for child in node.named_children:
            if child.type in ('arrow_function', 'function_expression'):
                return 'arrow-function'
    return None


def find_name(node, source, kind):
    name = node.child_by_field_name('name')
    if not name and node.type == 'variable_declarator':
        name = node.child_by_field_name('name')
    if not name:
        for child in node.named_children:
            if child.type in ('name', 'identifier', 'property_identifier', 'type_identifier'):
                name = child
                break
    found = tag_name(name, source)
    return found if re.fullmatch(r'[A-Za-z_$][\w$]*', found) else ''


def end_line(node):
    # Tree-sitter end_point is exclusive; do not add an extra line when at column 0.
    return max(node.start_point.row + 1, node.end_point.row + (1 if node.end_point.column else 0))


def analyze_file(root, rel, get_parser, filename_to_lang, max_symbols):
    target = root / rel
    if target.is_symlink() or not target.is_file() or target.stat().st_size > MAX_SIZE:
        return None, 'ignored_file'
    # Explicit check against traversal and junction escapes in addition to host checks.
    if not target.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
        return None, 'outside_root'
    raw = target.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    lang = filename_to_lang(str(target))
    if not lang:
        return {'path': rel, 'sha256': sha, 'symbols': []}, 'no_parser'
    try:
        parser = get_parser(lang)
        tree = parser.parse(raw)
    except Exception as exc:
        return {'path': rel, 'sha256': sha, 'symbols': []}, 'parser_error:' + type(exc).__name__
    symbols = []
    ref_candidates = []
    qualified_context = []
    stack = [(tree.root_node, ())]
    unique = set()
    while stack:
        node, parents = stack.pop()
        kind = symbol_type(node)
        name = find_name(node, raw, kind) if kind else ''
        new_parents = parents
        if kind and name:
            start = node.start_point.row + 1
            ending = end_line(node)
            key = (kind, name, start)
            if key not in unique and len(symbols) < max_symbols:
                unique.add(key)
                container = '.'.join(parents)
                qualified = (container + '.' + name) if container else name
                signature = re.sub(r'\s+', ' ', raw[node.start_byte:min(node.end_byte, node.start_byte + 300)].decode('utf-8', 'replace')).split('{', 1)[0].split('=>', 1)[0].strip()[:260]
                symbols.append({
                    'type': kind, 'name': name, 'qualifiedName': qualified, 'container': container,
                    'startLine': start, 'endLine': ending, 'signature': signature,
                })
            if kind in ('class', 'interface', 'trait', 'enum'):
                new_parents = parents + (name,)
        # All identifiers are lexical candidates; never claim static resolution here.
        if node.type in ('identifier', 'name', 'type_identifier', 'property_identifier') and len(ref_candidates) < 1500:
            ident = tag_name(node, raw)
            if re.fullmatch(r'[A-Za-z_$][\w$]*', ident):
                ref_candidates.append((ident, node.start_point.row + 1))
        for child in reversed(node.named_children):
            stack.append((child, new_parents))
    declared = {(entry['name'],entry['startLine']) for entry in symbols}
    references = []
    seen_refs = set()
    for ref_name, line in ref_candidates:
        key = (ref_name,line)
        if key not in declared and key not in seen_refs and len(references) < 100:
            references.append({'name': ref_name, 'line': line, 'resolved': False})
            seen_refs.add(key)
    # Web v1 accepts symbols; a later web index can use unresolved lexical references.
    return {'path': rel, 'sha256': sha, 'symbols': symbols,
            'referenceCandidates': references, 'referenceConfidence': 'lexical-unresolved'}, None


def scan(root, max_files=300, max_symbols=120, offset=0):
    from grep_ast import filename_to_lang
    from grep_ast.tsl import get_parser
    root = pathlib.Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Root must be a folder')
    paths = []
    ignored = 0
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d.lower() not in BLOCK_DIRS and not (pathlib.Path(base) / d).is_symlink())
        for name in sorted(names):
            file = pathlib.Path(base) / name
            if file.suffix.lower() not in ALLOWED or file.is_symlink():
                continue
            if len(paths) > 12000:
                raise RuntimeError('Scan file ceiling reached')
            if file.stat().st_size <= MAX_SIZE:
                paths.append(file.relative_to(root).as_posix())
            else:
                ignored += 1
    paths.sort()
    result = []
    issues = []
    batch = paths[offset:offset + max_files]
    for rel in batch:
        item, error = analyze_file(root, rel, get_parser, filename_to_lang, max_symbols)
        if item is not None:
            result.append(item)
        if error:
            issues.append({'path': rel, 'kind': error})
    return {
        'ok': True, 'protocol': PROTOCOL, 'analysisOnly': True, 'root': str(root),
        'files': result, 'filesDiscovered': len(paths), 'filesAnalyzed': len(result),
        'offset': offset, 'nextOffset': offset + len(batch) if offset + len(batch) < len(paths) else None,
        'partial': (offset + max_files) < len(paths) or bool(issues),
        'limitations': ['References are lexical candidates, not resolved call graph edges.',
                        'Web v1 accepts one batch of at most 300 files. Additional pages require Web v2.'],
        'issues': issues[:25], 'ignoredLargeFiles': ignored,
    }


def probe():
    from importlib.metadata import version
    from grep_ast import filename_to_lang
    from grep_ast.tsl import get_parser
    try:
        detected = version('aider-chat')
    except Exception:
        detected = 'unknown'
    # Validate the actual language parsers before reporting available=True.
    for filename, sample in [('demo.js', b'function example() { return 1; }'),
                             ('demo.php', b'<?php function example(){ return 1; }')]:
        lang = filename_to_lang(filename)
        if not lang or get_parser(lang).parse(sample).root_node.has_error:
            raise RuntimeError('Parser for ' + filename + ' unavailable')
    print(json.dumps({'ok': True, 'version': detected, 'analysisOnly': True, 'rootBound': True}))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--probe', action='store_true')
    p.add_argument('--root')
    p.add_argument('--offset', type=int, default=0)
    p.add_argument('--max-files', type=int, default=300)
    p.add_argument('--max-symbols', type=int, default=120)
    args = p.parse_args()
    if args.probe:
        return probe()
    if not args.root:
        raise ValueError('Root required')
    if not 1 <= args.max_files <= 300 or not 1 <= args.max_symbols <= 120 or not 0 <= args.offset <= 12000:
        raise ValueError('Invalid scan budget')
    report = scan(args.root, args.max_files, args.max_symbols, args.offset)
    sys.stdout.write(json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': type(exc).__name__ + ': ' + str(exc)[:240]}), file=sys.stderr)
        sys.exit(2)
