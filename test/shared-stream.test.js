// One stream per browser, however many tabs are open.
//
// Over HTTP/1.1 a browser allows six connections to a host, and an
// EventSource holds one for as long as its page lives. Six tabs of a dev site
// held all six, and the next page's images queued behind them for good —
// blank, a different few on every reload. These run the injected snippet
// itself, several tabs in one simulated browser, and count connections.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { clientScript } from '../lib/client.js'

// What tabs of one browser share: its lock manager and its broadcast bus.
function browser({ locks = true, channels = true } = {}) {
    const streams = []
    const held = new Map()        // lock name -> holding tab
    const waiting = new Map()     // lock name -> [{ tab, grant }]
    const bus = new Map()         // channel name -> Set of channels

    function grantNext(name) {
        const queue = waiting.get(name) ?? []
        const next = queue.shift()
        if (!next) return held.delete(name)
        held.set(name, next.tab)
        next.grant()
    }

    function open(pathname, boot) {
        const tab = { pathname, reloads: 0, closed: false, channels: [], sources: [] }

        class EventSource {
            constructor(url) {
                this.url = url
                this.listeners = {}
                this.tab = tab
                streams.push(this)
                tab.sources.push(this)
            }
            addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
            emit(type, data) {
                if (tab.closed) return
                for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) })
            }
        }

        class BroadcastChannel {
            constructor(name) {
                this.name = name
                if (!bus.has(name)) bus.set(name, new Set())
                bus.get(name).add(this)
                tab.channels.push(this)
            }
            postMessage(data) {
                for (const other of bus.get(this.name)) {
                    if (other !== this && !other.closed) other.onmessage?.({ data: structuredClone(data) })
                }
            }
        }

        const navigator = locks ? {
            locks: {
                request(name, callback) {
                    const grant = () => callback({ name })
                    if (!held.has(name)) { held.set(name, tab); grant() }
                    else {
                        if (!waiting.has(name)) waiting.set(name, [])
                        waiting.get(name).push({ tab, grant })
                    }
                    return new Promise(() => {})
                },
            },
        } : {}

        tab.close = () => {
            tab.closed = true
            for (const channel of tab.channels) channel.closed = true
            for (const [name, holder] of held) if (holder === tab) grantNext(name)
            for (const queue of waiting.values()) {
                const index = queue.findIndex((entry) => entry.tab === tab)
                if (index !== -1) queue.splice(index, 1)
            }
        }

        const context = vm.createContext({
            EventSource,
            ...(channels ? { BroadcastChannel } : {}),
            navigator,
            location: { pathname, href: `http://dev${pathname}`, reload: () => { tab.reloads++ } },
            document: { querySelectorAll: () => [] },
            console: { warn() {} },
            URL, JSON, Date, Promise,
        })
        const source = clientScript('/live', boot).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
        vm.runInContext(source, context)
        return tab
    }

    const live = () => streams.filter((stream) => !stream.tab.closed)
    return { open, streams, live }
}

describe('tabs of one browser', () => {
    it('share one stream, however many are open', () => {
        const chrome = browser()
        for (let n = 0; n < 8; n++) chrome.open(`/report/${n}/`, 'boot-a')
        assert.equal(chrome.streams.length, 1, 'eight tabs opened eight connections')
    })

    it('all hear a build, and only the page that changed reloads', () => {
        const chrome = browser()
        const leader = chrome.open('/a/', 'boot-a')
        const follower = chrome.open('/b/', 'boot-a')
        const bystander = chrome.open('/c/', 'boot-a')
        chrome.streams[0].emit('build', { paths: ['/b/index.html'] })
        assert.deepEqual([leader.reloads, follower.reloads, bystander.reloads], [0, 1, 0])
    })

    it('hand the stream on when the tab holding it closes', () => {
        const chrome = browser()
        const first = chrome.open('/a/', 'boot-a')
        const second = chrome.open('/b/', 'boot-a')
        first.close()
        assert.equal(chrome.live().length, 1, 'nobody picked the stream up')
        assert.equal(chrome.live()[0].tab, second)
        chrome.live()[0].emit('build', { paths: ['/b/'] })
        assert.equal(second.reloads, 1)
    })

    it('all reload when mikser restarts, including a tab that never held the stream', () => {
        // The follower never saw a hello of its own; it knows its process
        // from the boot id it was served with.
        const chrome = browser()
        const leader = chrome.open('/a/', 'boot-a')
        const follower = chrome.open('/b/', 'boot-a')
        chrome.streams[0].emit('hello', { boot: 'boot-a' })
        assert.deepEqual([leader.reloads, follower.reloads], [0, 0], 'the same process is not a restart')
        chrome.streams[0].emit('hello', { boot: 'boot-b' })
        assert.deepEqual([leader.reloads, follower.reloads], [1, 1])
    })

    it('a page served by an older process reloads at the first hello', () => {
        const chrome = browser()
        const stale = chrome.open('/a/', 'boot-a')
        chrome.streams[0].emit('hello', { boot: 'boot-b' })
        assert.equal(stale.reloads, 1)
    })
})

describe('a browser without the APIs to share', () => {
    it('keeps a stream per tab rather than none', () => {
        for (const missing of [{ locks: false }, { channels: false }]) {
            const old = browser(missing)
            old.open('/a/', 'boot-a')
            old.open('/b/', 'boot-a')
            assert.equal(old.streams.length, 2, `${JSON.stringify(missing)}: no stream at all`)
        }
    })
})
