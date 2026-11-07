#!/usr/bin/env python3
"""Build an auditable standalone candidate from exactly one clean Git HEAD."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

DSH_PIN = '0.2.2-rc.1'
ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'vite.standalone.config.ts', 'vite.config.ts', 'dashboard/standalone.html',
    'dashboard/src/standalone-entry.ts', 'dashboard/src/standalone-pages.ts',
    'dashboard/standalone_app.py', 'dashboard/standalone_auth.py', 'dashboard/standalone_store.py',
    'dashboard/standalone_services.py', 'dashboard/standalone_fleet_transport.py', 'dashboard/runtime/package.json',
    'dashboard/runtime/pnpm-lock.yaml', 'dashboard/runtime/pnpm-workspace.yaml',
    'dashboard/runtime/bridge.mjs', 'dashboard/runtime/host.mjs', 'dashboard/runtime/dsh-peer.mjs',
    'scripts/start-standalone.py', 'scripts/start-standalone-requirements.txt',
    'docs/standalone-release/README.md', 'docs/standalone-release/config.local.json.example',
    'docs/standalone-release/config.proxy.json.example',
    'dashboard/vendor/plantuml/LICENSE-PlantUML.txt', 'dashboard/vendor/plantuml/upstream.json',
}
DOMAINS = ('core', 'files', 'attachments', 'attachment_staging', 'images', 'config', 'archive',
           'archive_formats', 'fleet', 'schedules')
REQUIRED.update(f'dashboard/standalone_domains/{name}.py' for name in DOMAINS)
LICENSE_NAME = re.compile(r'^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$', re.I)


class PackageError(Exception):
    pass


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root).decode().strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def regular_files(root):
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise PackageError('Symlinks are forbidden in generated candidate files')
        if path.is_file():
            yield path
        elif not path.is_dir():
            raise PackageError('Special files are forbidden in candidate')


def hashes(root, exclude=()):
    return {p.relative_to(root).as_posix(): sha(p) for p in regular_files(root)
            if p.relative_to(root).as_posix() not in exclude}


def frontend_provenance(root, commit, tree):
    """Called only after a fresh build, also usable by isolated test builders."""
    dist = root / 'dashboard/standalone-dist'
    write_json(dist / 'build-provenance.json', {
        'source_commit': commit, 'source_tree': tree,
        'files': hashes(dist, ('build-provenance.json',)),
    })


def build_frontend(root, commit, tree):
    # The build root is a fresh Git export. No working-tree dist or modules are reused.
    env = {'PATH': os.environ.get('PATH', os.defpath), 'HOME': str(root / '.build-home'),
           'LANG': 'C.UTF-8', 'CI': 'true'}
    subprocess.run(['pnpm', 'install', '--frozen-lockfile'], cwd=root, env=env, check=True, timeout=300)
    subprocess.run(['pnpm', 'build:standalone'], cwd=root, env=env, check=True, timeout=300)
    frontend_provenance(root, commit, tree)


def package_roots(root):
    """Known pnpm layout only, bounded depth; no recursive node_modules traversal."""
    store = root / 'node_modules/.pnpm'
    entries = sorted(store.iterdir()) if store.is_dir() else []
    if len(entries) > 4096:
        raise PackageError('Dependency inventory exceeds bounded license scan')
    for entry in entries:
        modules = entry / 'node_modules'
        if not modules.is_dir() or entry.is_symlink():
            continue
        for path in sorted(modules.iterdir()):
            candidates = sorted(path.iterdir()) if path.name.startswith('@') and not path.is_symlink() else [path]
            for candidate in candidates:
                if not candidate.is_symlink() and (candidate / 'package.json').is_file():
                    yield candidate


def collect_licenses(root, stage):
    packages = list(package_roots(root))
    inventory = {}
    for path in packages:
        info = json.loads((path / 'package.json').read_text())
        inventory.setdefault(info['name'], []).append((path, info))
    manifest = json.loads((root / 'package.json').read_text())
    # These are browser inputs, including the standalone React host and all their transitive inputs.
    pending = set(manifest.get('dependencies', {})) | {'react', 'react-dom'}
    needed = set()
    while pending:
        name = pending.pop()
        if name in needed:
            continue
        needed.add(name)
        if name not in inventory:
            raise PackageError('A bundled browser dependency has no installed package/license root')
        for _, info in inventory[name]:
            pending.update(set(info.get('dependencies', {})) - needed)
    notices = []
    for name in sorted(needed):
        for path, info in inventory[name]:
            recognized = sorted(p for p in path.iterdir() if LICENSE_NAME.fullmatch(p.name))
            texts = []
            for entry in recognized:
                if entry.is_symlink():
                    raise PackageError('License symlink is unsupported')
                if entry.is_file():
                    texts.append(entry)
                elif entry.is_dir():
                    # Root LICENSES directories may have one subdirectory level.
                    for child in sorted(entry.iterdir()):
                        if child.is_dir() and not child.is_symlink():
                            texts.extend(sorted(child.iterdir()))
                        else:
                            texts.append(child)
            if not texts or len(texts) > 128:
                raise PackageError('A bundled dependency license text is missing or exceeds scan bounds')
            for text in texts:
                if text.is_symlink() or not text.is_file() or text.stat().st_size > 2 * 1024 * 1024:
                    raise PackageError('Invalid bundled dependency license text')
                relative = text.relative_to(path)
                target = stage / 'third-party-licenses' / (name.replace('/', '__') + '@' + info['version']) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(text, target)
            notices.append({'package': name, 'version': info['version'], 'license': info.get('license', ''),
                            'texts': [p.relative_to(path).as_posix() for p in texts]})
    write_json(stage / 'third-party-licenses/inventory.json', notices)


def allowed_source(name):
    path = Path(name)
    return (
        name in {'LICENSE', 'THIRD_PARTY_NOTICES.md', 'dashboard/__init__.py',
                 'dashboard/standalone_app.py', 'dashboard/standalone_auth.py',
                 'dashboard/standalone_store.py', 'dashboard/standalone_services.py', 'dashboard/standalone_fleet_transport.py',
                 'scripts/start-standalone.py', 'scripts/start-standalone-requirements.txt',
                 'dashboard/runtime/package.json', 'dashboard/runtime/pnpm-lock.yaml',
                 'dashboard/runtime/pnpm-workspace.yaml'}
        or (path.parent.as_posix() == 'dashboard/standalone_domains' and path.suffix == '.py')
        or (path.parent.as_posix() == 'dashboard/runtime' and path.suffix == '.mjs')
        or (path.parts[:2] == ('docs', 'standalone-release') and path.suffix in {'.md', '.example', '.sh'})
    )


def create_candidate(source, output, *, builder=build_frontend, license_collector=collect_licenses):
    source, output = source.resolve(), output.resolve()
    if git(source, 'status', '--porcelain', '--untracked-files=all'):
        raise PackageError('Source must be clean, including untracked files; commit release tooling first')
    commit = git(source, 'rev-parse', 'HEAD')
    tree = git(source, 'rev-parse', 'HEAD^{tree}')
    names = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=source).decode().strip('\0').split('\0'))
    if REQUIRED - names:
        raise PackageError('Required tracked standalone modules, licenses, build inputs or lockfiles are missing')
    # Reject every tracked symlink, not only links selected for the final bundle.
    for name in names:
        if (source / name).is_symlink():
            raise PackageError('Tracked source symlinks are unsupported')
    timestamp = int(git(source, 'show', '-s', '--format=%ct', 'HEAD'))
    with tempfile.TemporaryDirectory(prefix='standalone-build-') as temporary:
        temporary = Path(temporary)
        build = temporary / 'source'
        build.mkdir()
        archive = subprocess.check_output(['git', 'archive', '--format=tar', 'HEAD'], cwd=source)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(build, filter='data')
        original = {name: sha(build / name) for name in names if (build / name).is_file()}
        if REQUIRED - original.keys():
            raise PackageError('Required source files were excluded from the committed export')
        dist = build / 'dashboard/standalone-dist'
        if dist.exists():
            shutil.rmtree(dist)
        builder(build, commit, tree)
        if any(not (build / name).is_file() or sha(build / name) != value for name, value in original.items()):
            raise PackageError('Build modified committed source inputs')
        try:
            provenance = json.loads((dist / 'build-provenance.json').read_text())
            if (provenance['source_commit'] != commit or provenance['source_tree'] != tree
                    or provenance['files'] != hashes(dist, ('build-provenance.json',))):
                raise PackageError('Stale frontend provenance or changed frontend output')
        except (OSError, ValueError, KeyError) as error:
            raise PackageError('Frontend build provenance is required') from error
        if not (dist / 'standalone.html').is_file() or not list((dist / 'assets').glob('*.js')):
            raise PackageError('Required frontend entry or compiled assets are missing')
        runtime = json.loads((build / 'dashboard/runtime/package.json').read_text())
        for package in ('dsh', 'dsh-client-connection', 'dsh-api-gateway'):
            if runtime['dependencies'].get('@deepseek-ai/' + package) != DSH_PIN:
                raise PackageError('DSH dependencies must use the frozen release pin')
        if DSH_PIN not in (build / 'dashboard/runtime/pnpm-lock.yaml').read_text():
            raise PackageError('Runtime lock does not contain the DSH release pin')
        stage = temporary / 'candidate'
        stage.mkdir()
        for name in sorted(names):
            if allowed_source(name):
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(build / name, target)
        shutil.copytree(dist, stage / 'dashboard/standalone-dist')
        # Keep the native app entry and provide a conventional archive index as well.
        shutil.copyfile(dist / 'standalone.html', stage / 'dashboard/standalone-dist/index.html')
        license_collector(build, stage)
        # Retain the lazy browser module license and the embedded Viz.js notice header unchanged.
        for name in ('LICENSE-PlantUML.txt', 'upstream.json'):
            target = stage / 'third-party-licenses/plantuml' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(build / 'dashboard/vendor/plantuml' / name, target)
        identity = f'workbench-standalone-{commit[:12]}'
        write_json(stage / 'standalone-manifest.json', {
            'schema': 1, 'candidate': identity, 'source_commit': commit, 'source_tree': tree,
            'dsh_version': DSH_PIN, 'requirements': {'node': '>=24.9.0', 'python': '>=3.13'},
            'runtime_dependencies': 'External frozen install; node_modules are never bundled',
            'files': hashes(stage),
        })
        # Check again after building: no concurrent edit can silently change the claimed source.
        if git(source, 'rev-parse', 'HEAD') != commit or git(source, 'status', '--porcelain', '--untracked-files=all'):
            raise PackageError('Source changed during candidate build')
        output.mkdir(parents=True, exist_ok=True)
        target = output / (identity + '.tar.gz')
        pending = output / (identity + '.partial')
        try:
            with pending.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=timestamp) as zipped:
                with tarfile.open(fileobj=zipped, mode='w') as tar:
                    for path in regular_files(stage):
                        info = tar.gettarinfo(str(path), arcname=identity + '/' + path.relative_to(stage).as_posix())
                        info.uid = info.gid = 0
                        info.uname = info.gname = ''
                        info.mtime = timestamp
                        info.mode = 0o644
                        with path.open('rb') as data:
                            tar.addfile(info, data)
            pending.replace(target)
        finally:
            pending.unlink(missing_ok=True)
        (output / 'SHA256SUMS').write_text(sha(target) + '  ' + target.name + '\n')
        return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT, help='Clean committed source checkout; commit is always HEAD')
    parser.add_argument('--output', type=Path, default=ROOT / 'release/standalone', help='Archive and SHA256SUMS destination')
    args = parser.parse_args()
    try:
        target = create_candidate(args.source, args.output)
    except (PackageError, OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, 'Standalone packaging failed: clean source, required inputs, frozen build, provenance and licenses are mandatory.\n')
    print(target.name)


if __name__ == '__main__':
    main()
