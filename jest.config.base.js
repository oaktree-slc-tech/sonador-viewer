module.exports = {
  verbose: true,
  roots: ['<rootDir>'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  testMatch: ['<rootDir>/src/**/*.test.js'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  moduleFileExtensions: ['js', 'jsx'],
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/__mocks__/fileMock.js',
    // Stylesheets resolve to the same stub as other static assets. scss/sass/styl are included
    // alongside css/less because CSS-module imports are ubiquitous in the viewer's components and
    // without this any test that imports one dies on the stylesheet rather than running.
    //
    // NOT identity-obj-proxy, which the css/less mapping named for years: it has never been a
    // dependency of this repo, so that mapping only ever "worked" because no test imported a
    // stylesheet. Tests here assert behaviour, not class names, so the stub is enough -- and it
    // needs no new dependency.
    '\\.(css|less|scss|sass|styl)$': '<rootDir>/src/__mocks__/fileMock.js',
  },
  // Coverage
  reporters: [
    'default',
    // Docs: https://www.npmjs.com/package/jest-junit
    [
      'jest-junit',
      {
        addFileAttribute: true, // CircleCI Only
      },
    ],
  ],
  collectCoverage: false,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{js,jsx}',
    // Not
    '!<rootDir>/src/**/*.test.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!<rootDir>/dist/**',
  ],
};
