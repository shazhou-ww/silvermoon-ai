import { Component, type ComponentType, type ReactNode } from "react"
import type { EventRecord } from "@silvermoon-ai/sync-protocol"

export interface StreamDescriptor {
  streamId: string
  committedThrough: string
  retainedFrom: string | null
  contentType?: string
}
export interface StreamViewProps {
  stream: StreamDescriptor
  events: readonly EventRecord[]
  loading: boolean
  error: string | null
  // The workspace bounds and authenticates all reads; views cannot write or subscribe independently.
  readAfter: (seq: string) => void
}
export interface BuiltinStreamView {
  label: string
  component: ComponentType<StreamViewProps>
}
export type StreamViewRegistry = ReadonlyMap<string, BuiltinStreamView>
export const builtinStreamViews: StreamViewRegistry = new Map()

export class StreamViewBoundary extends Component<{ children: ReactNode; raw: () => void }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Built-in view failed" }
  }
  render() {
    return this.state.error
      ? <div role="alert">View failed: {this.state.error} <button onClick={this.props.raw}>Show raw events</button></div>
      : this.props.children
  }
}
