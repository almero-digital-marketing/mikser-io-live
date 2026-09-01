// Live reload on mikser's own server.
//
// This used to start a second HTTP server on a second port (alive-server),
// which watched the output folder and guessed, from a one-second debounce,
// that a build had probably finished. That works, and it costs a port, a
// separate process lifecycle, and a dependency — and it cannot answer the one
// question that matters, which is what actually changed.
//
// Mounted on the shared Express app instead. It still watches the output
// folder, because that folder IS the bytes the browser gets: a page arrives
// there by being rendered, a stylesheet by being copied, an image by being
// symlinked, and only one of those three produces anything in the build
// report. Deriving the served paths from what the engine rendered was tried
// and is wrong twice over — it misses every file that was not rendered, and
// it turns one observation into three inferences.
//
// What the engine IS asked for is the timing and the verdict: flush at the end
// of a cycle so a build produces one reload rather than forty, and do not
// reload at all when the build failed.
//
// Requires `mikser --server`. Without a shared app there is nothing to mount
// on, and the plugin says so rather than starting a server of its own — one
// port and one lifecycle is the point.

import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { clientScript } from './lib/client.js'
export { samePage } from './lib/paths.js'

// Where the snippet goes, in preference order. `</head>` is the fallback for
// a document with no closing body tag.
const INJECT_BEFORE = [/<\/body>/i, /<\/head>/i]

// HTML only, and this is a correctness limit rather than a scope decision.
//
// `.svg` and `.xhtml` were here, taken from alive-server, which does inject
// into SVG — and gets away with it because its snippet is wrapped in
// `// <![CDATA[ ... // ]]>`. Mine is not, and an SVG served as image/svg+xml
// is parsed as XML: `&&` starts an entity reference and `<` starts a tag, so
// the script is not merely ignored, it is a FATAL parse error and the browser
// renders nothing at all.
//
// Wrapping in CDATA would make SVG work again. Not doing it: a standalone SVG
// page that live-reloads is a rare thing to want, breaking one outright is
// not, and a rule that reads "html and htm" cannot be got subtly wrong the way
// a rule that reads "html, and also XML dialects if the payload is escaped
// correctly" can.
const INJECTABLE = new Set(['.html', '.htm'])

// Where the snippet goes in a given document, or null if there is nowhere.
//
// Exported because it is the only part of the injection with a decision in it,
// and a closure inside an express handler is not a thing a test can reach.
export function injectionPoint(html) {
    for (const candidate of INJECT_BEFORE) {
        const match = candidate.exec(html)
        if (match) return match[0]
    }
    return null
}

// Before the closing tag, never after: a script appended past </body> is
// outside the document and browsers put it back inside anyway, which makes the
// bytes on the wire disagree with the DOM.
export function injectInto(html, script) {
    const tag = injectionPoint(html)
    if (!tag) return html
    return html.replace(tag, script + tag)
}

