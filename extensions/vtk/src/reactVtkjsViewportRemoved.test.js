// `@sonador/react-vtkjs-viewport` is no longer part of the volume path.
//
// The package is deprecated and its `getImageData` / `loadImageData` were the last place a viewer
// component built a Float32 volume of its own and drove the legacy image-load pool. This guards the
// removal: a re-introduced import would silently restore the second copy of every series.

const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = path.resolve(__dirname, '../../..');
const PLATFORM_DIR = path.resolve(EXTENSIONS_DIR, '../platform');

const PACKAGE = '@sonador/react-vtkjs-viewport';
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

function collectSourceFiles(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return found;
  }

  entries.forEach(entry => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        return;
      }
      collectSourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  });

  return found;
}

function packageDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
      .map(entry => path.join(root, entry.name));
  } catch (error) {
    return [];
  }
}

describe(`${PACKAGE} is gone from the viewer source`, () => {
  const packages = [...packageDirs(EXTENSIONS_DIR), ...packageDirs(PLATFORM_DIR)];

  it('finds the packages it is supposed to be scanning', () => {
    // A path mistake would make every assertion below vacuously pass.
    expect(packages.length).toBeGreaterThan(3);
  });

  it('is imported by no source file', () => {
    const offenders = packages
      .flatMap(pkg => collectSourceFiles(path.join(pkg, 'src')))
      .filter(file => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes(`from '${PACKAGE}'`)
          || source.includes(`from "${PACKAGE}"`)
          || source.includes(`require('${PACKAGE}')`)
          || source.includes(`require("${PACKAGE}")`);
      });

    expect(offenders).toEqual([]);
  });

  it('is listed as a dependency by no package', () => {
    const offenders = packages.filter(pkg => {
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
      } catch (error) {
        return false;
      }

      return [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
      ].some(deps => deps && Object.prototype.hasOwnProperty.call(deps, PACKAGE));
    });

    expect(offenders).toEqual([]);
  });
});
