import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Payload } from 'payload'

import { syncTargetProblem } from '../../src/sync/target'

const site = { type: 'relationship', name: 'site', relationTo: 'sites' }
const payload = {
    collections: {
        'catalogue-items': { config: { fields: [site, { name: 'title', type: 'text' }] } },
        tabbed: { config: { fields: [{ type: 'tabs', tabs: [{ fields: [site] }] }] } },
        users: { config: { auth: true, fields: [site] } },
        sites: { config: { fields: [{ name: 'slug', type: 'text' }] } },
        'payload-migrations': { config: { fields: [site] } },
    },
} as unknown as Payload

describe('where an inbound sync may write', () => {
    it('allows a collection that belongs to a site, also when the field sits in a tab', () => {
        assert.equal(syncTargetProblem(payload, 'catalogue-items'), null)
        assert.equal(syncTargetProblem(payload, 'tabbed'), null)
    })

    it('refuses accounts, collections with no site, Payload\'s own and anything unknown or unnamed', () => {
        assert.match(String(syncTargetProblem(payload, 'users')), /sign-in accounts/)
        assert.match(String(syncTargetProblem(payload, 'sites')), /does not belong to a site/)
        assert.match(String(syncTargetProblem(payload, 'payload-migrations')), /Payload's own/)
        assert.match(String(syncTargetProblem(payload, 'nope')), /not a collection/)
        assert.match(String(syncTargetProblem(payload, '')), /no target/)
    })
})
