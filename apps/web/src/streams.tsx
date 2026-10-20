import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, ChevronRight, LogOut, Search, Settings } from "lucide-react"
import { LIMITS, parseClientMessage, seqSchema, serverMessageSchema, type EventRecord } from "@silvermoon-ai/sync-protocol"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, LoginPage, RelayMark, type Account } from "@/App"
import { assertPage, before, compareSeq, EventWindow, virtualRows, WINDOW_LIMITS } from "@/stream-window"
import { builtinStreamViews, StreamViewBoundary, type StreamDescriptor, type StreamViewRegistry } from "@/stream-views"
import { useStreamInventory, type StreamDevice as Device } from "@/stream-inventory"
import "./streams.css"

const relayOrigin = import.meta.env.VITE_RELAY_ORIGIN ?? "https://relay.silvermoon.work"
interface Page { events: EventRecord[]; next: string; committedThrough: string; after?: string }
interface Selection { device: Device; stream: StreamDescriptor }
const errorText = (error: unknown) => error instanceof Error ? error.message : "Request failed"
const endpoint = (device: string) => `/api/stream-connectors/${encodeURIComponent(device)}`

export default function StreamsApp() {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(() => new URLSearchParams(window.location.search).has("authError") ? "We couldn’t verify that sign-in. Try again or choose another provider." : null)
  const inventory = useStreamInventory(!!account)
  const { devices, nextDevice, streams, loading: listLoading, error: listError } = inventory
  const [selection, setSelection] = useState<Selection | null>(null)
  const [search, setSearch] = useState("")
  const [mobileDetail, setMobileDetail] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const epoch = useRef(0)
  const signedIn = useRef(false)
  const selectedIdentity = useRef("")
  const rail = useRef<HTMLElement>(null)
  const legacyQuery = new URLSearchParams(window.location.search)
  useEffect(() => {
    let active = true
    void api<Account>("/api/me").then(account => {
      if (active) { signedIn.current = true; setError(null); setAccount(account) }
    }).catch(error => { if (active && errorText(error) !== "authentication-required") setError(errorText(error)) })
      .finally(() => { if (active) setLoading(false) })
    const expired = () => {
      if (!signedIn.current) return
      signedIn.current = false
      epoch.current++
      setAccount(null); setSelection(null)
      setError("Your browser session expired. Sign in again.")
    }
    window.addEventListener("relay:authentication-required", expired)
    return () => { active = false; epoch.current++; window.removeEventListener("relay:authentication-required", expired) }
  }, [])
  const choose = (device: Device, stream: StreamDescriptor) => {
    selectedIdentity.current = JSON.stringify([device.id, stream.streamId])
    setSelection({ device, stream }); setMobileDetail(true)
    const url = new URL(window.location.href)
    url.search = new URLSearchParams({ device: device.id, stream: stream.streamId }).toString()
    window.history.pushState({}, "", url)
  }
  // Stream links are resolved by both device and stream, never by a legacy Session id.
  useEffect(() => {
    const resolve = () => {
      const params = new URLSearchParams(window.location.search)
      const device = devices.find(d => d.id === params.get("device"))
      const stream = device && streams[device.id]?.streams.find(s => s.streamId === params.get("stream"))
      if (device && stream) {
        const identity = JSON.stringify([device.id, stream.streamId])
        if (selectedIdentity.current !== identity) setMobileDetail(true)
        selectedIdentity.current = identity
        setSelection({ device, stream })
      }
      else if (!params.has("stream")) { setSelection(null); setMobileDetail(false) }
      else { setSelection(null); setMobileDetail(true) }
    }
    resolve()
    window.addEventListener("popstate", resolve)
    return () => window.removeEventListener("popstate", resolve)
  }, [devices, streams])
  useLayoutEffect(() => {
    rail.current?.querySelector<HTMLElement>(".session-item-select[aria-current='page']")?.scrollIntoView({ block: "nearest" })
  }, [selection?.device.id, selection?.stream.streamId])
  if (!account) return <LoginPage loading={loading} error={error === "authentication-required" ? null : error} returnTo={new URLSearchParams(window.location.search).has("stream") ? `${window.location.pathname}${window.location.search}` : undefined} />
  const accountName = account.user.displayName ?? account.identities[0]?.email ?? "Account"
  const selectedKey = selection ? JSON.stringify([selection.device.id, selection.stream.streamId]) : ""
  const params = new URLSearchParams(window.location.search)
  return <main className={`relay-app stream-app mobile-view-${mobileDetail ? "session" : "list"}`}>
    <header className="relay-brand"><RelayMark /><div className="brand-lockup"><strong>Silvermoon</strong><span>Relay</span></div></header>
    <header className="session-topbar">
      <div className="mobile-topbar-context">
        {mobileDetail && <button className="mobile-back-button" aria-label="Back to Streams" onClick={() => setMobileDetail(false)}><ArrowLeft /></button>}
        <RelayMark compact /><h1>{mobileDetail ? selection?.stream.streamId ?? "Stream unavailable" : "Streams"}</h1>
      </div>
      <div className="desktop-session-context"><div className="session-heading-copy"><h1>{selection?.stream.streamId ?? "Select a Stream"}</h1><span>{selection ? `${selection.device.displayName} · read-only events` : "Connector event history"}</span></div></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="account-trigger" aria-label={`Account menu for ${accountName}`}><span className="account-avatar">{account.user.avatarUrl ? <img src={account.user.avatarUrl} alt="" /> : accountName.slice(0, 2).toUpperCase()}</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="account-menu"><DropdownMenuLabel>{accountName}</DropdownMenuLabel><DropdownMenuSeparator />
          <DropdownMenuItem asChild><a href="/settings"><Settings />Settings</a></DropdownMenuItem>
          <DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { void api("/api/logout", { method: "POST" }).then(() => { signedIn.current = false; epoch.current++; setAccount(null); setSelection(null) }).catch(e => setError(errorText(e))) }}><LogOut />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <aside className="session-rail" aria-label="Streams" ref={rail}>
      <div className="session-rail-heading"><div><h2>Streams</h2><p>Read-only Connector logs</p></div><Button variant="ghost" disabled={listLoading} onClick={() => void inventory.refresh()}>Refresh</Button></div>
      <div className="session-rail-tools"><label className="stream-search"><Search aria-hidden="true" /><Input aria-label="Search Streams" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Streams" /></label></div>
      {legacyQuery.has("session") && <p role="status">Legacy Session links are not Stream identities. <a href={`/legacy${window.location.search}`}>Open retained Session history</a></p>}
      <div className="session-list">
        {listLoading && <p role="status">Loading Connectors…</p>}
        {listError && <p role="alert">Could not refresh Streams; loaded inventory retained: {listError} <button onClick={() => void inventory.refresh()}>Retry</button></p>}
        {!listLoading && !listError && !devices.length && <p>No Connectors yet. Add a device in Settings.</p>}
        {devices.map(device => <section className="session-device-group" key={device.id}>
          <h3><button className="session-device-heading" aria-expanded={!collapsed.has(device.id)} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(device.id)) next.delete(device.id); else next.add(device.id); return next })}>
            {collapsed.has(device.id) ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            <strong>{device.displayName}</strong><span>{streams[device.id]?.streams.length ?? 0}</span><span className="session-device-alerts" />
            <span className="session-device-status" data-status={device.status}>{device.status === "online" ? "Sync online" : "Offline · history available"}</span>
          </button></h3>
          <div hidden={collapsed.has(device.id)}>
          {!streams[device.id] ? <p>Loading Streams…</p> : !streams[device.id].streams.length ? <p>No Streams produced yet.</p> : streams[device.id].streams.filter(s => `${s.streamId} ${s.contentType ?? ""} ${device.displayName}`.toLowerCase().includes(search.toLowerCase())).map(stream =>
            <div className={`session-list-item ${selection?.device.id === device.id && selection.stream.streamId === stream.streamId ? "is-selected" : ""}`} key={stream.streamId}>
              <span className="session-tree-control"><span className="session-state-dot" data-status={device.status === "online" ? "idle" : "offline"} aria-hidden="true" /></span>
              <button className="session-item-select" aria-current={selection?.device.id === device.id && selection.stream.streamId === stream.streamId ? "page" : undefined} onClick={() => choose(device, stream)}>
                <span className="session-item-main"><span className="session-item-title-line"><span className="session-item-title">{stream.streamId}</span></span><span className="session-item-meta">{stream.contentType ?? "Opaque text"}</span><span className="session-item-preview">Through #{stream.committedThrough}</span></span>
              </button>
            </div>)}
          {streams[device.id]?.next && <Button variant="ghost" disabled={listLoading} onClick={() => void inventory.moreStreams(device.id)}>More Streams</Button>}
          </div>
        </section>)}
        {nextDevice && <Button disabled={listLoading} onClick={() => void inventory.moreDevices()}>More Connectors</Button>}
      </div>
      <div className="session-rail-footer"><a href="/">Devices workspace</a><a href="/settings#devices">Settings</a></div>
    </aside>
    <section className="session-workspace stream-workspace" aria-label="Stream workspace">
      {error && <p role="alert">{error}</p>}
      {listError && mobileDetail && <p role="alert">Inventory refresh failed; loaded metadata may be stale: {listError}</p>}
      {selection ? <StreamEvents key={selectedKey} selection={selection} /> : <div className="workspace-empty"><RelayMark /><h2>Select a Stream</h2><p>Browse immutable event history, including offline Connectors.</p>{params.has("stream") && <p role="alert">Stream link unavailable. Choose its Connector and Stream from the list; no other stream has been substituted.</p>}</div>}
    </section>
  </main>
}

