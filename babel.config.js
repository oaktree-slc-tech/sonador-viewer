// https://babeljs.io/docs/en/options#babelrcroots
module.exports = {
  babelrcRoots: ['./platform/*', './extensions/*'],
  plugins: [
    'inline-react-svg',
    '@babel/transform-class-properties',
    '@babel/plugin-proposal-export-default-from',
    '@babel/plugin-transform-private-methods',
  ],
  env: {
    test: {
      presets: [
        [
          '@babel/preset-env',
          {
            modules: 'commonjs',
            debug: false,
            corejs: '3.33.2',
          },
        ],
        '@babel/preset-react',
        '@babel/preset-typescript',
      ],
      plugins: ['@babel/plugin-transform-runtime'],
    },
    production: {
      presets: [
        // WebPack handles ES6 --> Target Syntax
        ['@babel/preset-env', { modules: false }],
        '@babel/preset-react',
	      '@babel/preset-typescript',
      ],
      ignore: ['**/*.test.jsx', '**/*.test.js', '__snapshots__', '__tests__'],
    },
    development: {
      presets: [
        // WebPack handles ES6 --> Target Syntax
        ['@babel/preset-env', { modules: false }],
        '@babel/preset-react',
        '@babel/preset-typescript',
      ],
      ignore: ['**/*.test.jsx', '**/*.test.js', '__snapshots__', '__tests__'],
    },
  },
};

// TODO: Plugins; Aliases
// We don't currently use aliases, but this is a nice snippet that would help
// [
//   'module-resolver',
//   {
//     // https://github.com/tleunen/babel-plugin-module-resolver/issues/338
//     // There seem to be a bug with module-resolver with a mono-repo setup:
//     // It doesn't resolve paths correctly when using root/alias combo, so we
//     // use this function instead.
//     resolvePath(sourcePath, currentFile, opts) {
//       // This will return undefined if aliases has no key for the sourcePath,
//       // in which case module-resolver will fallback on its default behaviour.
//       return aliases[sourcePath];
//     },
//   },
// ],