export function live(options = {}) {
    // `/live`, overridable — the same shape every other plugin mounts with:
    // api at /api, auth at /auth, mcp at /mcp, preview at /preview. Eight of
    // them, one pattern, and no reason for a ninth.
    const streamPath = options.path ?? '/live'
    // Changes every start. A client that reconnects and sees a different one
    // knows mikser restarted — new code, possibly a different site — and
    // reloads rather than trusting a page the previous process rendered.
    const boot = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return (core) => {
        const {
            runtime, onLoaded, onFinalized, useLogger,
            registerRoute, requestReport, buildReport, watchFolder,
        } = core

        // Per-cycle recording is opt-in, and this plugin is a reader — see
        // report.js requestReport. Asked for at registration, before any cycle
        // has run, or the first build reports nothing to reload from.
        requestReport()

        const clients = new Set()

        function broadcast(event, data) {
            const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            for (const res of clients) {
                try { res.write(frame) } catch { clients.delete(res) }
            }
        }

        // Resolve a request path the way express.static will, so the middleware
        // injects into exactly the file that is about to be served.
        function resolveFile(pathname) {
            const root = runtime.options.outputFolder
            if (!root) return null
            const decoded = decodeURIComponent(pathname)
            let file = path.join(root, decoded)
            // Containment: a decoded `..` must not reach outside the folder
            // being served. express.static guards its own reads; this one is
            // ours and needs its own.
            if (path.relative(root, file).startsWith('..')) return null
            if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
            if (!existsSync(file)) return null
            return INJECTABLE.has(path.extname(file).toLowerCase()) ? file : null
        }

        onLoaded(async () => {
            const logger = useLogger()
            const app = runtime.options.app
            if (!app) {
                logger.warn({ code: 'live-no-server' },
                    'live() needs the shared HTTP server and there is none — run `mikser --server`. Nothing is '
                    + 'mounted, so pages will not reload; the build itself is unaffected.')
                return
            }

            // The event stream. `streaming` so a reverse-proxy generator knows
            // never to buffer it — a buffered SSE stream delivers every event
            // at once when the connection closes, which is indistinguishable
            // from live reload not working.
            registerRoute({
                path: streamPath,
                plugin: 'live',
                reachability: 'public',
                streaming: true,
                label: 'Live reload',
                detail: 'reload events for pages served from the output folder',
            })

            app.get(streamPath, (req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-transform',
                    Connection: 'keep-alive',
                    // Nginx buffers proxied responses by default and that is
                    // fatal to an event stream; this is the header it honours.
                    'X-Accel-Buffering': 'no',
                })
                res.write(`event: hello\ndata: ${JSON.stringify({ boot })}\n\n`)
                clients.add(res)
                req.on('close', () => clients.delete(res))
            })

            // Injection, ahead of the static mount.
            //
            // The engine registers its static handler from an inner onLoaded
            // so it runs last, after every plugin has had its turn. That is
            // what lets this sit in front of it and hand back an HTML document
            // with the snippet in it; anything this does not answer falls
            // through and is served normally.
            app.use((req, res, next) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') return next()
                // No Origin means a top-level navigation. A request WITH one
                // is fetch/XHR — script asking for the same HTML as data — and
                // injecting there corrupts what the caller parses. Borrowed
                // from alive-server, and it is the subtle half of doing this
                // correctly.
                if (req.headers.origin) return next()

                const file = resolveFile(req.path)
                if (!file) return next()

                readFile(file, 'utf8').then((html) => {
                    const tag = injectionPoint(html)
                    if (!tag) {
                        // Said out loud, once per file. A page that silently
                        // never receives the snippet looks exactly like a page
                        // whose reload is broken, and the difference is a
                        // missing closing tag nobody would think to look for.
                        warnOnce(logger, file)
                        return next()
                    }
                    const body = injectInto(html, clientScript(streamPath))
                    res.type('html')
                    res.set('Cache-Control', 'no-store')
                    res.send(body)
                }).catch(() => next())
            })

            logger.info('Live reload mounted: %s', streamPath)
        })

        // Served paths that changed, straight from the folder they are served
        // from. Accumulated rather than sent per event: one build writes many
        // files, and a reload per file is a browser that never settles.
        const pending = new Set()
        let flushTimer = null

        function flush() {
            clearTimeout(flushTimer)
            flushTimer = null
            if (!pending.size || !clients.size) return pending.clear()
            const paths = [...pending]
            pending.clear()
            // The one thing the folder cannot tell us: whether the build that
            // wrote it succeeded. A failed render leaves the previous good
            // bytes in place, so the page would reload to look identical and
            // the failure would pass unnoticed.
            const errors = buildReport().summary?.errors ?? 0
            broadcast('build', { errors, paths })
        }

        onLoaded(async () => {
            const outputFolder = runtime.options.outputFolder
            if (!runtime.options.app || !outputFolder) return

            // The engine's own watcher primitive, not a second chokidar.
            // It carries mikser's junk filter and — load-bearing here — it
            // follows symlinks: the files plugin serves a file by linking it
            // from the source folder into the output folder, so a watcher that
            // stopped at the link would see it created once and never hear
            // about a stylesheet edit again.
            watchFolder(outputFolder, (_event, fullPath) => {
                const rel = path.relative(outputFolder, fullPath)
                if (!rel || rel.startsWith('..')) return
                pending.add('/' + rel.split(path.sep).join('/'))
                // Fallback only. A change that arrives outside a build —
                // something else writing into the folder — still reaches the
                // browser, just without a verdict to go with it.
                clearTimeout(flushTimer)
                flushTimer = setTimeout(flush, 250)
            })
        })

        // The primary flush. One event per build, with an accurate error
        // count, rather than whenever the debounce happens to expire.
        onFinalized(async () => flush())
    }
}

const warned = new Set()
function warnOnce(logger, file) {
    if (warned.has(file)) return
    warned.add(file)
    logger?.warn?.({ code: 'live-no-inject-point' },
        'Could not inject the live-reload snippet into %s — it has no </body> or </head>. That page '
        + 'will not reload on its own; every other page still will.', file)
}
