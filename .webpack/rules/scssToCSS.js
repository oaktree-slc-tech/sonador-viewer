const scssToCSS = [
  {
    test: /^((?!\.module).)*\.(sa|sc)ss$/,
    use: [
      // Create style nodes from JS strings
      'style-loader',
      // Translate CSS into CommonJS
      'css-loader',
      // Compile Sass to CSS
      'sass-loader',
    ],
  },
  {
    test: /\.module\.(sa|sc|c)ss$/,
    use: [
      // Create style nodes from JS strings
      'style-loader',
      // Translate CSS into CommonJS
      {
        loader: 'css-loader',
        options: {
          modules: {
            localIdentName: '[hash:base64]',
          },
        },
      },
      // Compile Sass to CSS
      'sass-loader',
    ],
  },
];

module.exports = scssToCSS;
