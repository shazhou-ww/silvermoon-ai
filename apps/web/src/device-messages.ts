import { canonicalPayload, messageIdSchema, pageSchema, submissionSchema, type Message, type MessagePage, type Submission } from "@silvermoon-ai/sync-protocol/duplex"

export const MESSAGE_CACHE = { records: 128, bytes: 512 * 1024, scopes: 8 } as const
export interface Feed { messages: Message[]; next: string; loaded: boolean }
export interface PendingSend { device: string; submission: Submission; accepted?: string }
export const emptyFeed = (): Feed => ({ messages: [], next: "0", loaded: false })
const prefix = "silvermoon:messages:v2:"
export const accountStorageKey = (account: string) => `${prefix}${encodeURIComponent(account)}`
export const scopeKey = (device?: string) => device === undefined ? "account:up" : `device:${device}:both`
interface Saved { scopes: Record<string, Feed>; pending: PendingSend | null }
const blank = (): Saved => ({ scopes: {}, pending: null })

export function boundedFeed(messages: Message[], next: string): Feed {
  const kept: Message[] = []
  let bytes = 0
  for (const message of messages.slice(-MESSAGE_CACHE.records).reverse()) {
    const size = new TextEncoder().encode(JSON.stringify(message)).byteLength
    if (bytes + size > MESSAGE_CACHE.bytes) break
    kept.unshift(message); bytes += size
  }
  return { messages: kept, next, loaded: true }
}

export function acceptPage(feed: Feed, input: unknown, account: string, device?: string): Feed {
  const page = pageSchema.parse(input)
  let previous = feed.next
  for (const message of page.messages) {
    if (message.account_id !== account || (device === undefined ? !message.is_upstream : message.device_id !== device)
      || BigInt(message.id) <= BigInt(previous)) throw new Error("Invalid message read scope or ordering")
    previous = message.id
  }
  if (page.next !== previous || BigInt(page.retained_after) > BigInt(feed.next)) throw new Error("Invalid message cursor; loaded history retained")
  return boundedFeed([...feed.messages, ...page.messages], page.next)
}

export function readSaved(storage: Storage, account: string): Saved {
  const text = storage.getItem(accountStorageKey(account))
  if (text === null) return blank()
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== "object" || !("scopes" in value) || !("pending" in value)) throw new Error("Invalid saved workspace")
  const saved = value as Saved
  if (!saved.scopes || typeof saved.scopes !== "object" || Array.isArray(saved.scopes)
    || Object.keys(saved.scopes).length > MESSAGE_CACHE.scopes) throw new Error("Invalid saved scopes")
  for (const [scope, feed] of Object.entries(saved.scopes)) {
    if (!scope.startsWith("device:") && scope !== "account:up") throw new Error("Invalid saved scope")
    if (!messageIdSchema.safeParse(feed.next).success || typeof feed.loaded !== "boolean" || !Array.isArray(feed.messages)) throw new Error("Invalid saved cursor")
    let previous = "0"
    for (const message of feed.messages) {
      const parsed = pageSchema.parse({ messages: [message], next: feed.next, retained_after: "0" }).messages[0]
      if (parsed.account_id !== account || BigInt(parsed.id) <= BigInt(previous) || BigInt(parsed.id) > BigInt(feed.next)
        || (scope === "account:up" ? !parsed.is_upstream : scope !== scopeKey(parsed.device_id))) throw new Error("Invalid saved history")
      previous = parsed.id
    }
    saved.scopes[scope] = boundedFeed(feed.messages, feed.next)
    saved.scopes[scope].loaded = feed.loaded
  }
  if (saved.pending !== null) {
    if (!saved.pending || typeof saved.pending.device !== "string" || !saved.pending.device
      || (saved.pending.accepted !== undefined && !messageIdSchema.safeParse(saved.pending.accepted).success)) throw new Error("Invalid saved request")
    saved.pending.submission = submissionSchema.parse(saved.pending.submission)
    canonicalPayload(saved.pending.submission.payload)
  }
  return saved
}

export type WorkspaceLock = <T>(name: string, operation: () => T) => Promise<T>
export const browserWorkspaceLock: WorkspaceLock = (name, operation) => {
  if (typeof navigator === "undefined" || !navigator?.locks) return Promise.reject(new Error("Durable coordination unavailable: Web Locks required"))
  return navigator.locks.request(name, { signal: AbortSignal.timeout(10_000) }, operation)
}

export async function saveScope(storage: Storage, account: string, scope: string, feed: Feed, lock = browserWorkspaceLock): Promise<void> {
  await lock(accountStorageKey(account), () => {
    const saved = readSaved(storage, account)
    const previous = saved.scopes[scope]
    if (previous?.loaded && BigInt(previous.next) >= BigInt(feed.next)) return
    delete saved.scopes[scope]
    saved.scopes[scope] = feed
    const keys = Object.keys(saved.scopes)
    for (const key of keys.filter(key => key !== "account:up").slice(0, Math.max(0, keys.length - MESSAGE_CACHE.scopes))) delete saved.scopes[key]
    storage.setItem(accountStorageKey(account), JSON.stringify(saved))
  })
}

export async function savePending(storage: Storage, account: string, pending: PendingSend | null, expectedKey?: string, lock = browserWorkspaceLock): Promise<PendingSend | null> {
  return lock(accountStorageKey(account), () => {
    const saved = readSaved(storage, account)
    if (saved.pending) {
      if (pending === null) {
        if (!saved.pending.accepted || saved.pending.submission.key !== expectedKey) throw new Error("Request changed in another tab; reload to restore it")
      } else {
        if (pending.device !== saved.pending.device || pending.submission.key !== saved.pending.submission.key
          || canonicalPayload(pending.submission.payload) !== canonicalPayload(saved.pending.submission.payload)) {
          throw new Error("An unresolved request already exists; restore its original target, payload and key")
        }
        if (saved.pending.accepted) {
          if (pending.accepted && pending.accepted !== saved.pending.accepted) throw new Error("Conflicting acceptance ID")
          return saved.pending
        }
      }
    }
    saved.pending = pending
    storage.setItem(accountStorageKey(account), JSON.stringify(saved))
    return pending
  })
}

export function prepareSend(device: string | undefined, text: string, enabled: boolean): PendingSend {
  if (!device) throw new Error("Choose a Device first")
  if (!enabled) throw new Error("Enable sending for this session first")
  const payload = parsePayload(text)
  const submission = submissionSchema.parse({ key: crypto.randomUUID(), payload })
  canonicalPayload(submission.payload)
  return { device, submission }
}

export function parsePayload(text: string): Submission["payload"] {
  const payload = submissionSchema.shape.payload.parse(JSON.parse(text))
  canonicalPayload(payload)
  return payload
}

export const messagesEndpoint = (device?: string) => device === undefined
  ? "/api/v2/account/events" : `/api/v2/devices/${encodeURIComponent(device)}/messages`
export type { Message, MessagePage }
