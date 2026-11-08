import { describe, it, beforeEach, after, afterEach } from 'node:test'
import assert from 'node:assert'
import { encryptCredential, decryptCredential, __resetEncryptionKey } from './erpnextCrypto'

const TEST_KEY = 'a'.repeat(64)

describe('erpnextCrypto', () => {
    beforeEach(() => {
        process.env.ERPNEXT_ENCRYPTION_KEY = TEST_KEY
        __resetEncryptionKey()
    })

    after(() => {
        delete process.env.ERPNEXT_ENCRYPTION_KEY
        __resetEncryptionKey()
    })

    it('round-trips a plain credential', () => {
        const original = 'my-api-secret'
        const encrypted = encryptCredential(original)
        assert.ok(encrypted.startsWith('enc:'), 'encrypted value should have enc: prefix')
        assert.notStrictEqual(encrypted, original)
        const decrypted = decryptCredential(encrypted)
        assert.strictEqual(decrypted, original)
    })

    it('does not double-encrypt an already encrypted value', () => {
        const original = 'another-secret'
        const once = encryptCredential(original)
        const twice = encryptCredential(once)
        assert.strictEqual(once, twice)
        assert.strictEqual(decryptCredential(twice), original)
    })

    it('passes through plain text when no key is set', () => {
        delete process.env.ERPNEXT_ENCRYPTION_KEY
        __resetEncryptionKey()
        const value = 'plain-text-secret'
        assert.strictEqual(encryptCredential(value), value)
        assert.strictEqual(decryptCredential(value), value)
    })

    it('returns raw value on tampered ciphertext', () => {
        const encrypted = encryptCredential('secret')
        // Flip the final hex digit to a DIFFERENT one. Replacing it with a fixed
        // '0' was a ~1-in-16 flake: when the ciphertext already ended in '0' the
        // "tampered" value was byte-identical, so it decrypted cleanly and the
        // assertion below compared 'secret' against the untouched ciphertext.
        const tampered = encrypted.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'))
        // Decrypt should not throw; it should return the raw stored value.
        assert.doesNotThrow(() => decryptCredential(tampered))
        assert.strictEqual(decryptCredential(tampered), tampered)
    })
})

describe('credentials through a host that keeps a key per site', async () => {
    const { bindCredentialHost, decryptCredential, encryptCredential, encryptCredentialForSite } = await import('./erpnextCrypto')
    afterEach(() => bindCredentialHost(undefined))

    it('uses the host to encrypt for a site and to decrypt, and still reads what the package wrote before', async () => {
        const seen: Array<{ site: unknown; plaintext: string }> = []
        bindCredentialHost({
            encrypt: async (_payload, site, plaintext) => { seen.push({ site, plaintext }); return `enc:s1:HOST(${plaintext})` },
            decrypt: (stored) => (stored.startsWith('enc:s1:HOST(') ? stored.slice('enc:s1:HOST('.length, -1) : `legacy:${stored}`),
        })
        assert.equal(await encryptCredentialForSite({}, 7, 'api-secret'), 'enc:s1:HOST(api-secret)')
        assert.deepEqual(seen, [{ site: 7, plaintext: 'api-secret' }])
        assert.equal(decryptCredential('enc:s1:HOST(api-secret)'), 'api-secret')
        assert.equal(decryptCredential('enc:abc:def:ghi'), 'legacy:enc:abc:def:ghi', 'older values go to the host, which reads them too')
        assert.equal(decryptCredential('plain text'), 'plain text', 'a value that was never encrypted is not sent to the host')
    })

    it('does exactly what it did before when no host is bound', async () => {
        bindCredentialHost(undefined)
        const stored = await encryptCredentialForSite({}, 7, 'x')
        assert.ok(stored === 'x' || stored.startsWith('enc:'), 'plain when no key is set, otherwise encrypted with the package\'s own key')
        assert.equal(stored, stored.startsWith('enc:') ? stored : 'x')
        assert.equal(decryptCredential(stored), 'x')
        assert.ok(!stored.startsWith('enc:s1:'), 'never the host\'s per-site form')
    })
})
