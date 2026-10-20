import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, LogOut, Search, Settings } from "lucide-react"
import { messageIdSchema } from "@silvermoon-ai/sync-protocol/duplex"
import { api, LoginPage, RelayMark, type Account } from "@/App"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { acceptPage, emptyFeed, messagesEndpoint, parsePayload, prepareSend, readSaved, savePending, saveScope, scopeKey, type Feed, type Message, type PendingSend } from "./device-messages"
import "./streams.css"
import "./devices.css"

interface Device { id: string; displayName: string }
const errorText = (error: unknown) => error instanceof Error ? error.message : "Request failed"

export default function DevicesApp() {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).has("authError") ? "We couldn’t verify that sign-in. Try again or choose another provider." : null)
  const signedIn = useRef(false)
  const accountCheck = useRef<AbortController | null>(null)
  useEffect(() => {
    const check = () => {
      accountCheck.current?.abort()
      const controller = new AbortController()
      accountCheck.current = controller
      void api<Account>("/api/me", { signal: controller.signal }).then(next => {
        if (!controller.signal.aborted) { signedIn.current = true; setAccount(next); setError(null) }
      }).catch(e => {
        if (!controller.signal.aborted && errorText(e) !== "authentication-required") setError(errorText(e))
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }
    const expired = () => {
      if (!signedIn.current) return
      accountCheck.current?.abort(); signedIn.current = false; setAccount(null); setError("Your browser session expired or changed. Sign in again.")
    }
    check()
    window.addEventListener("focus", check)
    window.addEventListener("relay:authentication-required", expired)
    window.addEventListener("relay:account-changed", expired)
    const timer = setInterval(check, 30_000)
    return () => {
      accountCheck.current?.abort(); clearInterval(timer); window.removeEventListener("focus", check)
      window.removeEventListener("relay:authentication-required", expired); window.removeEventListener("relay:account-changed", expired)
    }
  }, [])
  if (!account) return <LoginPage loading={loading} error={error} />
  return <DeviceWorkspace key={`${account.user.id}:${account.sessionId}`} account={account} signOut={() => { accountCheck.current?.abort(); signedIn.current = false; setAccount(null) }} />
}

function useAccountApi(account: string) {
  return useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers)
    headers.set("x-account-id", account)
    try { return await api<T>(path, { ...init, headers }) }
    catch (error) {
      if (!init.signal?.aborted && errorText(error) === "account_changed") window.dispatchEvent(new Event("relay:account-changed"))
      throw error
    }
  }, [account])
}
type AccountApi = ReturnType<typeof useAccountApi>

