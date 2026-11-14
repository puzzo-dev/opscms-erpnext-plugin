import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { Field } from 'payload'

import { ERPNextConfig } from '../../src/collections/ERPNextConfig'

const find = (fields: Field[], name: string): Field | undefined => {
    for (const field of fields) {
        if ('name' in field && field.name === name) return field
        const inner = ('fields' in field && field.fields) || ('tabs' in field && field.tabs?.flatMap((tab) => tab.fields)) || []
        const hit = find(inner as Field[], name)
        if (hit) return hit
    }
    return undefined
}

describe('the ERPNext config shows its own webhook address', () => {
    const field = find(ERPNextConfig.fields, 'webhookUrl') as unknown as { virtual: boolean; admin: { readOnly: boolean }; hooks: { afterRead: Array<(a: unknown) => Promise<string>> } }

    it('has a read-only address that holds nothing', () => {
        assert.ok(field, 'the field is there')
        assert.strictEqual(field.virtual, true)
        assert.strictEqual(field.admin.readOnly, true)
    })

    it('is the sync address for this site, from the server\'s own address', async () => {
        process.env.PAYLOAD_PUBLIC_SERVER_URL = 'https://cms.example.com/'
        const read = (site: unknown) => field.hooks.afterRead[0]!({ siblingData: { site }, req: { payload: { findByID: async () => ({ slug: 'avril-beetails' }) } } })
        assert.strictEqual(await read({ id: 1, slug: 'avril-beetails' }), 'https://cms.example.com/api/erpnext-sync?site=avril-beetails')
        assert.strictEqual(await read(1), 'https://cms.example.com/api/erpnext-sync?site=avril-beetails')
        assert.strictEqual(await read(undefined), '')
        delete process.env.PAYLOAD_PUBLIC_SERVER_URL
        assert.strictEqual(await read(1), '', 'nothing is invented without the server\'s address')
    })
})
