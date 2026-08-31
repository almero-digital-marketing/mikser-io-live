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

That's the whole setup. `--watch` rebuilds on change, `--server` serves the output, and this plugin connects the two to the browser. mikser prints every address it answers on, so testing against a phone is a matter of typing the LAN one it gives you.

| option | default | |
| --- | --- | --- |
| `path` | `/live` | where the event stream is mounted |

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

## Where it mounts

`/live`, and `path` moves it. That is the same shape every other mikser plugin
uses — `/api`, `/auth`, `/mcp`, `/preview`, `/drive`, `/forms`, `/vector` —
so if a page of yours needs that path, move this one the way you would move
any of those.

## How the page gets the script

A small snippet is injected before `</body>`, falling back to `</head>` for a document with no closing body tag. A page with neither is warned about once, because a page that silently never reloads looks exactly like a reload that is broken.

**`.html` and `.htm` only.** Nothing else is touched — in particular not SVG. An SVG served as `image/svg+xml` is parsed as XML, where the snippet's `&&` starts an entity reference and `<` starts a tag, so injecting there is not a no-op but a fatal parse error: the browser draws nothing. [alive-server](https://www.npmjs.com/package/alive-server) does inject into SVG and gets away with it by wrapping its script in `<![CDATA[ ]]>`; this one does not, and excluding the format outright is the version that cannot be got subtly wrong later.

Requests carrying an `Origin` header are left alone. Those are `fetch`/XHR — script asking for the same HTML as data — and injecting there corrupts what the caller parses.

## License

MIT
