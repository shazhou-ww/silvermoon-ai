import { sessionKey } from "@/session-list"

export interface SessionSelection {
  connectorId: string
  sessionId: string
}

export type WorkspaceView = "session" | "settings" | "not-found"

export interface WorkspaceRoute {
  view: WorkspaceView
  selection: SessionSelection | null
}

export function workspaceRoute(location: Pick<Location, "pathname" | "search">): WorkspaceRoute {
  const params = new URLSearchParams(location.search)
  const connectorId = params.get("connector")
  const sessionId = params.get("session")
  return {
    view: location.pathname === "/settings" || location.pathname === "/legacy/settings"
      ? "settings"
      : location.pathname === "/" || location.pathname === "/legacy" ? "session" : "not-found",
    selection: connectorId && sessionId ? { connectorId, sessionId } : null,
  }
}

export function workspaceUrl(
  current: string,
  view: Exclude<WorkspaceView, "not-found">,
  selection: SessionSelection | null,
  hash = "",
): string {
  const url = new URL(current)
  const legacy = url.pathname.startsWith("/legacy")
  url.pathname = view === "settings" ? (legacy ? "/legacy/settings" : "/settings") : (legacy ? "/legacy" : "/")
  url.hash = hash
  if (selection) {
    url.searchParams.set("connector", selection.connectorId)
    url.searchParams.set("session", selection.sessionId)
  } else {
    url.searchParams.delete("connector")
    url.searchParams.delete("session")
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export interface PendingFollowUp {
  commandId: string | null
  version: number
  status: "sending" | "unknown" | "queued" | "sent" | "accepted" | "failed"
}

export interface SessionDraft {
  text: string
  version: number
  pending: PendingFollowUp | null
}

interface StoredDraft extends SessionDraft {
  selection: SessionSelection
}

const emptyDraft: SessionDraft = { text: "", version: 0, pending: null }
const storagePrefix = "silvermoon:session-drafts:"

function selectionKey(selection: SessionSelection): string {
  return sessionKey({ connectorId: selection.connectorId, id: selection.sessionId })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validDraft(value: unknown): value is StoredDraft {
  if (
    !record(value)
    || !record(value.selection)
    || typeof value.selection.connectorId !== "string"
    || !value.selection.connectorId
    || typeof value.selection.sessionId !== "string"
    || !value.selection.sessionId
    || typeof value.text !== "string"
    || typeof value.version !== "number"
    || !Number.isSafeInteger(value.version)
    || value.version < 0
  ) return false
  if (value.pending === null) return true
  return record(value.pending)
    && (value.pending.commandId === null || typeof value.pending.commandId === "string")
    && typeof value.pending.version === "number"
    && Number.isSafeInteger(value.pending.version)
    && value.pending.version >= 0
    && value.pending.version <= value.version
    && typeof value.pending.status === "string"
    && ["sending", "unknown", "queued", "sent", "accepted", "failed"].includes(
      value.pending.status,
    )
}

export class SessionDrafts {
  private accounts = new Map<string, Map<string, StoredDraft>>()
  private storage: () => Storage
  private onError: (message: string) => void

  constructor(
    storage: () => Storage,
    onError: (message: string) => void,
  ) {
    this.storage = storage
    this.onError = onError
  }

  load(accountId: string): void {
    if (this.accounts.has(accountId)) return
    const drafts = new Map<string, StoredDraft>()
    this.accounts.set(accountId, drafts)
    try {
      const raw = this.storage().getItem(this.storageKey(accountId))
      if (raw === null) return
      const values: unknown = JSON.parse(raw)
      if (!Array.isArray(values) || !values.every(validDraft)) {
        throw new Error("Invalid draft cache")
      }
      for (const value of values) {
        drafts.set(selectionKey(value.selection), {
          ...value,
          pending: value.pending?.commandId === null
            ? { ...value.pending, status: "unknown" }
            : value.pending,
        })
      }
    } catch {
      this.onError(
        "Drafts could not be restored. You can still edit here, but refreshing may lose your input.",
      )
    }
  }

  read(accountId: string, selection: SessionSelection): SessionDraft {
    return this.accounts.get(accountId)?.get(selectionKey(selection)) ?? emptyDraft
  }

  write(accountId: string, selection: SessionSelection, text: string): void {
    const current = this.read(accountId, selection)
    this.save(accountId, { ...current, selection, text, version: current.version + 1 })
  }

  begin(accountId: string, selection: SessionSelection): PendingFollowUp {
    const current = this.read(accountId, selection)
    const pending: PendingFollowUp = {
      commandId: null,
      version: current.version,
      status: "sending",
    }
    this.save(accountId, { ...current, selection, pending })
    return pending
  }

  accept(
    accountId: string,
    selection: SessionSelection,
    version: number,
    commandId: string,
    status: "sent" | "failed",
  ): void {
    const current = this.read(accountId, selection)
    if (!current.pending || current.pending.version !== version) return
    this.save(accountId, {
      ...current,
      selection,
      pending: { ...current.pending, commandId, status },
    })
  }

  failRequest(accountId: string, selection: SessionSelection, version: number): void {
    const current = this.read(accountId, selection)
    if (current.pending?.version !== version) return
    this.save(accountId, { ...current, selection, pending: null })
  }

  finish(
    accountId: string,
    selection: SessionSelection,
    commandId: string,
    succeeded: boolean,
  ): void {
    const current = this.read(accountId, selection)
    if (current.pending?.commandId !== commandId) return
    this.save(accountId, {
      ...current,
      selection,
      text: succeeded && current.version === current.pending.version ? "" : current.text,
      pending: null,
    })
  }

  status(
    accountId: string,
    selection: SessionSelection,
    commandId: string,
    status: "queued" | "sent" | "accepted" | "unknown",
  ): boolean {
    const current = this.read(accountId, selection)
    if (current.pending?.commandId !== commandId || current.pending.status === status) {
      return false
    }
    this.save(accountId, {
      ...current,
      selection,
      pending: { ...current.pending, status },
    })
    return true
  }

  pending(accountId: string): StoredDraft[] {
    return [...(this.accounts.get(accountId)?.values() ?? [])]
      .filter((draft) => draft.pending !== null)
  }

  clear(accountId: string): void {
    this.accounts.set(accountId, new Map())
    try {
      this.storage().removeItem(this.storageKey(accountId))
    } catch {
      this.onError("Signed out, but the draft cache could not be cleared. Close this tab to discard it.")
    }
  }

  private storageKey(accountId: string): string {
    return `${storagePrefix}${encodeURIComponent(accountId)}`
  }

  private save(accountId: string, draft: StoredDraft): void {
    let drafts = this.accounts.get(accountId)
    if (!drafts) {
      drafts = new Map()
      this.accounts.set(accountId, drafts)
    }
    const key = selectionKey(draft.selection)
    if (!draft.text && !draft.pending) drafts.delete(key)
    else drafts.set(key, draft)
    try {
      if (drafts.size) {
        this.storage().setItem(this.storageKey(accountId), JSON.stringify([...drafts.values()]))
      } else {
        this.storage().removeItem(this.storageKey(accountId))
      }
    } catch {
      this.onError("Drafts could not be cached. You can still edit here, but refreshing may lose your input.")
    }
  }
}
