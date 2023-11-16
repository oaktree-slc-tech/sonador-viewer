const ExtractCssChunksPlugin = require('extract-css-chunks-webpack-plugin');

function extractStyleChunks(isProdBuild) {
  const CSSModuleLoader = {
    loader: 'css-loader',
    options: {
      modules: {
        localIdentName: isProdBuild ? '[hash:base64]' : '[name][local]_[hash:base64:5]',
      },
    },
  };

  const PostCSSLoader = {
    loader: 'postcss-loader',
    options: {
      ident: 'postcss',
      sourceMap: false, // turned off as causes delay
    },
  };

  return [
    {
      test: /\.styl$/,
      use: [
        {
          loader: ExtractCssChunksPlugin.loader,
          options: {
            hot: !isProdBuild,
          },
        },
        'css-loader',
        'stylus-loader',
      ],
    },
    {
      test: /^((?!\.module).)*\.(sa|sc|c)ss$/, // Excludes files with .module in filename
      use: [
        {
          loader: ExtractCssChunksPlugin.loader,
          options: {
            hot: !isProdBuild,
          },
        },
        'css-loader',
        PostCSSLoader,
        'sass-loader',
      ],
    },
    {
      test: /\.module\.(sa|sc|c)ss$/,
      use: [
        {
          loader: ExtractCssChunksPlugin.loader,
          options: {
            hot: !isProdBuild,
          },
        },
        CSSModuleLoader,
        PostCSSLoader,
        'sass-loader',
      ],
    },
  ];
}

module.exports = extractStyleChunks;
