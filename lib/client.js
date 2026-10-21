// The snippet injected into every served HTML page.
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
// open for as long as the page lives, and over HTTP/1.1 a browser allows six
// connections to a host. Six open tabs of a dev site held all six, and every
// later request to that host — the photos on the page being looked at — queued
// behind streams that never end: blank images, a different few each reload,
// and nothing on the server to show for it. So the tabs elect one of their
// number with the Web Locks API, that tab alone opens the stream, and it
// relays every event to the others over a BroadcastChannel. When it closes,
// its lock passes to the next tab, which opens the stream in turn. A browser
// without either API gets the stream per tab, as before.
import { samePage } from './paths.js'

// `boot` is the id of the process serving the page: a hello from any other
// means mikser restarted under it. Carried on the page because a tab that is
// not the one holding the stream never sees a hello of its own.
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

  const listen = (onEvent) => {
    const source = new EventSource(stream)
    source.addEventListener('hello', (event) => onEvent('hello', event.data))
    source.addEventListener('build', (event) => onEvent('build', event.data))
  }

  if (!navigator.locks || typeof BroadcastChannel !== 'function') return listen(handle)

  const name = 'mikser-live ' + stream
  const channel = new BroadcastChannel(name)
  channel.onmessage = (event) => handle(event.data.type, event.data.data)
  // Held for as long as this page lives: the promise never settles, and the
  // browser releases the lock when the page goes away.
  navigator.locks.request(name, () => new Promise(() => listen((type, data) => {
    // The others first: handling may reload this page and end the relay.
    channel.postMessage({ type, data })
    handle(type, data)
  })))
})()</script>`
}
