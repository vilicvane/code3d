"""Compile the same binding closure as the pinned custom-build linker."""

import multiprocessing
import os
import sys
from functools import partial
from pathlib import Path
import yaml

sys.path.insert(0, '/opencascade.js/src')
import compileBindings as compiler
from ocjs_bindgen.link import yaml_build as linker

if __name__ == '__main__':
    root = Path('/opencascade.js/build')
    config = yaml.safe_load(Path('/src/custom_build_single.yml').read_text())
    config.setdefault('extraBuilds', [])
    scope = linker._compute_yaml_class_scope(config, str(root))
    # The toolchain image includes bindings beyond this consumer's YAML scope.
    # Match the linker, including auto-discovered template instantiations and
    # typedef aliases, instead of compiling unrelated unsupported OCCT types.
    linker._auto_symbols = linker._filter_auto_symbols_by_scope(
        str(root / 'ncollection-manifest.json'), scope
    )
    aliases = linker._load_ncollection_alias_index(str(root))
    bindings = config['mainBuild']['bindings']
    linker._auto_symbols.update(
        aliases[binding['symbol']]
        for binding in bindings
        if binding['symbol'] in aliases
    )
    files = sorted(
        str(path) for path in (root / 'bindings').rglob('*.cpp')
        if linker.shouldProcessSymbol(path.stem, bindings)
    )
    if not files:
        raise RuntimeError('No bindings selected')
    print(f'Compiling {len(files)} selected binding files', flush=True)
    compiler.validate_build_flags()
    arguments = {
        'threading': os.environ['THREADING'],
        'identity_context': compiler._shared_identity_context(),
    }
    with multiprocessing.Pool(processes=int(os.environ['OCJS_COMPILE_WORKERS'])) as pool:
        results = pool.map(partial(compiler.buildOneFile, arguments), files)
    failures = [result for result in results if result['status'] == 'failed']
    print({
        status: sum(result['status'] == status for result in results)
        for status in ['succeeded', 'cached', 'failed']
    }, flush=True)
    if failures:
        print(failures, flush=True)
        raise SystemExit(1)
