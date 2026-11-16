import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Payload, PayloadRequest } from 'payload'

import { deleteErpRecord, upsertErpRecord, type ERPNextSyncRule } from '../../src/sync/runSyncRule'

const site = { type: 'relationship', name: 'site', relationTo: 'sites' }

/** A catalogue with the items it has; records what is made, changed and deleted. */
function world(items: Array<{ id: number; erp_item_code: string; price: number }>) {
    const done: string[] = []
    const payload = {
        collections: { 'catalogue-items': { config: { fields: [site, { name: 'erp_item_code', type: 'text' }, { name: 'price', type: 'number' }] } } },
        find: async ({ where }: { where: unknown }) => {
            const docs = items.filter((i) => JSON.stringify(where).includes(JSON.stringify(i.erp_item_code)))
            return { docs, totalDocs: docs.length }
        },
        findByID: async () => ({ organization: 1 }),
        create: async () => {
            done.push('create')
            return { id: 99 }
        },
        update: async ({ id }: { id: number }) => {
            done.push(`update ${id}`)
            return { id }
        },
        delete: async ({ id }: { id: number }) => {
            done.push(`delete ${id}`)
            return { id }
        },
    } as unknown as Payload
    return { req: { payload } as unknown as PayloadRequest, done }
}

const rule = (updateOnly: boolean): ERPNextSyncRule =>
    ({
        doctype: 'Item Price',
        targetCollection: 'catalogue-items',
        isActive: true,
        updateOnly,
        field_mappings: [
            { erp_field: 'item_code', payload_field: 'erp_item_code', isUpsertKey: true },
            { erp_field: 'price_list_rate', payload_field: 'price' },
        ],
    }) as unknown as ERPNextSyncRule

describe('a rule that only updates what already exists (prices onto the items an Item rule brought in)', () => {
    it('changes the item it matches', async () => {
        const w = world([{ id: 5, erp_item_code: 'Peach - 250ml', price: 100 }])
        const result = await upsertErpRecord(w.req, rule(true), { item_code: 'Peach - 250ml', price_list_rate: 2500 }, 1)
        assert.equal(result.action, 'updated')
        assert.deepEqual(w.done, ['update 5'])
    })

    it('makes nothing for an item the catalogue does not have', async () => {
        const w = world([{ id: 5, erp_item_code: 'Peach - 250ml', price: 100 }])
        const result = await upsertErpRecord(w.req, rule(true), { item_code: 'Rum', price_list_rate: 9 }, 1)
        assert.equal(result.action, 'skipped')
        assert.deepEqual(w.done, [])
    })

    it('deletes nothing when ERPNext deletes the price', async () => {
        const w = world([{ id: 5, erp_item_code: 'Peach - 250ml', price: 100 }])
        const result = await deleteErpRecord(w.req, rule(true), { item_code: 'Peach - 250ml' }, 1)
        assert.equal(result.action, 'skipped')
        assert.deepEqual(w.done, [])
    })

    it('a rule that is not update-only still makes a record it does not know, and deletes one it does', async () => {
        const w = world([{ id: 5, erp_item_code: 'Peach - 250ml', price: 100 }])
        assert.equal((await upsertErpRecord(w.req, rule(false), { item_code: 'Rum', price_list_rate: 9 }, 1)).action, 'created')
        assert.equal((await deleteErpRecord(w.req, rule(false), { item_code: 'Peach - 250ml' }, 1)).action, 'deleted')
        assert.deepEqual(w.done, ['create', 'delete 5'])
    })
})
