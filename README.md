# mikser-io-live

Live reload for [mikser](https://github.com/almero-digital-marketing/mikser-io), mounted on mikser's own HTTP server.

Save a file, the browser updates. Edit a stylesheet and it swaps in place — no reload, so scroll position, open menus and form state survive.

## Install

```bash
npm install mikser-io-live
```

## Usage

```js
// mikser.config.js
import { live } from 'mikser-io-live'

export default {
  plugins: [ /* … */, live() ],
}
```

```bash
mikser --server --watch
```

That's the whole setup. `--watch` rebuilds on change, `--server` serves the output, and this plugin connects the two to the browser.

| option | default | |
| --- | --- | --- |
| `path` | `/__mikser_live` | where the event stream is mounted |

## What it does

Watches the output folder and tells connected browsers what changed. That folder **is** the bytes the browser gets — a page arrives there by being rendered, a stylesheet by being copied, an image by being symlinked — so watching it catches all three. Deriving the list from what the engine rendered was tried and misses everything that was not rendered, which includes the most common reason to want live reload.

What the engine is asked for is the timing and the verdict: changes are flushed at the end of a build, so one build produces one reload rather than forty, and a build that **failed** produces none. A failed render leaves the previous good output on disk, so reloading would show the same page and hide the failure — you get a console warning instead.

Three behaviours worth knowing:

- **Stylesheets swap, pages reload.** If everything that changed was CSS, the `<link>` href is refreshed and nothing else happens.
- **Only the page you are looking at reloads.** A build that rerendered forty other pages does not interrupt this one.
- **A mikser restart reloads.** The client notices the server it was talking to has been replaced and reloads rather than trusting a page the previous process rendered.

## Requires `--server`

There is no second server and no second port. Without a shared Express app there is nothing to mount on, and the plugin says so rather than starting one of its own.

This is a change from 5.x, which wrapped [alive-server](https://www.npmjs.com/package/alive-server) and ran its own server on its own port. If you were using it as the lighter alternative to `mikser --server`, you now want `mikser --server --watch` instead — one port, one process, and it composes with every other plugin that mounts on the same app.

## How the page gets the script

A small snippet is injected before `</body>`, falling back to `</svg>` then `</head>` — the same order [alive-server](https://www.npmjs.com/package/alive-server) uses, and right for the same reasons: a standalone SVG served as a page has no body, and some documents have no closing body tag at all. A page with none of the three is warned about once, because a page that silently never reloads looks exactly like a reload that is broken.

Requests carrying an `Origin` header are left alone. Those are `fetch`/XHR — script asking for the same HTML as data — and injecting there corrupts what the caller parses.

## License

MIT