function useMessageFeed(account: string, request: AccountApi, device?: string, enabled = true) {
  const [feed, setFeed] = useState<Feed>(emptyFeed)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [connected, setConnected] = useState(false)
  const scope = scopeKey(device)
  const [loadedScope, setLoadedScope] = useState(scope)
  const retained = useRef({ scope, feed: emptyFeed() })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let current = retained.current.scope === scope ? retained.current.feed : emptyFeed()
    const poll = async () => {
      try {
        // Device display changes must not leave uncancellable DO RPC polls occupying session slots.
        const wait = device === undefined && current.loaded ? 20000 : 0
        const page = await request<unknown>(`${messagesEndpoint(device)}?after=${current.next}&wait=${wait}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        const next = acceptPage(current, page, account, device)
        await saveScope(localStorage, account, scope, next)
        if (controller.signal.aborted) return
        const changed = next.next !== current.next
        current = next; retained.current = { scope, feed: next }; setFeed(next); setConnected(true); setError(null)
        timer = setTimeout(() => void poll(), changed ? 350 : 1000)
      } catch (e) {
        if (!controller.signal.aborted) { setConnected(false); setError(`${errorText(e)}. Loaded messages retained; retry uses the same read scope and cursor.`) }
      }
    }
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setConnected(false); setError(null); setFeed(current); setLoadedScope(scope)
      try {
        current = readSaved(localStorage, account).scopes[scope] ?? current
        retained.current = { scope, feed: current }; setFeed(current)
      }
      catch (e) { setError(`Local persistence failed: ${errorText(e)}. Saved cursor was not replaced.`); return }
      void poll()
    })
    return () => { controller.abort(); clearTimeout(timer) }
  }, [account, request, device, enabled, scope, attempt])
  return { feed: loadedScope === scope ? feed : emptyFeed(), error: loadedScope === scope ? error : null, connected: loadedScope === scope && connected, retry: () => setAttempt(n => n + 1) }
}

function DeviceWorkspace({ account, signOut }: { account: Account; signOut: () => void }) {
  const request = useAccountApi(account.user.id)
  const [devices, setDevices] = useState<Device[]>([])
  const devicesRef = useRef<Device[]>([])
  const [nextDevice, setNextDevice] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | undefined>(() => new URLSearchParams(location.search).get("device") ?? undefined)
  const [mobileDetail, setMobileDetail] = useState(() => new URLSearchParams(location.search).has("device"))
  const [search, setSearch] = useState("")
  const rail = useRef<HTMLElement>(null)
  const listController = useRef<AbortController | null>(null)
  const accountFeed = useMessageFeed(account.user.id, request)
  const deviceFeed = useMessageFeed(account.user.id, request, selection, selection !== undefined)
  const active = selection === undefined ? accountFeed : deviceFeed
  const selected = devices.find(device => device.id === selection)
  const loadDevices = useCallback(async (after?: string) => {
    if (listController.current) return
    const controller = new AbortController()
    listController.current = controller; setListLoading(true)
    try {
      const loaded: Device[] = []
      const through = after ? null : devicesRef.current.at(-1)?.id
      const budget = after ? 1 : Math.ceil(devicesRef.current.length / 32) + 2
      let cursor = after
      let next: string | null = null
      for (let i = 0; i < budget; i++) {
        const page = await request<{ devices: Device[]; next: string | null }>(`/api/v2/devices${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        let previous = cursor ?? ""
        if (!Array.isArray(page.devices) || page.devices.length > 32 || (page.next !== null && (typeof page.next !== "string" || page.next <= previous))) throw new Error("Invalid Device inventory")
        for (const d of page.devices) {
          if (typeof d.id !== "string" || typeof d.displayName !== "string" || d.id <= previous) throw new Error("Invalid Device inventory order")
          previous = d.id
        }
        loaded.push(...page.devices); next = page.next
        if (!next || !through || previous >= through) break
        if (i === budget - 1) throw new Error("Inventory changed beyond refresh budget; loaded entries retained")
        cursor = next
      }
      const nextDevices = after ? [...devicesRef.current, ...loaded] : loaded
      if (nextDevices.length > 1024) throw new Error("Inventory refresh exceeds the 1024 Device display limit")
      devicesRef.current = nextDevices
      setDevices(devicesRef.current)
      setNextDevice(next); setListError(null)
    } catch (e) { if (!controller.signal.aborted) setListError(errorText(e)) }
    finally { if (listController.current === controller) { listController.current = null; setListLoading(false) } }
  }, [request])
  useEffect(() => {
    void loadDevices()
    return () => { listController.current?.abort(); listController.current = null }
  }, [loadDevices])
  useEffect(() => {
    const back = () => {
      const device = new URLSearchParams(location.search).get("device") ?? undefined
      setSelection(device); setMobileDetail(device !== undefined)
    }
    window.addEventListener("popstate", back)
    return () => window.removeEventListener("popstate", back)
  }, [])
  const choose = (device?: string) => {
    setSelection(device); setMobileDetail(true)
    history.pushState({}, "", device === undefined ? "/" : `/?device=${encodeURIComponent(device)}`)
  }
  const name = account.user.displayName ?? account.identities[0]?.email ?? "Account"
  const title = selected?.displayName ?? (selection ? "Device unavailable" : "All devices")
  const [logoutError, setLogoutError] = useState<string | null>(null)
  return <main className={`relay-app stream-app devices-app mobile-view-${mobileDetail ? "session" : "list"}`}>
    <header className="relay-brand"><RelayMark /><div className="brand-lockup"><strong>Silvermoon</strong><span>Relay</span></div></header>
    <header className="session-topbar">
      <div className="mobile-topbar-context">{mobileDetail && <button className="mobile-back-button" aria-label="Back to Devices" onClick={() => {
        setMobileDetail(false); requestAnimationFrame(() => rail.current?.querySelector<HTMLButtonElement>("[aria-current='page']")?.focus())
      }}><ArrowLeft /></button>}<RelayMark compact /><h1>{mobileDetail ? title : "Devices"}</h1></div>
      <div className="desktop-session-context"><div className="session-heading-copy"><h1>{title}</h1><span>{selection ? "Both directions · v2 status: Unknown" : "Account uplink · all Devices"}</span></div></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="account-trigger" aria-label={`Account menu for ${name}`}><span className="account-avatar">{name.slice(0, 2).toUpperCase()}</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="account-menu"><DropdownMenuLabel>{name}</DropdownMenuLabel><DropdownMenuSeparator />
          <DropdownMenuItem asChild><a href="/settings"><Settings />Settings</a></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void api("/api/logout", { method: "POST" }).then(signOut).catch(e => setLogoutError(errorText(e)))}><LogOut />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <aside className="session-rail" aria-label="Devices" ref={rail}>
      <div className="session-rail-heading"><div><h2>Devices</h2><p>Account messages</p></div><Button variant="ghost" disabled={listLoading} onClick={() => void loadDevices()}>Refresh</Button></div>
      <div className="session-rail-tools"><label className="stream-search"><Search aria-hidden="true" /><Input aria-label="Search Devices" placeholder="Search Devices" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      <div className="session-list">
        {new URLSearchParams(location.search).has("session") && <p>Legacy Session links are not Device messages. <a href={`/legacy${location.search}`}>Open retained Session history</a></p>}
        <button className="device-choice" aria-current={selection === undefined ? "page" : undefined} onClick={() => choose()}><strong>All devices</strong><span>All account uplink messages</span></button>
        {devices.filter(d => `${d.displayName} ${d.id}`.toLowerCase().includes(search.toLowerCase())).map(device =>
          <button key={device.id} className="device-choice" aria-current={selection === device.id ? "page" : undefined} onClick={() => choose(device.id)}><strong>{device.displayName}</strong><span>v2 status: Unknown</span></button>)}
        {listLoading && <p role="status">Loading Devices…</p>}
        {listError && <p role="alert">Device inventory failed; loaded entries retained: {listError} <button onClick={() => void loadDevices()}>Retry inventory</button></p>}
        {!listLoading && !listError && !devices.length && <p>No Devices yet. Add a device in Settings.</p>}
        {nextDevice && <Button disabled={listLoading || devices.length >= 1024} onClick={() => void loadDevices(nextDevice)}>More Devices</Button>}
        {devices.length >= 1024 && <p>Device inventory display limit reached (1024).</p>}
      </div>
      <nav className="session-rail-footer" aria-label="Compatibility"><a href="/history">v1 Stream history</a><a href="/settings">Settings</a></nav>
    </aside>
    <section className="session-workspace device-workspace" aria-label="Device workspace">
      {logoutError && <p role="alert">{logoutError}</p>}
      <header className="device-scope"><h2>{title}</h2><p>{selection ? "Device → Client and Client → Device · v2 status: Unknown" : "All account uplink messages. Choose a Device to send."}</p>
        <p className="stream-range">Account reception: {accountFeed.connected ? "receiving all Devices" : accountFeed.error ? "interrupted" : "connecting"} · selecting or searching Devices only changes the display.</p>
        {accountFeed.error && selection && <p role="alert">Account reception: {accountFeed.error} <button onClick={accountFeed.retry}>Retry account reception</button></p>}
        {selection && !selected && <p role="alert">Device is unavailable or not in the loaded inventory. No other target has been substituted.</p>}
      </header>
      <MessageHistory key={selection ?? "account"} account={account.user.id} request={request} device={selection} feed={active.feed} error={active.error} retry={active.retry} />
      <Composer account={account.user.id} request={request} device={selected} />
    </section>
  </main>
}

