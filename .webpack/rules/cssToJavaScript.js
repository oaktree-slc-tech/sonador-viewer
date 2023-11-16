const cssToJavaScript = {
  test: /\.css$/,
  use: [
    'style-loader',
    { loader: 'css-loader', options: { importLoaders: 1 } },
    {
      loader: 'postcss-loader',
    },
  ],
};

module.exports = cssToJavaScript;
