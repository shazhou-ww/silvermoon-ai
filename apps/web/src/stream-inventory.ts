import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/App"
import type { StreamDescriptor } from "./stream-views"

export interface StreamDevice { id: string; displayName: string; status: "online" | "offline" }
interface Catalog<T> { items: T[]; next: string | null }
interface Inventory {
  devices: StreamDevice[]
  nextDevice: string | null
  streams: Record<string, { streams: StreamDescriptor[]; next: string | null }>
}
const empty = (): Inventory => ({ devices: [], nextDevice: null, streams: {} })
const endpoint = (device: string) => `/api/stream-connectors/${encodeURIComponent(device)}/streams`

// Refresh only the explicitly loaded prefix, allowing two pages of insertion drift.
// Exhausting that bounded budget is an error, never permission to discard loaded pages.
async function prefix<T>(read: (after?: string) => Promise<Catalog<T>>, loaded: readonly T[], id: (item: T) => string): Promise<Catalog<T>> {
  const through = loaded.at(-1) ? id(loaded.at(-1)!) : null
  const budget = Math.ceil(loaded.length / 32) + 2
  const items: T[] = []
  let after: string | undefined
  for (let page = 0; page < budget; page++) {
    const result = await read(after)
    items.push(...result.items)
    if (!result.next || !through || (items.at(-1) && id(items.at(-1)!) >= through)) return { items, next: result.next }
    if (result.next === after) throw new Error("Inventory pagination did not advance")
    after = result.next
  }
  throw new Error("Inventory changed beyond the refresh budget; loaded pages retained. Retry refresh.")
}

export function useStreamInventory(enabled: boolean) {
  const [inventory, setInventory] = useState<Inventory>(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Inventory>(empty())
  const inFlight = useRef<AbortController | null>(null)
  const run = useCallback(async (more?: { device?: string }) => {
    if (inFlight.current) return
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    const snapshot = current.current
    const devices = async (after?: string): Promise<Catalog<StreamDevice>> => {
      const page = await api<{ devices: StreamDevice[]; next: string | null }>(`/api/stream-connectors${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal: controller.signal })
      return { items: page.devices, next: page.next }
    }
    const streams = async (device: string, after?: string): Promise<Catalog<StreamDescriptor>> => {
      const page = await api<{ streams: StreamDescriptor[]; next: string | null }>(`${endpoint(device)}${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal: controller.signal })
      return { items: page.streams, next: page.next }
    }
    try {
      let next: Inventory
      if (more?.device) {
        const previous = snapshot.streams[more.device]
        if (!previous?.next) return
        const page = await streams(more.device, previous.next)
        next = { ...snapshot, streams: { ...snapshot.streams, [more.device]: { streams: [...previous.streams, ...page.items], next: page.next } } }
      } else {
        const page = more && snapshot.nextDevice ? await devices(snapshot.nextDevice) : await prefix(devices, snapshot.devices, d => d.id)
        const loaded = more ? [...snapshot.devices, ...page.items] : page.items
        const catalogs: Inventory["streams"] = {}
        for (const device of loaded) {
          const page = await prefix(after => streams(device.id, after), snapshot.streams[device.id]?.streams ?? [], s => s.streamId)
          catalogs[device.id] = { streams: page.items, next: page.next }
        }
        next = { devices: loaded, nextDevice: page.next, streams: catalogs }
      }
      if (!controller.signal.aborted) { current.current = next; setInventory(next); setError(null) }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Inventory refresh failed")
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setLoading(false) }
    }
  }, [])
  useEffect(() => {
    if (!enabled) { current.current = empty(); setInventory(empty()); return }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await run()
      if (active) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => { active = false; clearTimeout(timer); const pending = inFlight.current; inFlight.current = null; pending?.abort() }
  }, [enabled, run])
  return { ...inventory, loading, error, refresh: () => run(), moreDevices: () => run({}), moreStreams: (device: string) => run({ device }) }
}
