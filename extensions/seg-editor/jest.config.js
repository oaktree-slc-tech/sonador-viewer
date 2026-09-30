const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  // Parts of the tool palette are TypeScript (ported OHIF v3 button definitions); babel's test
  // env carries @babel/preset-typescript, so jest only needs to resolve and transform them.
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  // ES-module-only code some tests run for real: vtk.js (index -> world check), Cornerstone3D's
  // HistoryMemo (undo / redo), loaded from its own file, and three's examples (the STL and NRRD
  // loaders the importers read files with)
  transformIgnorePatterns: [
    '/node_modules/(?!@kitware/vtk\\.js/|three/examples/|@cornerstonejs/core/dist/esm/utilities/(historyMemo|asArray))',
  ],
};