function MessageHistory({ account, request, device, feed, error, retry }: { account: string; request: AccountApi; device?: string; feed: Feed; error: string | null; retry: () => void }) {
  const [historyPage, setHistoryPage] = useState<Feed | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState("0")
  const [detail, setDetail] = useState<Message | null>(null)
  const controller = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  useEffect(() => () => controller.current?.abort(), [])
  const readHistory = async (after: string) => {
    if (controller.current) return
    if (!messageIdSchema.safeParse(after).success) { setHistoryError("Invalid Message ID"); return }
    const pending = new AbortController()
    controller.current = pending; setBusy(true)
    try {
      const page = await request<unknown>(`${messagesEndpoint(device)}?after=${after}`, { signal: pending.signal })
      if (pending.signal.aborted) return
      setHistoryPage(acceptPage({ ...emptyFeed(), next: after }, page, account, device)); setOffset(0); setHistoryError(null)
    } catch (e) { if (!pending.signal.aborted) setHistoryError(`${errorText(e)}. Loaded history retained.`) }
    finally { if (controller.current === pending) { controller.current = null; setBusy(false) } }
  }
  const displayed = historyPage ?? feed
  const rows = displayed.messages.slice(offset, offset + 32)
  return <section className="device-history" aria-label="Messages">
    <div className="stream-controls">
      <Button variant="outline" disabled={busy} onClick={() => void readHistory("0")}>History from start</Button>
      {historyPage && <><Button variant="outline" disabled={busy} onClick={() => void readHistory(historyPage.next)}>Next history page</Button><Button variant="outline" onClick={() => { setHistoryPage(null); setOffset(0); setHistoryError(null) }}>Live messages</Button></>}
      <form onSubmit={e => { e.preventDefault(); void readHistory(cursor === "0" ? "0" : messageIdSchema.safeParse(cursor).success ? (BigInt(cursor) - 1n).toString() : cursor) }}><Input aria-label="Locate Message ID" value={cursor} onChange={e => setCursor(e.target.value)} /><Button variant="outline" disabled={busy}>Locate</Button></form>
    </div>
    <p className="stream-window-status">{historyPage ? "History" : "Live"} · {displayed.messages.length} cached · read through #{displayed.next} · Message IDs are Account-scoped, not v1 sequences.</p>
    {error && <p role="alert">{error} <button onClick={retry}>Retry messages</button></p>}
    {historyError && <p role="alert">{historyError}</p>}
    {!displayed.loaded && !error && <p role="status">Loading messages…</p>}
    {displayed.loaded && !displayed.messages.length && <p className="device-empty">No messages yet. Empty history is not a connection failure.</p>}
    <div ref={list} className="device-message-list" tabIndex={0} aria-label="Message list" onKeyDown={e => {
      if (e.target !== e.currentTarget) return
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); setOffset(e.key === "Home" ? 0 : Math.max(0, displayed.messages.length - 32)) }
    }}>
      {rows.map(message => <article className={`device-message ${message.is_upstream ? "is-upstream" : "is-downstream"}`} key={message.id}>
        <header><strong>{message.is_upstream ? "↑ Device → Client" : "↓ Client → Device"}</strong><span>#{message.id}</span></header>
        {device === undefined && <span className="message-source">Device: {message.device_id}</span>}
        <pre>{JSON.stringify(message.payload)}</pre>
        <button onClick={() => setDetail(message)} aria-label={`View Message ${message.id}`}>Raw detail</button>
      </article>)}
    </div>
    {displayed.messages.length > 32 && <div className="stream-controls"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 32))}>Earlier cached messages</Button><Button variant="outline" disabled={offset + 32 >= displayed.messages.length} onClick={() => setOffset(n => n + 32)}>Later cached messages</Button></div>}
    {detail && <section className="event-detail" aria-label={`Raw Message ${detail.id}`}><h3>Message #{detail.id} · {detail.is_upstream ? "Device → Client" : "Client → Device"}</h3><pre>{JSON.stringify(detail, null, 2)}</pre><Button variant="outline" onClick={() => { setDetail(null); list.current?.focus() }}>Close raw detail</Button></section>}
  </section>
}

