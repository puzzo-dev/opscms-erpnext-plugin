/**
 * (A copy of `@ivarse/shared-cms/pinned-fetch`: this package is published on its own and does not depend on the platform's packages.)
 *
 * An outbound request whose address is checked AT THE MOMENT OF CONNECTING.
 *
 * `assertSafePublicUrl` resolves a name and checks every address it gets; `fetch` then resolves the name again to connect. A name with a
 * very short DNS lifetime can answer "public" to the first and "internal" to the second (DNS rebinding), so the check proves nothing about
 * where the request goes. Here the check is the connection's own lookup: the addresses that are validated are the addresses that are
 * connected to, so there is no second answer to be different.
 *
 * Redirects are never followed (a redirect is a second request to somewhere nobody vetted), and a response larger than `maxBytes` is cut
 * off rather than read into memory. The result is an ordinary `Response`, so a caller written for `fetch` needs no other change.
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import net from 'node:net'
import type { LookupFunction } from 'node:net'

import { isPrivateOrReservedIpv4, isPrivateOrReservedIpv6, privateErpUrlsAllowed } from './ssrfGuard'

/** A response bigger than this is cut off: an integration answers in kilobytes, and a hostile receiver must not fill the server's memory. */
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export interface PinnedFetchInit {
    method?: string
    headers?: Record<string, string>
    body?: string | Uint8Array
    signal?: AbortSignal
    /** The most of the response that is read. */
    maxBytes?: number
}

const isPublicAddress = (address: string, family: number): boolean => (family === 6 ? !isPrivateOrReservedIpv6(address) : !isPrivateOrReservedIpv4(address))

/** The addresses among `found` that may be connected to, or none when ANY of them may not (a mixed answer is a rebinding attempt, not a choice). */
export function publicAddressesOnly(found: ReadonlyArray<Pick<LookupAddress, 'address' | 'family'>>): Pick<LookupAddress, 'address' | 'family'>[] {
    if (found.length === 0) return []
    return found.every((entry) => isPublicAddress(entry.address, entry.family)) ? [...found] : []
}

/** The `lookup` a connection uses: resolves the name itself and refuses to hand back anything that is not public. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, found) => {
        if (error) return callback(error, '', 4)
        const allowed = publicAddressesOnly(found)
        if (allowed.length === 0) {
            const refused = Object.assign(new Error(`${hostname} resolves to an address that cannot be used (private, loopback or reserved)`), { code: 'ESSRF' })
            return callback(refused as NodeJS.ErrnoException, '', 4)
        }
        // Node asks for every address when it tries more than one family; otherwise for a single one.
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, allowed as LookupAddress[])
        callback(null, allowed[0].address, allowed[0].family)
    })
}

/**
 * POST/GET `rawUrl` without ever connecting to a private, loopback or reserved address. `allowPrivate` is for the platform's own
 * on-network integrations and for tests; it makes this an ordinary request with the same limits.
 */
export async function pinnedFetch(rawUrl: string, init: PinnedFetchInit = {}, options: { allowPrivate?: boolean } = {}): Promise<Response> {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`blocked URL scheme "${url.protocol}"`)
    if (url.username || url.password) throw new Error('the address cannot contain a username or password')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    // A literal address is not looked up, so the connection's lookup never sees it: judge it here.
    if (!options.allowPrivate && net.isIP(host) && !isPublicAddress(host, net.isIP(host))) throw new Error('blocked private/loopback IP')

    const maxBytes = init.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest

    return new Promise<Response>((resolve, reject) => {
        const request = send(
            url,
            {
                method: init.method ?? 'GET',
                headers: init.headers,
                ...(options.allowPrivate ? {} : { lookup: publicOnlyLookup }),
                signal: init.signal,
            },
            (incoming) => {
                const chunks: Buffer[] = []
                let received = 0
                incoming.on('data', (chunk: Buffer) => {
                    received += chunk.length
                    if (received > maxBytes) {
                        incoming.destroy(new Error(`the response is larger than ${maxBytes} bytes`))
                        return
                    }
                    chunks.push(chunk)
                })
                incoming.on('error', reject)
                incoming.on('end', () => {
                    const headers = new Headers()
                    for (const [name, value] of Object.entries(incoming.headers)) {
                        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry))
                        else if (value !== undefined) headers.set(name, value)
                    }
                    const status = incoming.statusCode ?? 502
                    // A response with these statuses may not carry a body.
                    const bodyless = status === 204 || status === 205 || status === 304 || (status >= 100 && status < 200)
                    resolve(new Response(bodyless ? null : Buffer.concat(chunks), { status: status >= 200 ? status : 502, statusText: incoming.statusMessage, headers }))
                })
            },
        )
        request.on('error', reject)
        if (init.body !== undefined) request.write(init.body)
        request.end()
    })
}

/**
 * The request every call to the ERPNext server is made with. In production (and wherever the development switch is off) the address is
 * judged when the connection is made, so a name that was public when its URL was validated cannot lead into the network afterwards.
 * With the development switch on (`ERPNEXT_ALLOW_PRIVATE_URLS`, never honoured in production) it is an ordinary `fetch`.
 */
export const erpFetch: typeof fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (privateErpUrlsAllowed()) return globalThis.fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((value, name) => {
        headers[name] = value
    })
    const body = init.body
    if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Uint8Array) && !(body instanceof URLSearchParams)) {
        throw new TypeError('A request body must be a string, bytes or URLSearchParams.')
    }
    if (body instanceof URLSearchParams && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    return pinnedFetch(url, {
        method: init.method ?? (input instanceof Request ? input.method : 'GET'),
        headers,
        body: body instanceof URLSearchParams ? body.toString() : (body ?? undefined),
        signal: init.signal ?? undefined,
    })
}) as typeof fetch
