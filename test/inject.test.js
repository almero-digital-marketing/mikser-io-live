// Where the live-reload snippet goes, and what the browser does with it.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { injectionPoint, injectInto } from '../index.js'
import { clientScript } from '../lib/client.js'

describe('finding somewhere to put the snippet', () => {
    it('prefers the end of the body', () => {
        assert.equal(injectionPoint('<html><head></head><body>hi</body></html>'), '</body>')
    })

    it('falls back to a closing svg', () => {
        // A standalone SVG served as a page has no body at all, and is a thing
        // mikser renders. Borrowed from alive-server, which is right about it.
        assert.equal(injectionPoint('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), '</svg>')
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
