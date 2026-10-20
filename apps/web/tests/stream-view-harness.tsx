import { useState } from "react"
import { createRoot } from "react-dom/client"
import { StreamEvents } from "../src/streams"
import type { StreamViewProps, StreamViewRegistry } from "../src/stream-views"
import "../src/index.css"

function TestView({ stream, events }: StreamViewProps) {
  const [failed, setFailed] = useState(false)
  if (failed) throw new Error("test decoder failure")
  return <div>Bounded built-in: {stream.streamId} ({events.length} events)<button onClick={() => setFailed(true)}>Fail decoder</button></div>
}
const registry: StreamViewRegistry = new Map([["application/vnd.test.observation.v1+json", { label: "Test v1", component: TestView }]])
createRoot(document.getElementById("root")!).render(<main style={{ height: "100dvh" }}>
  <StreamEvents registry={registry} selection={{ device: { id: "one", displayName: "Studio", status: "offline" }, stream: { streamId: "observations", contentType: "application/vnd.test.observation.v1+json", committedThrough: "100000", retainedFrom: "1" } }} />
</main>)
