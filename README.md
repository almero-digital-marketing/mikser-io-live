# mikser-io-live

Live-reload dev server for [Mikser](https://github.com/almero-digital-marketing/mikser-io). Wraps [alive-server](https://github.com/davidmoshal/alive-server) and serves the configured `outputFolder`, auto-refreshing browsers as Mikser regenerates files.

## Install

```bash
npm install mikser-io-live
```

## Usage

```js
// mikser.config.js
export default {
  plugins: ['live'],
  live: {
    port: 8080,
    open: true
  }
}
```

The `live` config object is passed straight through to `alive-server.start(...)`. Defaults applied by the plugin:

- `wait: 1000`
- `root: runtime.options.outputFolder`
- `open: false`

Pair with Mikser's watch mode to get a live-reloading dev loop.

## License

MIT