function Composer({ account, request, device }: { account: string; request: AccountApi; device?: Device }) {
  const [enabled, setEnabled] = useState(false)
  const [grantBusy, setGrantBusy] = useState(false)
  const [text, setText] = useState("")
  const [restored] = useState(() => {
    try { return { pending: readSaved(localStorage, account).pending, error: null } }
    catch (e) { return { pending: null, error: `Local persistence failed: ${errorText(e)}. Sending is blocked; saved requests have not been replaced.` } }
  })
  const [pending, setPending] = useState<PendingSend | null>(restored.pending)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const persistenceError = restored.error
  const controller = useRef(new AbortController())
  const submitting = useRef(false)
  const granting = useRef(false)
  useEffect(() => {
    const active = new AbortController()
    controller.current = active
    return () => active.abort()
  }, [account])
  const grant = async () => {
    if (granting.current) return
    granting.current = true; setGrantBusy(true)
    try {
      const result = await request<{ enabled: boolean }>("/api/v2/account/write-access", { method: "POST", signal: controller.current.signal, body: JSON.stringify({ enabled: !enabled }) })
      if (!controller.current.signal.aborted) { setEnabled(result.enabled); setError(null) }
    } catch (e) { if (!controller.current.signal.aborted) setError(errorText(e)) }
    finally { granting.current = false; if (!controller.current.signal.aborted) setGrantBusy(false) }
  }
  const submit = async () => {
    if (submitting.current || persistenceError) return
    submitting.current = true; setBusy(true); setError(null)
    let intent: PendingSend
    let posted = false
    try {
      if (pending?.accepted) throw new Error("Start a new request explicitly")
      if (pending) {
        if (!enabled || device?.id !== pending.device) throw new Error("Enable sending and select the original Device to retry")
        intent = pending
      } else intent = prepareSend(device?.id, text, enabled)
      const saved = await savePending(localStorage, account, intent)
      if (controller.current.signal.aborted) return
      setPending(saved)
      if (!saved || saved.accepted) return
      posted = true
      const result = await request<{ status: string; id: string }>(`/api/v2/devices/${encodeURIComponent(intent.device)}/regulations`, {
        method: "POST", signal: controller.current.signal, body: JSON.stringify(intent.submission),
      })
      if (controller.current.signal.aborted) return
      if (result.status !== "accepted" || !messageIdSchema.safeParse(result.id).success) throw new Error("Invalid acceptance response")
      const accepted = { ...intent, accepted: result.id }
      const persisted = await savePending(localStorage, account, accepted)
      if (!controller.current.signal.aborted) setPending(persisted)
    } catch (e) {
      if (!controller.current.signal.aborted) {
        setError(posted ? `Result unknown or rejected: ${errorText(e)}. Check Device history or explicitly retry the SAME request. Target, payload and key retained.` : `Not sent: ${errorText(e)}`)
        if (errorText(e) === "write_permission_required" || errorText(e) === "forbidden") setEnabled(false)
      }
    } finally { submitting.current = false; if (!controller.current.signal.aborted) setBusy(false) }
  }
  const newRequest = async () => {
    if (submitting.current || !pending?.accepted) return
    submitting.current = true; setBusy(true)
    try {
      await savePending(localStorage, account, null, pending.submission.key)
      if (!controller.current.signal.aborted) { setPending(null); setText(""); setError(null) }
    } catch (e) { if (!controller.current.signal.aborted) setError(`Local persistence failed: ${errorText(e)}. Accepted request retained.`) }
    finally { submitting.current = false; if (!controller.current.signal.aborted) setBusy(false) }
  }
  let valid = false
  try { parsePayload(text); valid = true } catch { valid = false }
  return <section className="device-composer" aria-label="Send regulation">
    <h3>{device ? `Send to ${device.displayName} · this Device only` : "Choose a Device to send"}</h3>
    <p>Relay acceptance is not Device receipt or execution. Reading and sending never acknowledge Device consumption.</p>
    <Button variant="outline" disabled={grantBusy || busy} onClick={() => void grant()}>{enabled ? "Disable sending for this session" : "Enable sending for this session"}</Button>
    <p className="stream-range">{enabled ? "Current session sending enabled" : "Receive-only · sending not enabled"}</p>
    {persistenceError && <p role="alert">{persistenceError}</p>}
    {error && <p role="alert">{error}</p>}
    {pending ? <div className="pending-send">
      <p>Immutable target: <strong>{pending.device}</strong> · Request key: <code>{pending.submission.key}</code></p>
      <pre>{JSON.stringify(pending.submission.payload, null, 2)}</pre>
      {pending.accepted ? <><p role="status">Relay accepted #{pending.accepted} · Device receipt and execution unconfirmed.</p><Button variant="outline" disabled={busy} onClick={() => void newRequest()}>New request</Button></> : <><p role="status">{busy ? "Submitting once…" : "Result unknown. No automatic resend. Check history or retry the SAME request."}</p><Button disabled={busy || !enabled || device?.id !== pending.device || !!persistenceError} onClick={() => void submit()}>Retry SAME request</Button></>}
    </div> : <><label className="payload-label" htmlFor="regulation-payload">JSON payload (maximum 16 KiB)</label><textarea id="regulation-payload" value={text} maxLength={32768} onChange={e => setText(e.target.value)} placeholder={'{"text":"hello device"}'} />
      <div className="stream-controls"><span>{valid ? "Valid JSON" : "Enter valid, bounded JSON"}</span><Button disabled={busy || !device || !enabled || !valid || !!persistenceError} onClick={() => void submit()}>Send to {device?.displayName ?? "Device"}</Button></div></>}
  </section>
}
