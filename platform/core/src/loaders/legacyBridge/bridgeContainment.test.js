// Two containment rules that only a source sweep can enforce.
//
// The first is what the phase is for: Cornerstone3D is the only decoder, so nothing may import the
// legacy DICOM loader. The second is what keeps the bridge deletable: it is meant to be removed by
// deleting this directory and its single call site, which is only true while nothing else reaches
// into it.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOTS = ['platform', 'extensions'].map(d => path.join(REPO_ROOT, d));
// Build output only. `lib` is deliberately NOT in this list: it names compiled output at a package
// root but also real source at `platform/viewer/src/lib`, and skipping the name outright hid three
// files that were still importing the legacy loader.
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx)$/;

function sourceFiles(dir, found = []) {
  if (!fs.existsSync(dir)) {
    return found;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A `lib` directory that is not under a `src` tree is compiled output.
      if (entry.name === 'lib' && !full.includes(`${path.sep}src${path.sep}`)) {
        continue;
      }
      sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function importsOf(source) {
  // `import ... from 'x'`, `export ... from 'x'`, `require('x')`, and dynamic `import('x')`.
  const pattern = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  const found = [];
  let match;

  while ((match = pattern.exec(source)) !== null) {
    found.push(match[1]);
  }

  return found;
}

const ALL_SOURCES = SOURCE_ROOTS.flatMap(root => sourceFiles(root)).map(file => ({
  file: path.relative(REPO_ROOT, file),
  imports: importsOf(fs.readFileSync(file, 'utf8')),
}));

describe('bridge containment', () => {
  it('sees a plausible number of source files', () => {
    // Guards the sweep itself: a broken walk would otherwise make both rules pass vacuously.
    expect(ALL_SOURCES.length).toBeGreaterThan(1000);
  });

  it('nothing imports cornerstone-wado-image-loader', () => {
    // Cornerstone3D is the only decoder. An import here would start the legacy decode path again
    // -- and its web workers are no longer initialised, so it would fail at runtime rather than
    // at build time.
    const offenders = ALL_SOURCES.filter(({ imports }) =>
      imports.some(specifier => specifier === 'cornerstone-wado-image-loader' ||
        specifier.startsWith('cornerstone-wado-image-loader/'))
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('only the @ohif/core barrel imports the bridge', () => {
    // The bridge is removed by deleting its directory and its one call site. Any other importer
    // would turn that into a wider change and give the bridge a second entry point.
    const BRIDGE_DIR = 'platform/core/src/loaders/legacyBridge';
    const ALLOWED = ['platform/core/src/index.js'];

    const offenders = ALL_SOURCES.filter(({ file, imports }) => {
      if (file.startsWith(BRIDGE_DIR) || ALLOWED.includes(file)) {
        return false;
      }
      return imports.some(specifier => specifier.includes('legacyBridge'));
    }).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
