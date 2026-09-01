const path = require("path");
const webpack = require("webpack");

const config = {
  entry: "./src/extension.ts",
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode",
    child_process: "commonjs child_process",
    util: "commonjs util",
    "@resvg/resvg-js": "commonjs @resvg/resvg-js"
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
    alias: {
      "codetour-description-renderer": path.resolve(
        __dirname,
        "packages/description-renderer/dist/src/index.js"
      )
    }
  },
  node: {
    __filename: false,
    __dirname: false
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader"
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      test: /\.ts$/,
      noSources: false,
      module: true,
      columns: true
    })
  ]
};

const nodeConfig = {
  ...config,
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension-node.js',
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  plugins: [
    ...config.plugins,
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
  ]
};

const mcpConfig = {
  mode: "production",
  target: "node18",
  entry: "./packages/mcp-server/dist/src/cli.js",
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "mcp-server.js"
  }
};

module.exports = [nodeConfig, mcpConfig];
