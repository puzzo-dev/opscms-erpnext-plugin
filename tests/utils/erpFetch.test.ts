import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, it } from 'node:test'

import { erpFetch, publicAddressesOnly } from '../../src/utils/erpFetch'

/**
 * Every call to the ERPNext server is made to an address judged at the moment of connecting, so a name that was public when its URL was
 * validated cannot be pointed inward afterwards.
 */

describe('which addresses a connection may use', () => {
    it('refuses a whole answer when any address in it is private, loopback or link-local', () => {
        assert.equal(publicAddressesOnly([{ address: '8.8.8.8', family: 4 }]).length, 1)
        assert.deepEqual(publicAddressesOnly([{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]), [])
        assert.deepEqual(publicAddressesOnly([{ address: '10.1.2.3', family: 4 }]), [])
        assert.deepEqual(publicAddressesOnly([{ address: '::ffff:10.1.2.3', family: 6 }]), [])
    })
})

describe('erpFetch', () => {
    afterEach(() => {
        delete process.env.ERPNEXT_ALLOW_PRIVATE_URLS
    })

    it('does not connect to a local address in production-like settings, by number or by name', async () => {
        const server = createServer((_req, res) => res.end('hello'))
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
        const port = (server.address() as AddressInfo).port
        try {
            await assert.rejects(erpFetch(`http://127.0.0.1:${port}/api/method/ping`), /private|loopback/)
            await assert.rejects(erpFetch(`http://localhost:${port}/api/method/ping`), /cannot be used|resolves|ESSRF/)
        } finally {
            server.close()
        }
    })

    it('is an ordinary fetch when the development switch is on (never honoured in production)', async () => {
        const server = createServer((_req, res) => res.end('hello'))
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
        const port = (server.address() as AddressInfo).port
        process.env.ERPNEXT_ALLOW_PRIVATE_URLS = 'true'
        try {
            assert.equal(await (await erpFetch(`http://127.0.0.1:${port}/x`)).text(), 'hello')
        } finally {
            server.close()
        }
    })
})
