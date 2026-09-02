// The PWA entry point is not covered by any other suite: nothing imports it, so a relative import
// left pointing at a deleted module survives every unit test and only fails at bundle time.
// Resolving its relative specifiers against disk catches that without building.

import fs from 'fs';
import path from 'path';

const ENTRY = path.join(__dirname, 'index.js');

// The candidate suffixes webpack tries for an extensionless specifier, in the same order.
const CANDIDATE_SUFFIXES = [
  '',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '/index.js',
  '/index.jsx',
  '/index.ts',
  '/index.tsx',
];

function resolvesOnDisk(specifier) {
  const base = path.resolve(path.dirname(ENTRY), specifier);

  return CANDIDATE_SUFFIXES.some(suffix => {
    try {
      return fs.statSync(base + suffix).isFile();
    } catch (error) {
      return false;
    }
  });
}

function relativeSpecifiersIn(source) {
  const pattern = /(?:^|[\s;}])(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|require\s*\(\s*)['"](\.[^'"]*)['"]/g;
  const found = new Set();
  let match;

  while ((match = pattern.exec(source)) !== null) {
    found.add(match[1]);
  }

  return Array.from(found);
}

describe('platform/viewer entry point', () => {
  const specifiers = relativeSpecifiersIn(fs.readFileSync(ENTRY, 'utf8'));

  it('imports at least one local module', () => {
    // Guards the test itself: a regex that stopped matching would otherwise pass vacuously.
    expect(specifiers.length).toBeGreaterThan(0);
  });

  it.each(specifiers)('resolves %s', specifier => {
    expect(resolvesOnDisk(specifier)).toBe(true);
  });
});
