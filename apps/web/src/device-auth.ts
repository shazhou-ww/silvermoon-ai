export interface DeviceAuthIdentity { readonly accountId: string; readonly sessionId: string }
export interface DeviceAuthScope extends DeviceAuthIdentity { readonly generation: number; readonly signal: AbortSignal }

export function sameAuthIdentity(a: DeviceAuthIdentity, b: DeviceAuthIdentity): boolean {
  return a.accountId === b.accountId && a.sessionId === b.sessionId
}

// Invalidation belongs to one verified browser identity, not whichever component is mounted later.
export class DeviceAuthBoundary {
  private active: { scope: DeviceAuthScope; controller: AbortController } | null = null
  private generation = 0

  adopt(identity: DeviceAuthIdentity): DeviceAuthScope {
    if (this.active && sameAuthIdentity(this.active.scope, identity)) return this.active.scope
    this.clear()
    const controller = new AbortController()
    const scope = { ...identity, generation: ++this.generation, signal: controller.signal }
    this.active = { scope, controller }
    return scope
  }

  owns(scope: DeviceAuthScope): boolean {
    return this.active?.scope === scope && !scope.signal.aborted
  }

  invalidate(scope: DeviceAuthScope): boolean {
    if (!this.owns(scope)) return false
    this.clear()
    return true
  }

  clear(): boolean {
    const previous = this.active
    this.active = null
    previous?.controller.abort()
    return previous !== null
  }
}
