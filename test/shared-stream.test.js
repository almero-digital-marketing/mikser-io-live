// One stream per browser, however many tabs are open.
//
// Over HTTP/1.1 a browser allows six connections to a host, and an
// EventSource holds one for as long as it lives. Six tabs of a dev site held
// all six: a seventh never loaded, and the images of the page being looked at
// queued behind streams that never end — blank, a different few on every
// reload. These run the injected snippet and the worker script themselves,
// several tabs in one simulated browser, and count streams.

import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { clientScript, workerScript } from '../lib/client.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

// Assigning onmessage re-references a port, so the file would never exit.
const ports = []
after(() => { for (const port of ports) port.close() })

function fakeEventSource(streams, owner) {
    return class EventSource {
        constructor(url) {
            this.url = url
            this.listeners = {}
            this.owner = owner
            streams.push(this)
        }
        addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
        emit(type, data) {
            for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) })
        }
    }
}

// One browser: its tabs, the SharedWorker they share, and every stream opened.
function browser({ sharedWorker = true, refuse = false } = {}) {
    const streams = []
    const workers = new Map()     // url -> the worker's global scope

    function workerAt(url) {
        if (!workers.has(url)) {
            const scope = vm.createContext({ EventSource: fakeEventSource(streams, 'worker'), Set, JSON })
            vm.runInContext(workerScript('/live'), scope)
            workers.set(url, scope)
        }
        return workers.get(url)
    }

    class SharedWorker {
        constructor(url) {
            if (refuse) throw new Error('SecurityError')
            const { port1, port2 } = new MessageChannel()
            ports.push(port1, port2)
            workerAt(url).onconnect({ ports: [port2] })
            this.port = port1
        }
    }

    function open(pathname, boot) {
        const tab = { pathname, reloads: 0, handlers: {} }
        const context = vm.createContext({
            EventSource: fakeEventSource(streams, tab),
            ...(sharedWorker ? { SharedWorker } : {}),
            location: { pathname, href: `http://dev${pathname}`, reload: () => { tab.reloads++ } },
            document: { querySelectorAll: () => [] },
            addEventListener: (type, handler) => { tab.handlers[type] = handler },
            console: { warn() {} },
            URL, JSON, Date,
        })
        vm.runInContext(clientScript('/live', boot).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''), context)
        tab.leave = () => tab.handlers.pagehide?.({})
        tab.restore = () => tab.handlers.pageshow?.({ persisted: true })
        return tab
    }

    const shared = () => streams.find((stream) => stream.owner === 'worker')
    return { open, streams, shared }
}

describe('tabs of one browser', () => {
    it('share one stream, however many are open', () => {
        const chrome = browser()
        for (let n = 0; n < 8; n++) chrome.open(`/report/${n}/`, 'boot-a')
        assert.equal(chrome.streams.length, 1, `eight tabs opened ${chrome.streams.length} connections`)
        assert.equal(chrome.shared().url, '/live')
    })

    it('all hear a build, and only the page that changed reloads', async () => {
        const chrome = browser()
        const tabs = ['/a/', '/b/', '/c/'].map((page) => chrome.open(page, 'boot-a'))
        chrome.shared().emit('build', { paths: ['/b/index.html'] })
        await settle()
        assert.deepEqual(tabs.map((tab) => tab.reloads), [0, 1, 0])
    })

    it('all reload when mikser restarts', async () => {
        const chrome = browser()
        const tabs = ['/a/', '/b/'].map((page) => chrome.open(page, 'boot-a'))
        chrome.shared().emit('hello', { boot: 'boot-a' })
        await settle()
        assert.deepEqual(tabs.map((tab) => tab.reloads), [0, 0], 'the same process is not a restart')
        chrome.shared().emit('hello', { boot: 'boot-b' })
        await settle()
        assert.deepEqual(tabs.map((tab) => tab.reloads), [1, 1])
    })

    it('a tab opened later hears the current hello, and acts on it', async () => {
        const chrome = browser()
        chrome.open('/a/', 'boot-b')
        chrome.shared().emit('hello', { boot: 'boot-b' })
        await settle()
        const current = chrome.open('/fresh/', 'boot-b')
        const stale = chrome.open('/old/', 'boot-a')
        await settle()
        assert.equal(current.reloads, 0)
        assert.equal(stale.reloads, 1, 'a page from a replaced process was not reloaded')
    })

    it('tells a new tab nothing while the stream is down', async () => {
        // The last hello may be from a process that is gone; repeating it to a
        // page the new process served would reload it in a loop.
        const chrome = browser()
        chrome.open('/a/', 'boot-a')
        chrome.shared().emit('hello', { boot: 'boot-a' })
        chrome.shared().onerror()
        const fresh = chrome.open('/b/', 'boot-b')
        await settle()
        assert.equal(fresh.reloads, 0)
    })

    it('stops relaying to a tab that left, and resumes when it is restored', async () => {
        const chrome = browser()
        const tab = chrome.open('/a/', 'boot-a')
        tab.leave()
        await settle()
        chrome.shared().emit('build', { paths: ['/a/'] })
        await settle()
        assert.equal(tab.reloads, 0, 'a page that left was still sent events')
        tab.restore()
        await settle()
        chrome.shared().emit('build', { paths: ['/a/'] })
        await settle()
        assert.equal(tab.reloads, 1)
    })
})

describe('a browser that cannot share', () => {
    it('keeps a stream per tab rather than none', () => {
        for (const options of [{ sharedWorker: false }, { refuse: true }]) {
            const old = browser(options)
            old.open('/a/', 'boot-a')
            old.open('/b/', 'boot-a')
            assert.equal(old.streams.length, 2, `${JSON.stringify(options)}: no stream at all`)
        }
    })
})
