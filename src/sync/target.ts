import type { Payload } from 'payload'

/**
 * Where an inbound sync may write, judged from the collection itself (the platform holding this plugin applies a stricter list on top).
 *
 * The sync writes with every access rule off, and a rule's target is typed in by a site's admin, so a target that holds sign-in accounts,
 * belongs to no site, or is one of Payload's own is refused outright: otherwise "write into the users collection, set `role`" is a way
 * to become a super-admin. Returns the reason, or null when the collection may be written.
 */
export function syncTargetProblem(payload: Payload, collection: unknown): string | null {
    if (typeof collection !== 'string' || !collection.trim()) return 'no target collection is named'
    const slug = collection.trim()
    const config = (payload.collections as unknown as Record<string, { config?: { auth?: unknown; fields?: unknown[] } }>)[slug]?.config
    if (!config) return `"${slug}" is not a collection`
    if (slug.startsWith('payload-')) return `"${slug}" is one of Payload's own collections`
    if (config.auth) return `"${slug}" holds sign-in accounts`
    if (!hasSiteField(config.fields)) return `"${slug}" does not belong to a site`
    return null
}

function hasSiteField(fields: unknown): boolean {
    if (!Array.isArray(fields)) return false
    for (const field of fields as Array<Record<string, unknown>>) {
        if (field?.type === 'relationship' && field.name === 'site') return true
        if (hasSiteField(field?.fields)) return true
        if (Array.isArray(field?.tabs) && (field.tabs as Array<{ fields?: unknown }>).some((tab) => hasSiteField(tab.fields))) return true
    }
    return false
}