export function StreamEvents({ selection, registry = builtinStreamViews }: { selection: Selection; registry?: StreamViewRegistry }) {
  const { device, stream } = selection
  const cache = useRef(new EventWindow())
  const [events, setEvents] = useState<EventRecord[]>([])
  const [bytes, setBytes] = useState(0)
  const [head, setHead] = useState(stream.committedThrough)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [connection, setConnection] = useState("Paused · history")
  const [attempt, setAttempt] = useState(0)
  const [locate, setLocate] = useState("")
  const [detail, setDetail] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<string | null>(null)
  const [windowNotice, setWindowNotice] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [viewport, setViewport] = useState({ top: 0, height: 500 })
  const scroll = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const cursor = useRef("0")
  const generation = useRef(0)
  const request = useRef(0)
  const live = useRef(false)
  const anchor = useRef<{ seq: string; offset: number } | null>(null)
  const tail = useRef(false)
  const focusSeq = useRef<string | null>(null)
  const restoreFocus = useRef(false)
  const publishWindow = useCallback(() => {
    if (focusSeq.current && !cache.current.get(focusSeq.current)) {
      restoreFocus.current = true
      focusSeq.current = null
      setFocused(null)
    }
    const values = cache.current.values()
    cursor.current = values.at(-1)?.seq ?? "0"
    setEvents(values); setBytes(cache.current.bytes)
  }, [])
  const readAfter = useCallback(async (after: string, replace = false, direction: "forward" | "backward" | "latest" = "forward") => {
    const id = ++request.current
    const epoch = generation.current
    setLoading(true); setError(null)
    try {
      if (!seqSchema.safeParse(after).success) throw new Error("Invalid decimal cursor")
      const backwards = direction === "backward"
      const latest = direction === "latest"
      const page = await api<Page>(`${endpoint(device.id)}/events?${new URLSearchParams({ streamId: stream.streamId, [latest ? "tail" : backwards ? "before" : "after"]: latest ? "1" : after })}`)
      if (epoch !== generation.current || id !== request.current) return
      const start = backwards || latest ? page.after : after
      if (start === undefined) throw new Error("Previous page did not include its exact boundary")
      assertPage(page.events, start, backwards ? before(after) : page.committedThrough)
      if (backwards && page.events.at(-1)?.seq !== before(after)) throw new Error("History gap immediately before the loaded window")
      if (latest && page.committedThrough !== "0" && page.events.at(-1)?.seq !== page.committedThrough) throw new Error("History gap at the committed head")
      if (replace) { cache.current = new EventWindow(); setDetail(null); anchor.current = null; if (scroll.current) scroll.current.scrollTop = 0 }
      else {
        const index = Math.floor((scroll.current?.scrollTop ?? 0) / WINDOW_LIMITS.rowHeight)
        const seq = cache.current.values()[index]?.seq
        if (seq) anchor.current = { seq, offset: (scroll.current?.scrollTop ?? 0) % WINDOW_LIMITS.rowHeight }
      }
      const result = cache.current.add(page.events, backwards ? "backward" : "forward")
      setWindowNotice(result.reset ? "Disjoint history page: the data window was reset, not merged across an unread gap." : null)
      if (result.reset) { anchor.current = null; if (scroll.current) scroll.current.scrollTop = 0 }
      publishWindow()
      if (!page.events.length && replace) cursor.current = after
      setHead(page.committedThrough)
    } catch (error) { if (epoch === generation.current && id === request.current) setError(errorText(error)) }
    finally { if (epoch === generation.current && id === request.current) setLoading(false) }
  }, [device.id, stream.streamId, publishWindow])
  useEffect(() => {
    heading.current?.focus()
    let active = true
    queueMicrotask(() => {
      if (!active) return
      const seq = new URLSearchParams(window.location.search).get("seq")
      if (seq !== null && !seqSchema.safeParse(seq).success) { setError("Invalid decimal sequence in Stream link"); return }
      if (seq !== null) setLocate(seq)
      void readAfter(seq === null || seq === "0" ? "0" : before(seq), true)
    })
    return () => { active = false; generation.current++; request.current++ }
  }, [readAfter])
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    if (tail.current) { element.scrollTop = element.scrollHeight; tail.current = false }
    else if (anchor.current) {
      const index = events.findIndex(e => e.seq === anchor.current!.seq)
      if (index >= 0) element.scrollTop = index * WINDOW_LIMITS.rowHeight + anchor.current.offset
      anchor.current = null
    }
    if (detail && !cache.current.get(detail)) setDetail(null)
    if (restoreFocus.current) { restoreFocus.current = false; element.focus({ preventScroll: true }); setWindowNotice("The focused event left the bounded cache. Focus returned to the event table.") }
    setViewport({ top: element.scrollTop, height: element.clientHeight })
  }, [events, detail])
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport({ top: element.scrollTop, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!following) { live.current = false; return }
    let active = true
    live.current = true
    let timer: ReturnType<typeof setTimeout>
    let ping: ReturnType<typeof setInterval>
    let ack: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket
    let counter = 0
    const send = (message: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(parseClientMessage(JSON.stringify({ ...message, requestId: `web-${++counter}` }))))
    }
    const connect = () => {
      if (!active) return
      setConnection("Connecting…")
      const url = new URL(`${relayOrigin}${endpoint(device.id)}/subscribe`)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(url)
      ws.onopen = () => { send({ type: "hello", version: 1, role: "reader" }) }
      ws.onmessage = event => {
        if (!active || !live.current) return
        try {
          const message = serverMessageSchema.parse(JSON.parse(String(event.data)))
          if (message.type === "welcome") {
            setError(null)
            setConnection("Following")
            send({ type: "stream.subscribe", streamId: stream.streamId, after: cursor.current, subscriptionId: "events" })
            ping = setInterval(() => send({ type: "ping" }), LIMITS.leaseMs / 3)
          } else if (message.type === "subscription.events") {
            if (message.streamId !== stream.streamId || message.subscriptionId !== "events") throw new Error("Unexpected subscription identity")
            assertPage(message.events, cursor.current, message.caughtUpThrough)
            cache.current.add(message.events)
            cursor.current = message.events.at(-1)?.seq ?? cursor.current
            setHead(message.caughtUpThrough); tail.current = true; publishWindow()
            // Coalesce a whole delivery window and stay below the server request quota.
            if (!ack) ack = setTimeout(() => {
              ack = undefined
              if (active && live.current) send({ type: "subscription.ack", subscriptionId: "events", through: cursor.current })
            }, 250)
          } else if (message.type === "error") {
            if (message.code === "unauthorized") {
              window.dispatchEvent(new Event("relay:authentication-required"))
              active = false
            }
            if (message.retryable) {
              setError(`${message.code}: ${message.message}; reconnecting from ${cursor.current}`)
              ws.close(1000, "resume processed position")
              return
            }
            throw new Error(`${message.code}: ${message.message}`)
          }
        } catch (error) {
          setError(errorText(error)); live.current = false; setFollowing(false); ws.close()
        }
      }
      ws.onerror = () => {
        if (!active) return
        setConnection("Connection failed · retrying from last processed sequence")
        void api(`${endpoint(device.id)}/streams`).catch(error => {
          if (active && ["authentication-required", "device-not-found"].includes(errorText(error))) {
            active = false; live.current = false; setError(errorText(error)); setFollowing(false); ws.close()
          }
        })
      }
      ws.onclose = () => {
        clearInterval(ping)
        clearTimeout(ack); ack = undefined
        if (active && live.current) {
          setConnection("Disconnected · reconnecting from last processed sequence")
          timer = setTimeout(connect, 1500)
        }
      }
    }
    connect()
    return () => { active = false; live.current = false; clearTimeout(timer); clearTimeout(ack); clearInterval(ping); ws?.close() }
  }, [following, device.id, stream.streamId, attempt, publishWindow])
  const pause = () => { live.current = false; setFollowing(false) }
  const load = (after: string, replace = false, direction: "forward" | "backward" | "latest" = "forward") => {
    pause(); void readAfter(after, replace, direction)
  }
  const copy = async (event: EventRecord) => {
    try { await navigator.clipboard.writeText(event.payload); setCopyState(`Copied event ${event.seq}`) }
    catch { setCopyState(`Copy failed for event ${event.seq}. Open raw detail and select the text.`) }
  }
  const builtin = stream.contentType ? registry.get(stream.contentType) : undefined
  const View = builtin?.component
  const range = virtualRows(events.length, viewport.top, viewport.height)
  const indexes = Array.from({ length: range.end - range.start }, (_, i) => range.start + i)
  const focusedIndex = focused ? events.findIndex(event => event.seq === focused) : -1
  if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) {
    if (indexes.length === WINDOW_LIMITS.rows) indexes.pop()
    indexes.push(focusedIndex)
    indexes.sort((a, b) => a - b)
  }
  const selected = detail ? events.find(event => event.seq === detail) : undefined
  const knownHead = compareSeq(head, stream.committedThrough) > 0 ? head : stream.committedThrough
  let formatted = selected?.payload ?? ""
  if (selected) { try { formatted = JSON.stringify(JSON.parse(selected.payload), null, 2) } catch { /* Opaque payload stays text. */ } }
  return <div className="stream-events" data-cache-records={events.length} data-cache-bytes={bytes}>
    <h2 ref={heading} tabIndex={-1}>{stream.streamId}</h2>
    <p className="stream-range">{device.displayName} · {device.status === "online" ? "Sync online" : "Offline history"} · committed through #{knownHead} · {following ? connection : "Paused · history"}</p>
    <div className="stream-controls">
      <Button variant="outline" disabled={loading} onClick={() => { if (following) pause(); else { setError(null); setFollowing(true); setAttempt(n => n + 1) } }}>{following ? "Pause" : "Follow from position"}</Button>
      <Button variant="outline" disabled={loading} onClick={() => load("0", true, "latest")}>Latest history</Button>
      <Button variant="outline" disabled={loading || !events.length || events[0]!.seq === "1"} onClick={() => load(events[0]!.seq, false, "backward")}>Previous page</Button>
      <Button variant="outline" disabled={loading || (events.length > 0 && compareSeq(events.at(-1)!.seq, knownHead) >= 0)} onClick={() => load(events.at(-1)?.seq ?? "0")}>Next page</Button>
      <form onSubmit={e => { e.preventDefault(); try { load(before(locate), true); heading.current?.focus() } catch (error) { setError(errorText(error)) } }}>
        <Input aria-label="Locate sequence" inputMode="numeric" value={locate} onChange={e => setLocate(e.target.value)} placeholder="Sequence" /><Button variant="outline" disabled={loading}>Locate</Button>
      </form>
    </div>
    <div className="stream-view-choice"><Button variant="ghost" aria-pressed={!custom} onClick={() => setCustom(false)}>Raw events</Button>{builtin && <Button variant="ghost" aria-pressed={custom} onClick={() => setCustom(true)}>{builtin.label}</Button>}
      <span>{builtin ? stream.contentType : `No built-in view for ${stream.contentType ?? "untyped content"}; raw events available.`}</span>
    </div>
    {loading && <p role="status">Reading events…</p>}
    {error && <p role="alert">{error} <button onClick={() => load(cursor.current)}>Retry read</button></p>}
    {copyState && <p role={copyState.startsWith("Copy failed") ? "alert" : "status"}>{copyState}</p>}
    {windowNotice && <p role="status">{windowNotice}</p>}
    {!loading && !error && !events.length && <p>No events yet.</p>}
    {custom && View ? <StreamViewBoundary key={stream.contentType} raw={() => setCustom(false)}><View stream={{ ...stream, committedThrough: knownHead }} events={events} loading={loading} error={error} readAfter={seq => { if (seqSchema.safeParse(seq).success) load(seq, true); else setError("Invalid decimal cursor") }} /></StreamViewBoundary> : <>
      <div className="event-table-head" aria-hidden="true"><span>Sequence</span><span>Content preview</span><span>Operations</span></div>
      <div className="event-scroll" ref={scroll} role="table" aria-label="Raw events" tabIndex={0}
        onScroll={e => { setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }); if (live.current && e.currentTarget.scrollTop + e.currentTarget.clientHeight < e.currentTarget.scrollHeight - 88) pause() }}
        onFocusCapture={e => {
          const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-event-seq]") : null
          focusSeq.current = row?.dataset.eventSeq ?? null
          setFocused(row?.dataset.eventSeq ?? null)
          if (live.current) pause()
        }}
        onBlurCapture={e => {
          const row = e.relatedTarget instanceof Element ? e.relatedTarget.closest<HTMLElement>("[data-event-seq]") : null
          focusSeq.current = row?.dataset.eventSeq ?? null
          setFocused(row?.dataset.eventSeq ?? null)
        }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return
          if (e.key === "Home") { e.preventDefault(); e.currentTarget.scrollTop = 0 }
          if (e.key === "End") { e.preventDefault(); e.currentTarget.scrollTop = e.currentTarget.scrollHeight }
        }}>
        <div role="rowgroup" style={{ height: events.length * WINDOW_LIMITS.rowHeight, position: "relative" }}>
        {indexes.map(index => { const event = events[index]!; return <div className="event-row" role="row" data-event-seq={event.seq} key={event.seq} style={{ position: "absolute", top: index * WINDOW_LIMITS.rowHeight, width: "100%" }}>
          <span role="cell" className="event-seq" title={event.seq}>{event.seq}</span><span role="cell" className="event-preview">{event.payload.slice(0, 240)}</span>
          <span role="cell" className="event-actions"><button onClick={() => { setDetail(event.seq); setCopyState(null) }} aria-label={`View event ${event.seq}`}>View</button><button onClick={() => void copy(event)} aria-label={`Copy event ${event.seq}`}>Copy</button></span>
        </div> })}
        </div>
      </div>
    </>}
    <p className="stream-window-status">Loaded {events[0]?.seq ?? "—"}–{events.at(-1)?.seq ?? "—"} · {events.length} cached · {bytes} UTF-8 payload bytes. Evicted pages can be reread with Previous or Locate.</p>
    {selected && <section className="event-detail" aria-label={`Raw event ${selected.seq}`}><h3>Event #{selected.seq}</h3><Button variant="ghost" onClick={() => { setDetail(null); scroll.current?.focus() }}>Close raw detail</Button><p>Original payload (copy is byte-for-byte text)</p><pre tabIndex={0}>{selected.payload}</pre>{formatted !== selected.payload && <details><summary>Formatted JSON</summary><pre>{formatted}</pre></details>}</section>}
  </div>
}
