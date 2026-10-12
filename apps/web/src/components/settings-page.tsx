import { useRef, useState, type RefObject } from "react"
import { Copy, Laptop, LoaderCircle, Plus, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface Device {
  id: string
  displayName: string
  status: "online" | "offline"
  agent: { name: string; version: string | null } | null
  sessionCount: number
  removedAt?: string | null
  disconnectRequestedAt?: string | null
}

interface Token {
  id: string
  tokenHint: string
  lastUsedAt: string | null
}

type Provider = "google" | "microsoft" | "github"

interface SettingsPageProps {
  pageRef: RefObject<HTMLElement | null>
  deviceNameRef: RefObject<HTMLInputElement | null>
  addDeviceRef: RefObject<HTMLButtonElement | null>
  devices: Device[]
  tokens: Map<string, Token>
  identities: { provider: Provider; email: string | null; displayName: string | null }[]
  providerLabels: Record<Provider, string>
  deviceFormOpen: boolean
  setDeviceFormOpen: (open: boolean) => void
  deviceName: string
  setDeviceName: (value: string) => void
  expiresInDays: string
  setExpiresInDays: (value: string) => void
  busyAction: string | null
  revealedToken: string | null
  hideToken: () => void
  createDevice: (event: React.FormEvent) => Promise<void>
  cancelDevice: () => void
  rotateToken: (id: string) => Promise<void>
  revokeToken: (id: string) => Promise<void>
  renameDevice: (id: string, name: string) => Promise<boolean>
  deleteDevice: (id: string) => Promise<{ disconnectRequested: boolean } | null>
  unlinkIdentity: (provider: Provider) => Promise<void>
  copyProfile: () => Promise<void>
  formatTime: (value: string | null) => string
  identityLink: (provider: Provider) => string
}

export function SettingsPage({
  pageRef,
  addDeviceRef,
  deviceNameRef,
  ...props
}: SettingsPageProps) {
  const [management, setManagement] = useState<{ device: Device; action: "rename" | "delete" } | null>(null)
  const [name, setName] = useState("")
  const [managementError, setManagementError] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const deviceRemoved = management?.action === "delete"
    && props.devices.some(device => device.id === management.device.id && device.removedAt)
  const openManagement = (device: Device, action: "rename" | "delete", target: HTMLElement) => {
    returnFocus.current = target
    setName(device.displayName)
    setManagementError(null)
    setManagement({ device, action })
  }
  const submitManagement = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!management || props.busyAction !== null) return
    setManagementError(null)
    try {
      if (management.action === "rename") {
        if (await props.renameDevice(management.device.id, name)) setManagement(null)
      } else {
        const result = await props.deleteDevice(management.device.id)
        if (result?.disconnectRequested) setManagement(null)
        else if (result) setManagementError("Connection access is disabled, but disconnect requests could not all be confirmed. Retry disconnect; history is retained.")
      }
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : "Device management failed.")
    }
  }
  return (
    <section className="settings-page" ref={pageRef} aria-label="Settings">
      <Card className="settings-card" id="settings-devices" tabIndex={-1}>
        <CardHeader className="device-card-header">
          <div>
            <CardTitle><h2 className="flex items-center gap-2"><Laptop aria-hidden="true" />Devices</h2></CardTitle>
            <CardDescription>Add and manage devices that can connect to this account.</CardDescription>
          </div>
          <Button
            ref={addDeviceRef}
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={props.deviceFormOpen}
            aria-controls="create-device"
            onClick={() => props.setDeviceFormOpen(true)}
            disabled={props.busyAction !== null}
            hidden={props.deviceFormOpen}
          >
            <Plus aria-hidden="true" />Add device
          </Button>
        </CardHeader>
        <CardContent className="settings-list">
          {props.deviceFormOpen && (
            <form className="settings-list-row device-create-row" id="create-device" onSubmit={props.createDevice}>
              <label className="field-stack">
                <span>Device name</span>
                <Input
                  ref={deviceNameRef}
                  value={props.deviceName}
                  onChange={(event) => props.setDeviceName(event.target.value)}
                  required
                  disabled={props.busyAction === "create-token"}
                />
              </label>
              <label className="field-stack">
                <span>Expires in days</span>
                <Input
                  type="number"
                  min="1"
                  value={props.expiresInDays}
                  onChange={(event) => props.setExpiresInDays(event.target.value)}
                  disabled={props.busyAction === "create-token"}
                />
              </label>
              <div className="settings-row-actions">
                <Button type="submit" size="sm" disabled={props.busyAction !== null || !props.deviceName.trim()}>
                  {props.busyAction === "create-token"
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : <Plus aria-hidden="true" />}
                  Add device
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={props.cancelDevice} disabled={props.busyAction === "create-token"}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {props.revealedToken && (
            <div className="token-reveal">
              <div>
                <strong>Copy this connector profile now</strong>
                <span>Save it as ~/.silvermoon/connector.yaml. Copy it before leaving Settings or refreshing; it will not be restored.</span>
              </div>
              <code>{props.revealedToken}</code>
              <div className="token-reveal-actions">
                <Button type="button" size="sm" onClick={() => void props.copyProfile()}><Copy aria-hidden="true" />Copy profile</Button>
                <Button type="button" size="sm" variant="ghost" onClick={props.hideToken}>Hide</Button>
              </div>
            </div>
          )}
          {props.devices.filter(device => !device.removedAt).length === 0 && (
            <p className="settings-empty">No Device has been added to this account yet.</p>
          )}
          {props.devices.filter(device => !device.removedAt).map((device) => {
            const token = props.tokens.get(device.id)
            return (
              <div className="settings-list-row device-settings-row" key={device.id}>
                <div className="settings-row-main">
                  <span className="connector-status-dot" data-status={device.status} aria-hidden="true" />
                  <div>
                    <strong>{device.displayName}</strong>
                    <span>{token ? `${token.tokenHint} · Last used ${props.formatTime(token.lastUsedAt)}` : "No active connection token"}</span>
                  </div>
                </div>
                <div className="device-settings-context">
                  <span>{device.agent ? `${device.agent.name}${device.agent.version ? ` ${device.agent.version}` : ""}` : "Not connected yet"}</span>
                  <span>{device.sessionCount} {device.sessionCount === 1 ? "Session" : "Sessions"}</span>
                </div>
                <div className="settings-row-actions">
                  <Badge variant="outline">{device.status}</Badge>
                  <Button type="button" size="sm" variant="outline" disabled={props.busyAction !== null}
                    onClick={event => openManagement(device, "rename", event.currentTarget)}>Rename</Button>
                  {token && (
                    <>
                      <Button type="button" size="sm" variant="outline" disabled={props.busyAction !== null} onClick={() => void props.rotateToken(token.id)}>
                        {props.busyAction === `rotate-token:${token.id}` && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                        Rotate token
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={props.busyAction !== null} onClick={() => void props.revokeToken(token.id)}>Revoke</Button>
                    </>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={props.busyAction !== null}
                    onClick={event => openManagement(device, "delete", event.currentTarget)}>Delete</Button>
                </div>
              </div>
            )
          })}
          {props.devices.filter(device => device.removedAt && !device.disconnectRequestedAt).map(device => (
            <div className="settings-list-row" key={`disconnect:${device.id}`}>
              <div><strong>{device.displayName} · removed</strong><span>Access is disabled. Disconnect requests need a retry; saved history is read-only.</span></div>
              <Button type="button" size="sm" variant="outline" disabled={props.busyAction !== null}
                onClick={event => openManagement(device, "delete", event.currentTarget)}>Retry disconnect</Button>
            </div>
          ))}
          {props.devices.some(device => device.removedAt) && (
            <p className="settings-empty">Removed Device history remains in Sessions. Use Show offline Sessions in View options to read it.</p>
          )}
        </CardContent>
      </Card>
      <Dialog open={management !== null} onOpenChange={open => {
        if (!open && props.busyAction === null) setManagement(null)
      }}>
        <DialogContent onCloseAutoFocus={event => {
          event.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
          else if (props.deviceFormOpen) deviceNameRef.current?.focus()
          else addDeviceRef.current?.focus()
        }}>
          <DialogHeader>
            <DialogTitle>{management?.action === "rename" ? "Rename Device" : `Delete ${management?.device.displayName ?? "Device"}?`}</DialogTitle>
            <DialogDescription>{management?.action === "rename"
              ? "Only the display name changes. Your connection, token and Sessions stay unchanged."
              : "Remove this Device from your account. Its connection credentials cannot be restored."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={event => void submitManagement(event)}>
            {management?.action === "rename" ? (
              <label className="field-stack">Device name<Input autoFocus required maxLength={80} value={name}
                onChange={event => setName(event.target.value)} disabled={props.busyAction !== null} /></label>
            ) : (
              <div className="grid gap-3 text-sm">
                <p>{management?.device.status === "online" ? "This Device is online. Its Relay connection will be disconnected." : "This Device is offline or already removed. Old credentials cannot reconnect."}</p>
                <p>All connection tokens will be invalidated. The {management?.device.sessionCount ?? 0} synced Sessions and their history remain read-only.</p>
                <p>This does not delete local data, stop local agents, or recall instructions already sent.</p>
                <p>To reconnect this computer, add a new Device and configure its new token. Old history will not be merged.</p>
              </div>
            )}
            {managementError && <p role="alert" className="text-destructive text-sm mt-3">{managementError}</p>}
            <DialogFooter className="dialog-actions mt-4">
              <Button type="button" variant="outline" disabled={props.busyAction !== null} onClick={() => setManagement(null)}>Cancel</Button>
              <Button type="submit" variant={management?.action === "delete" ? "destructive" : "default"}
                disabled={props.busyAction !== null || (management?.action === "rename" && !name.trim())}>
                {props.busyAction !== null && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {management?.action === "rename" ? "Save name" : deviceRemoved ? "Retry disconnect" : "Delete device"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Card className="settings-card">
        <CardHeader>
          <CardTitle><h2 className="flex items-center gap-2"><ShieldCheck aria-hidden="true" />Linked identities</h2></CardTitle>
          <CardDescription>Keep at least one provider linked to sign in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="settings-list">
            {props.identities.map((identity) => (
              <div className="settings-list-row" key={identity.provider}>
                <div><strong>{props.providerLabels[identity.provider]}</strong><span>{identity.email ?? identity.displayName ?? "No profile email"}</span></div>
                <Button type="button" size="sm" variant="outline" disabled={props.identities.length <= 1} onClick={() => void props.unlinkIdentity(identity.provider)}>Unlink</Button>
              </div>
            ))}
          </div>
          <div className="provider-links">
            {(["google", "microsoft", "github"] as const)
              .filter((provider) => !props.identities.some((identity) => identity.provider === provider))
              .map((provider) => (
                <Button key={provider} asChild variant="outline" size="sm">
                  <a href={props.identityLink(provider)}>Link {props.providerLabels[provider]}</a>
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
