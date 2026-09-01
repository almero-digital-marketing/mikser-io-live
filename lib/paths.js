// Is a changed path the page a browser is looking at?
//
// One page has three URLs. /about, /about/ and /about/index.html are all
// served, and the watcher only ever reports the third — so comparing them
// literally reloads two of them and silently never reloads the one people
// actually type or link to.
//
// Lives here, alone, because it is needed on both sides: the browser decides
// with it, and the tests check it. The snippet inlines THIS function's source
// rather than carrying its own copy, so the two cannot drift into disagreeing
// about which page you are on.
export function samePage(a, b) {
    const norm = (p) => String(p).replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1')
    return norm(a) === norm(b)
}
