import { useCallback, useEffect, useRef, useState } from "react"

export interface SessionViewPreferences {
  showEnded: boolean
  showUnavailable: boolean
  showOffline: boolean
  groupByDevice: boolean
}

const defaults: SessionViewPreferences = {
  showEnded: false,
  showUnavailable: false,
  showOffline: false,
  groupByDevice: false,
}

interface PreferenceSnapshot {
  preferences: SessionViewPreferences
  warning: string | null
}

export function sessionViewPreferencesKey(accountId: string): string {
  return `silvermoon:session-view-preferences:${encodeURIComponent(accountId)}`
}

function storageError(operation: "restore" | "save", error: unknown): string {
  const message = operation === "restore"
    ? "View preferences could not be restored. Using the default view; you can still change it here."
    : "View preferences could not be saved. You can still change this view, but refreshing may not keep your choices."
  console.error(JSON.stringify({
    event: "session-view-preferences-error",
    operation,
    message,
    error: error instanceof Error ? error.message : String(error),
  }))
  return message
}

export function loadSessionViewPreferences(
  storage: () => Storage,
  accountId: string,
): PreferenceSnapshot {
  try {
    const raw = storage().getItem(sessionViewPreferencesKey(accountId))
    if (raw === null) return { preferences: { ...defaults }, warning: null }
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== "object" || value === null || Array.isArray(value)
      || !("version" in value) || value.version !== 1
      || !("showEnded" in value) || typeof value.showEnded !== "boolean"
      || !("showUnavailable" in value) || typeof value.showUnavailable !== "boolean"
      || !("showOffline" in value) || typeof value.showOffline !== "boolean"
      || !("groupByDevice" in value) || typeof value.groupByDevice !== "boolean"
    ) throw new Error("Invalid session view preferences")
    return {
      preferences: {
        showEnded: value.showEnded,
        showUnavailable: value.showUnavailable,
        showOffline: value.showOffline,
        groupByDevice: value.groupByDevice,
      },
      warning: null,
    }
  } catch (error) {
    return { preferences: { ...defaults }, warning: storageError("restore", error) }
  }
}

export function saveSessionViewPreferences(
  storage: () => Storage,
  accountId: string,
  preferences: SessionViewPreferences,
): string | null {
  try {
    storage().setItem(sessionViewPreferencesKey(accountId), JSON.stringify({
      version: 1,
      ...preferences,
    }))
    return null
  } catch (error) {
    return storageError("save", error)
  }
}

interface AccountSnapshot extends PreferenceSnapshot {
  accountId: string | null
}

export function useSessionViewPreferences(accountId: string | null) {
  const [snapshot, setSnapshot] = useState<AccountSnapshot>({
    accountId: null, preferences: { ...defaults }, warning: null,
  })
  const current = useRef(snapshot)
  const commit = useCallback((next: AccountSnapshot) => {
    current.current = next
    setSnapshot(next)
  }, [])

  useEffect(() => {
    const restore = () => commit({
      accountId,
      ...(accountId
        ? loadSessionViewPreferences(() => window.localStorage, accountId)
        : { preferences: { ...defaults }, warning: null }),
    })
    // oxlint-disable-next-line react/set-state-in-effect -- Restore only the authenticated account's browser preferences.
    restore()
    if (!accountId) return
    const synchronize = (event: StorageEvent) => {
      if (event.key !== null && event.key !== sessionViewPreferencesKey(accountId)) return
      try {
        if (event.storageArea !== window.localStorage) return
      } catch (error) {
        commit({ accountId, preferences: { ...defaults }, warning: storageError("restore", error) })
        return
      }
      // Read the latest stored value rather than replaying a potentially superseded event.
      restore()
    }
    window.addEventListener("storage", synchronize)
    return () => window.removeEventListener("storage", synchronize)
  }, [accountId, commit])

  const update = useCallback((key: keyof SessionViewPreferences, value: boolean) => {
    if (!accountId) return
    const previous = current.current.accountId === accountId
      ? current.current
      : loadSessionViewPreferences(() => window.localStorage, accountId)
    const preferences = { ...previous.preferences, [key]: value }
    commit({
      accountId,
      preferences,
      warning: saveSessionViewPreferences(() => window.localStorage, accountId, preferences),
    })
  }, [accountId, commit])

  const dismissWarning = useCallback(() => {
    if (current.current.accountId === accountId) {
      commit({ ...current.current, warning: null })
    }
  }, [accountId, commit])

  return {
    preferences: snapshot.accountId === accountId ? snapshot.preferences : defaults,
    warning: snapshot.accountId === accountId ? snapshot.warning : null,
    update,
    dismissWarning,
  }
}
