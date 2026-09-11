import {spawnSync} from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspace = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const packages = new Map();
for (const directory of workspace.workspaces) {
  const location = path.join(root, directory);
  const manifest = JSON.parse(
    await readFile(path.join(location, 'package.json'), 'utf8'),
  );
  if (!manifest.private) packages.set(manifest.name, {location, manifest});
}

const requested = process.argv.slice(2);
const selected = new Set();
function select(name) {
  if (selected.has(name)) return;
  const pkg = packages.get(name);
  if (!pkg) throw new Error(`Unknown public workspace package: ${name}`);
  for (const dependency of Object.keys({
    ...pkg.manifest.dependencies,
    ...pkg.manifest.peerDependencies,
  }))
    if (packages.has(dependency)) select(dependency);
  selected.add(name);
}
(requested.length ? requested : [...packages.keys()]).forEach(select);

function targets(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(targets);
}
const scripts = [...selected]
  .map(name => packages.get(name))
  .filter(pkg =>
    targets(pkg.manifest.exports ?? pkg.manifest.bin).some(
      target => target.startsWith('./bld/') || target.startsWith('bld/'),
    ),
  );
for (const pkg of scripts)
  await rm(path.join(pkg.location, 'bld'), {recursive: true, force: true});
if (scripts.length) {
  // The project graph owns declaration ordering; esbuild owns the executable output.
  const checked = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '--build', '--force'],
    {cwd: root, stdio: 'inherit'},
  );
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}

const builtinExternals = [
  ...new Set(
    builtinModules.flatMap(name => [
      name,
      'node:' + name.replace(/^node:/, ''),
    ]),
  ),
];
for (const pkg of scripts) {
  const {location, manifest} = pkg;
  const entryPoints = {};
  for (const target of new Set(targets(manifest.exports ?? manifest.bin))) {
    if (!target.endsWith('.js')) continue;
    const relative = target.replace(/^\.\//, '').replace(/^bld\//, '');
    entryPoints[relative.slice(0, -3)] = path.join(
      location,
      'src',
      relative.replace(/\.js$/, '.ts'),
    );
  }
  const result = await build({
    absWorkingDir: root,
    entryPoints,
    outdir: path.join(location, 'bld'),
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: manifest.bin ? 'node' : 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    external: [
      ...builtinExternals,
      ...Object.keys({...manifest.dependencies, ...manifest.peerDependencies}),
    ],
    keepNames: true,
    sourcemap: true,
    sourcesContent: true,
    legalComments: 'linked',
    metafile: true,
    tsconfig: path.join(root, 'tsconfig.base.json'),
  });
  await writeNotices(location, result.metafile);
  await mkdir(path.join(location, '.cache'), {recursive: true});
  await writeFile(
    path.join(location, '.cache/bundle-metafile.json'),
    JSON.stringify(result.metafile, null, 2) + '\n',
  );
  await copyFile(path.join(root, 'LICENSE'), path.join(location, 'LICENSE'));
  console.log(
    `${manifest.name}: ${Object.keys(entryPoints).length} entries, ${Object.keys(result.metafile.inputs).length} inputs → ${Object.keys(result.metafile.outputs).filter(name => name.endsWith('.js')).length} JavaScript files`,
  );
}

// Native packages keep their native build. Every normal build/pack checks that
// their public loaders, declarations, WASM and license files actually exist.
for (const name of selected) {
  const pkg = packages.get(name);
  for (const target of new Set(
    targets(pkg.manifest.exports ?? pkg.manifest.bin),
  ))
    if (!(await stat(path.join(pkg.location, target))).isFile())
      throw new Error(`${name}: missing published entry ${target}`);
  if (!scripts.includes(pkg))
    for (const file of pkg.manifest.files)
      await stat(path.join(pkg.location, file));
}

async function writeNotices(location, metafile) {
  const bundled = new Map();
  const copyrights = [];
  const usedInputs = new Set(
    Object.values(metafile.outputs).flatMap(output =>
      Object.entries(output.inputs ?? {})
        .filter(([, info]) => info.bytesInOutput > 0)
        .map(([input]) => input),
    ),
  );
  for (const input of usedInputs) {
    if (!input.includes('node_modules/')) continue;
    // Ordinary copyright comments are not esbuild's @license//*! comments.
    const source = await readFile(path.resolve(root, input), 'utf8');
    const comments = source.match(/^\s*\/\/\s*Copyright[^\r\n]*/gim);
    if (comments)
      copyrights.push(
        input +
          '\n' +
          comments.map(line => line.trim().replace(/^\/\/\s*/, '')).join('\n'),
      );
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== root) {
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(path.join(directory, 'package.json'), 'utf8'),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (manifest) {
        bundled.set(directory, manifest);
        break;
      }
      directory = path.dirname(directory);
    }
  }
  if (!bundled.size) return;
  const notices = [];
  for (const [directory, manifest] of [...bundled].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    notices.push(
      `${manifest.name} ${manifest.version} (${manifest.license ?? 'see notices'})`,
    );
    const files = await readdir(directory);
    const licenses = files.filter(name =>
      /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(name),
    );
    if (licenses.length) {
      for (const name of licenses)
        notices.push(await readFile(path.join(directory, name), 'utf8'));
    } else {
      // Several Flo packages distribute the full license in their README only.
      const readmeName = files.find(name => /^readme(?:\.|$)/i.test(name));
      const readme = readmeName
        ? await readFile(path.join(directory, readmeName), 'utf8')
        : '';
      const license = readme.match(/^#+ License\s*\n[\s\S]*/im)?.[0];
      if (license) notices.push(license);
      else {
        // Some Flo releases supply only the MIT identifier and author in their
        // published manifest. Include both with the standard permission text.
        const author =
          typeof manifest.author === 'string'
            ? manifest.author
            : manifest.author?.name;
        if (manifest.license !== 'MIT' || !author)
          throw new Error(
            `Bundled dependency has no license text: ${manifest.name}`,
          );
        notices.push(
          `Copyright (c) ${author}\n${manifest.repository?.url ?? ''}\n\n` +
            (await readFile(path.join(root, 'scripts/MIT.txt'), 'utf8')),
        );
      }
    }
  }
  await writeFile(
    path.join(location, 'bld/THIRD_PARTY_NOTICES.txt'),
    [...notices, ...copyrights].join('\n\n') + '\n',
  );
}
