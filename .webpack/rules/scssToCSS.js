const scssToCSS = {
  test: /\.s[ac]ss$/,
  use: [
    // Create style nodes from JS strings
    'style-loader',
    // Translate CSS into CommonJS
    'css-loader',
    // Compile Sass to CSS
    'sass-loader',
  ],
};

module.exports = scssToCSS;
