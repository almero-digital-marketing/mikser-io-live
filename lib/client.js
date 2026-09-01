// The snippet injected into every served HTML page.
//
// Deliberately dependency-free and tiny: it is added to every page in dev, so
// anything it drags in is something the developer is looking at that will not
// be there in production.
//
// EventSource rather than a WebSocket. It reconnects on its own, survives a
// mikser restart without any retry logic here, needs no upgrade handshake, and
// mikser already has a `streaming: true` route kind for exactly this.
import { samePage } from './paths.js'

export function clientScript(path) {
    return `<script data-mikser-live>(() => {
  const samePage = ${samePage.toString()}
  const source = new EventSource(${JSON.stringify(path)})
  let boot = null

  // A different boot id means mikser restarted — new code, new config,
  // possibly a different site. Reload rather than trusting a page rendered by
  // the process that just went away.
  source.addEventListener('hello', (event) => {
    const id = JSON.parse(event.data).boot
    if (boot !== null && boot !== id) return location.reload()
    boot = id
  })

  source.addEventListener('build', (event) => {
    const { paths = [], errors = 0 } = JSON.parse(event.data)

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
  })
})()</script>`
}
