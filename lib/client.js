// The snippet injected into every served HTML page, and the worker it shares.
//
// Deliberately dependency-free and tiny: it is added to every page in dev, so
// anything it drags in is something the developer is looking at that will not
// be there in production.
//
// EventSource rather than a WebSocket. It reconnects on its own, survives a
// mikser restart without any retry logic here, needs no upgrade handshake, and
// mikser already has a `streaming: true` route kind for exactly this.
//
// ONE stream per browser, not one per tab. An EventSource holds its connection
// open for as long as it lives, and over HTTP/1.1 a browser allows six
// connections to a host. Six open tabs of a dev site held all six, and every
// later request to that host queued behind streams that never end — a seventh
// tab never loaded, and a page's images came up blank, a different few on
// each reload, with nothing on the server to show for it.
//
// So the stream lives in a SharedWorker — one per browser for the site, held
// by the worker, relayed to every tab through its port. Not the Web Locks API:
// it exists only in a secure context, and a dev site is plain http on a LAN
// address, where every tab would have fallen back to a stream of its own. A
// browser without SharedWorker (Chrome on Android) keeps a stream per tab.
import { samePage } from './paths.js'

// `boot` is the id of the process serving the page: a hello from any other
// means mikser restarted under it. Carried on the page because the stream is
// shared, and the hello a tab hears may have been sent before it was opened.
export function clientScript(path, boot = null) {
    return `<script data-mikser-live>(() => {
  const samePage = ${samePage.toString()}
  const stream = ${JSON.stringify(path)}
  let boot = ${JSON.stringify(boot)}

  // A different boot id means mikser restarted — new code, new config,
  // possibly a different site. Reload rather than trusting a page rendered by
  // the process that just went away.
  const hello = (data) => {
    const id = JSON.parse(data).boot
    if (boot !== null && boot !== id) return location.reload()
    boot = id
  }

  const build = (data) => {
    const { paths = [], errors = 0 } = JSON.parse(data)

    // A failed build leaves the previous good output on disk, so reloading
    // shows the same page and hides the failure. Say so instead.
    if (errors) return console.warn('[mikser] build failed —', errors, 'render error(s); page not reloaded')
    if (!paths.length) return

    // Stylesheets swap in place. Reloading would work and would also throw
    // away scroll position, open menus, form state and whatever you were
    // looking at — which for a CSS edit is the entire cost of the change.
    const css = paths.filter((p) => p.endsWith('.css'))
    if (css.length === paths.length) {
      for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
        const url = new URL(link.href, location.href)
        if (!css.includes(url.pathname)) continue
        // set(), not append: repeated edits must not accumulate a query
        // string, which is what makes the browser treat it as a new resource
        // every time and never reuse the connection.
        url.searchParams.set('mikser', Date.now())
        link.href = url.href
      }
      return
    }

    // Anything else: reload, but only if this page is among what changed. A
    // build that rerendered forty other pages is not a reason to interrupt
    // the one being looked at.
    //
    // Compared after normalising both sides, because one page has three URLs.
    // /about, /about/ and /about/index.html are all served, and the watcher
    // only ever reports the third — so a plain comparison reloaded two of them
    // and silently never reloaded the one people actually type or link to.
    if (paths.some((p) => samePage(p, location.pathname))) location.reload()
  }

  const handle = (type, data) => (type === 'hello' ? hello : build)(data)

  if (typeof SharedWorker === 'function') {
    try {
      const worker = new SharedWorker(stream + '/worker.js', { name: 'mikser-live' })
      worker.port.onmessage = (event) => handle(event.data.type, event.data.data)
      // Leaving, the port says so — a worker posting to every page ever
      // opened would grow for the length of the session. Restored from the
      // back/forward cache, it joins again.
      addEventListener('pagehide', () => worker.port.postMessage('bye'))
      addEventListener('pageshow', (event) => { if (event.persisted) worker.port.postMessage('join') })
      return
    } catch {
      // A sandboxed frame, or a browser refusing the worker: a stream of its own.
    }
  }

  const source = new EventSource(stream)
  source.addEventListener('hello', (event) => handle('hello', event.data))
  source.addEventListener('build', (event) => handle('build', event.data))
})()</script>`
}

// The SharedWorker every tab of the site shares: one stream, relayed to all.
export function workerScript(path) {
    return `const ports = new Set()
let hello = null
const source = new EventSource(${JSON.stringify(path)})

// While the stream is down, the hello it last carried may be from a process
// that is gone. A tab opened now was served by the new one, and telling it the
// old id would reload it — again and again until the stream is back.
source.onerror = () => { hello = null }

for (const type of ['hello', 'build']) {
  source.addEventListener(type, (event) => {
    if (type === 'hello') hello = event.data
    for (const port of ports) port.postMessage({ type, data: event.data })
  })
}

// A tab joining mid-session hears the current hello, so a page served by a
// process that has since been replaced still finds out.
const join = (port) => {
  ports.add(port)
  if (hello) port.postMessage({ type: 'hello', data: hello })
}

onconnect = (event) => {
  const port = event.ports[0]
  port.onmessage = (message) => (message.data === 'bye' ? ports.delete(port) : join(port))
  join(port)
}
`
}
