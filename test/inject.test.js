// Where the live-reload snippet goes, and what the browser does with it.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { injectionPoint, injectInto, samePage } from '../index.js'
import { clientScript } from '../lib/client.js'

describe('finding somewhere to put the snippet', () => {
    it('prefers the end of the body', () => {
        assert.equal(injectionPoint('<html><head></head><body>hi</body></html>'), '</body>')
    })

    it('does NOT treat a closing svg as an injection point', () => {
        // An SVG served as image/svg+xml is parsed as XML, where the script's
        // `&&` starts an entity reference and `<` starts a tag. The snippet is
        // not ignored there — it is a fatal parse error and the browser draws
        // nothing. alive-server injects into SVG and gets away with it because
        // its snippet is CDATA-wrapped; this one is not.
        assert.equal(injectionPoint('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), null)
    })

    it('falls back to the head for a document with no closing body', () => {
        assert.equal(injectionPoint('<html><head><title>t</title></head><p>loose'), '</head>')
    })

    it('reports nowhere rather than guessing', () => {
        // A fragment with no closing tag gets no snippet, and the plugin warns
        // — a page that silently never reloads looks exactly like a page whose
        // reload is broken.
        assert.equal(injectionPoint('<p>just a fragment</p>'), null)
    })

    it('matches case-insensitively, because HTML does', () => {
        assert.equal(injectionPoint('<BODY>hi</BODY>'), '</BODY>')
    })
})

describe('injecting', () => {
    it('puts the script BEFORE the closing tag, not after', () => {
        // Past </body> is outside the document; browsers move it back inside,
        // so the bytes on the wire stop agreeing with the DOM.
        const out = injectInto('<body>hi</body>', '<script>x</script>')
        assert.match(out, /<script>x<\/script><\/body>/)
    })

    it('leaves a document it cannot inject into byte-identical', () => {
        const html = '<p>fragment</p>'
        assert.equal(injectInto(html, '<script>x</script>'), html)
    })

    it('injects once, at the first candidate only', () => {
        const out = injectInto('<body>a</body><body>b</body>', '<script>x</script>')
        assert.equal(out.split('<script>x</script>').length - 1, 1)
    })
})

describe('the client snippet', () => {
    it('connects to the path it was mounted at', () => {
        assert.match(clientScript('/__custom'), /EventSource\("\/__custom"\)/)
    })

    it('is marked, so a reader can tell what put it there', () => {
        assert.match(clientScript('/x'), /data-mikser-live/)
    })

    it('does not reload on a failed build', () => {
        // The previous good output is still on disk, so a reload shows the
        // same page and hides the failure.
        assert.match(clientScript('/x'), /if \(errors\) return console\.warn/)
    })

    it('swaps stylesheets instead of reloading', () => {
        assert.match(clientScript('/x'), /link\[rel=stylesheet\]/)
    })

    it('reloads when mikser restarts under it', () => {
        assert.match(clientScript('/x'), /boot !== id/)
    })
})

describe('what it will and will not touch', () => {
    // The rule is html and htm. Anything XML-parsed is excluded outright
    // rather than escaped into working, because a rule that says "HTML" cannot
    // be got subtly wrong the way "HTML, plus XML dialects if the payload is
    // escaped correctly" can.
    it('leaves an svg document alone entirely', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
        assert.equal(injectInto(svg, '<script>a && b</script>'), svg)
    })

    it('keeps the payload that would break XML, so the exclusion is load-bearing', () => {
        // If the snippet ever became XML-safe this test says so, and the
        // exclusion could be revisited deliberately rather than by accident.
        assert.match(clientScript('/live'), /&&/)
    })
})

describe('deciding whether a change is THIS page', () => {
    // One page, three URLs. The watcher reports the file it saw —
    // /about/index.html — and a browser may be sitting on any of the three.
    it('treats every spelling of a page as the same page', () => {
        for (const here of ['/about', '/about/', '/about/index.html']) {
            assert.equal(samePage(here, '/about/index.html'), true, here)
        }
    })

    it('treats the root the same way', () => {
        for (const here of ['/', '/index.html']) {
            assert.equal(samePage(here, '/index.html'), true, here)
        }
    })

    it('still says no to a different page', () => {
        // Over-matching would reload every browser on every build, which is
        // the behaviour this whole comparison exists to avoid.
        assert.equal(samePage('/contact/', '/about/index.html'), false)
        assert.equal(samePage('/', '/about/index.html'), false)
        assert.equal(samePage('/aboutus/', '/about/index.html'), false)
    })
})

describe('the browser and the tests agree', () => {
    it('the snippet uses the same comparison, not a copy of it', () => {
        // Two implementations of "is this my page" is the shape that produced
        // the bug: the tests would keep passing while the browser used
        // something subtly different. The snippet inlines this function's
        // own source.
        const script = clientScript('/live')
        assert.ok(script.includes(samePage.toString()),
            'the client must carry THIS function, not a second version of it')
    })
})
