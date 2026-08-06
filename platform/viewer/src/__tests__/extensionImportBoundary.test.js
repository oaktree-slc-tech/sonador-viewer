// Guards the extension -> viewer import boundary (ohif-viewers#127 follow-up).
//
// `platform/viewer/src/App.js` imports and registers every extension. So when an EXTENSION imports
// a viewer module that can transitively reach App.js, the module graph closes a cycle: App ->
// extensions -> viewer module -> App. Webpack resolves it by handing back a partially-initialized
// module, and the app dies at load with a TDZ error pointing at whichever extension happened to be
// evaluating -- in the case that prompted this test, "Cannot access 'components' before
// initialization" thrown from viewer3d-volume's panel, nowhere near the actual mistake.
//
// The specific edge that broke it: the cornerstone toolbar imported `useRemoveResource`, which
// imported its query-key constant from `useSeriesMetadata`, which imports `extensionManager` from
// '../App'. The constants moved to the leaf `hooks/queryKeys.js`; this test is what stops them
// drifting back.
//
// Static walk over relative and `@ohif/sonador-viewer/src/...` specifiers only -- external packages
// and other workspaces are not part of this cycle.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const VIEWER_SRC = path.resolve(__dirname, '..');
const APP_JS = path.join(VIEWER_SRC, 'App.js');

const IMPORT_RE = /^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm;

const CANDIDATE_SUFFIXES = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts'];

function resolveSpecifier(spec, fromFile) {
  let base;

  if (spec.startsWith('@ohif/sonador-viewer/src/')) {
    base = path.join(VIEWER_SRC, spec.slice('@ohif/sonador-viewer/src/'.length));
  } else if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/** Every path from `entry` to App.js, as arrays of files. */
function pathsToApp(entry) {
  const seen = new Set();
  const found = [];
  const stack = [[entry, [entry]]];

  while (stack.length) {
    const [file, trail] = stack.pop();
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }

    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const resolved = resolveSpecifier(match[1], file);
      if (!resolved) {
        continue;
      }
      if (path.resolve(resolved) === APP_JS) {
        found.push([...trail, resolved]);
      }
      stack.push([resolved, [...trail, resolved]]);
    }
  }

  return found;
}

/** Every extension source file that imports a viewer module. */
function extensionEntryPoints() {
  const extensionsDir = path.join(REPO_ROOT, 'extensions');
  const entries = [];

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') {
        continue;
      }
      const full = path.join(dir, name);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
        if (fs.readFileSync(full, 'utf8').includes('@ohif/sonador-viewer/src/')) {
          entries.push(full);
        }
      }
    }
  };

  if (fs.existsSync(extensionsDir)) {
    walk(extensionsDir);
  }

  return entries;
}


describe('extension -> viewer import boundary', () => {
  const entries = extensionEntryPoints();

  it('finds the extension files that import viewer modules', () => {
    // If this ever hits zero the walk is broken and the real assertion below is vacuous.
    expect(entries.length).toBeGreaterThan(0);
  });

  it('no extension can reach platform/viewer/src/App.js through a viewer import', () => {
    const offenders = [];

    entries.forEach((entry) => {
      pathsToApp(entry).forEach((trail) => {
        offenders.push(trail.map((f) => path.relative(REPO_ROOT, f)).join('\n     -> '));
      });
    });

    expect(offenders).toEqual([]);
  });

  it('queryKeys.js imports nothing at all, so it can never grow a path to App', () => {
    // The constants live here precisely so invalidating a query never drags in the hook that
    // defines it. A single import added to this file would undo that.
    const source = fs.readFileSync(path.join(VIEWER_SRC, 'hooks/queryKeys.js'), 'utf8');

    IMPORT_RE.lastIndex = 0;
    expect(IMPORT_RE.exec(source)).toBeNull();
  });
});
