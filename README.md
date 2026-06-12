# mikser-io-live

Live-reload dev server for [Mikser](https://github.com/almero-digital-marketing/mikser-io). Wraps [alive-server](https://www.npmjs.com/package/alive-server) and serves the configured `outputFolder`, auto-refreshing browsers as Mikser regenerates files.

The lighter alternative to `mikser --server` when all you want is "save a file → browser refreshes." Pair with `mikser --watch` for the classic SSG dev loop. If you also need API endpoints, an admin UI, or other plugins that need a shared Express app, use `mikser --server` instead.

## Install

```bash
npm install mikser-io-live
```

## Usage

```js
// mikser.config.js
import { live } from 'mikser-io-live'

export default {
  plugins: [
    live({
      port: 8080,
      open: true
    })
  ]
}
```

The options object is passed straight through to `alive-server.start(...)`. Defaults applied by the plugin:

- `wait: 1000`
- `root: runtime.options.outputFolder`
- `open: false`

Pair with Mikser's watch mode to get a live-reloading dev loop.

## License

MIT
