#!/usr/bin/env node
// Keeps the values every platform manifest shares (version, author, homepage, repository,
// license, keywords, category) in one place: scripts/plugin-metadata.json.
//
//   node scripts/sync-manifests.mjs          write the shared values into every manifest
//   node scripts/sync-manifests.mjs --check  fail if any manifest has drifted (CI runs this)
//
// To release, change "version" in plugin-metadata.json and run the script without --check.
// Platform-only fields (descriptions, the Codex interface block, Antigravity prompts) stay in
// each manifest and are not touched.
import { readFileSync, writeFileSync } from 'node:fs';

const check = process.argv.includes('--check');
const meta = JSON.parse(readFileSync('scripts/plugin-metadata.json', 'utf8'));
const shared = ['version', 'author', 'homepage', 'repository', 'license', 'keywords'];

// Each target names a manifest and where each shared key lives in it.
const targets = [
  { file: '.claude-plugin/plugin.json', set: (m) => assign(m, shared) },
  {
    file: '.codex-plugin/plugin.json',
    set: (m) => {
      assign(m, shared);
      m.interface.category = meta.category;
    },
  },
  {
    file: '.antigravity-plugin/plugin.json',
    set: (m) => assign(m, [...shared, 'category']),
  },
  {
    // The entry must not carry a version: plugin.json wins at install, and validate warns.
    file: '.claude-plugin/marketplace.json',
    set: (m) => {
      const entry = pluginEntry(m);
      delete entry.version;
      entry.category = meta.category;
    },
  },
  {
    file: '.agents/plugins/marketplace.json',
    set: (m) => {
      pluginEntry(m).category = meta.category;
    },
  },
];

// Where a key goes when a manifest doesn't have it yet, so new keys sit beside related ones.
const anchors = { repository: 'homepage', license: 'repository', category: 'suggestedPrompts' };

function assign(manifest, keys) {
  for (const key of keys) setKey(manifest, key, structuredClone(meta[key]));
}

function setKey(obj, key, value) {
  const anchor = anchors[key];
  if (key in obj || !anchor || !(anchor in obj)) {
    obj[key] = value;
    return;
  }
  const entries = Object.entries(obj);
  const at = entries.findIndex(([k]) => k === anchor) + 1;
  entries.splice(at, 0, [key, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, Object.fromEntries(entries));
}

function pluginEntry(marketplace) {
  const entry = marketplace.plugins?.find((p) => p.name === 'unity');
  if (!entry) throw new Error('no "unity" entry in plugins[]');
  return entry;
}

const drifted = [];
for (const { file, set } of targets) {
  const before = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const manifest = JSON.parse(before);
  set(manifest);
  const after = `${JSON.stringify(manifest, null, 2)}\n`;
  if (after === before) continue;
  if (check) drifted.push(file);
  else writeFileSync(file, after);
}

// The sample `agy plugin list` and `codex plugin list` output in the README shows the version.
const readme = '.github/README.md';
const readmeText = readFileSync(readme, 'utf8');
const stale = [...readmeText.matchAll(/\b0\.\d+\.\d+(?:-[a-z0-9.]+)?\b/g)]
  .map((m) => m[0])
  .filter((v) => v !== meta.version);
if (stale.length > 0) {
  if (check) drifted.push(`${readme} (shows ${[...new Set(stale)].join(', ')})`);
  else writeFileSync(readme, readmeText.replaceAll(new RegExp(stale.map(escape).join('|'), 'g'), meta.version));
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (drifted.length > 0) {
  console.error('These files differ from scripts/plugin-metadata.json:');
  for (const file of drifted) console.error(`  ${file}`);
  console.error('Run `node scripts/sync-manifests.mjs` and commit the result.');
  process.exit(1);
}
console.log(check ? 'Manifests match scripts/plugin-metadata.json' : 'Manifests updated');
