import type { RefObject } from "react"
import { Copy, Laptop, LoaderCircle, Plus, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

interface Device {
  id: string
  displayName: string
  status: "online" | "offline"
  agent: { name: string; version: string | null } | null
  sessionCount: number
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
          {props.devices.length === 0 && (
            <p className="settings-empty">No Device has been added to this account yet.</p>
          )}
          {props.devices.map((device) => {
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
                  {token && (
                    <>
                      <Button type="button" size="sm" variant="outline" disabled={props.busyAction !== null} onClick={() => void props.rotateToken(token.id)}>
                        {props.busyAction === `rotate-token:${token.id}` && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                        Rotate token
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={props.busyAction !== null} onClick={() => void props.revokeToken(token.id)}>Revoke</Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
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
