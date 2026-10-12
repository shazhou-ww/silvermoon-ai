import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Laptop,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  WifiOff,
  Wrench,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  AgentInputQuestion,
  AgentInputRequest,
} from "@silvermoon-ai/protocol"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { TranscriptScroll } from "@/components/transcript-scroll"
import { SettingsPage } from "@/components/settings-page"
import {
  buildTranscript,
  groupTurnSegments,
  segmentTurnParts,
  transcriptItemIsVisible,
  transcriptToolCount,
  type AgentSessionEvent,
  type TranscriptPart,
  type TranscriptTurn,
} from "@/message-flow"
import {
  deriveSessionFacets,
  deriveVisibleSessions,
  groupSessionsByDevice,
  sessionConfirmationIsCurrent,
  sessionDisplayStatus,
  sessionIsArchived,
  sessionKey,
  type OrderedSession,
  type SessionStatusView,
  type SessionSource,
} from "@/session-list"
import {
  SessionDrafts,
  workspaceRoute,
  workspaceUrl,
  type SessionSelection,
  type WorkspaceView,
} from "@/workspace-state"
import { useSessionViewPreferences } from "@/session-view-preferences"

const relayOrigin =
  import.meta.env.VITE_RELAY_ORIGIN ?? "https://relay.silvermoon.work"

type Provider = "google" | "microsoft" | "github"

interface Identity {
  provider: Provider
  email: string | null
  displayName: string | null
  emailVerified: boolean
}

interface Account {
  user: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
  identities: Identity[]
  sessionId: string
}

interface ConnectionToken {
  id: string
  deviceId: string
  deviceName: string
  tokenHint: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

interface Connector {
  id: string
  displayName: string
  agent: {
    name: string
    version: string | null
  } | null
  capabilities: {
    listSessions: boolean
    createSession: boolean
    sendMessage: boolean
    streamEvents: boolean
  }
  status: "online" | "offline"
  connectionId: string | null
  sessionSyncState: "unsupported" | "pending" | "ready" | "failed"
  sessionSyncError: string | null
  connectedAt: string | null
  disconnectedAt: string | null
  lastSeenAt: string | null
  createdAt: string
  sessionCount: number
}

interface AgentSession {
  id: string
  connectorId: string
  parentSessionId: string | null
  title: string | null
  status: string
  nativeStatus?: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastMessagePreview: string | null
  canSendMessage: boolean
  pendingInputRequest?: AgentInputRequest | null
  confirmedConnectionId: string | null
  executionStateKnown: boolean
  capabilityConfirmed: boolean
}

interface CommandResponse {
  command: {
    id: string
    type: string
    status: "sent" | "failed"
  }
}

interface HistorySyncResponse {
  command: {
    id: string
    type: string
    status: "queued" | "sent" | "accepted" | "failed"
  } | null
  synced?: boolean
}

interface CommandStatus {
  id: string
  connectorId: string
  type: string
  sessionId: string | null
  status: "queued" | "sent" | "accepted" | "succeeded" | "failed" | "unknown"
  error: {
    code: string
    message: string | null
  } | null
}

interface TrackedCommand {
  id: string
  label: string
  status: CommandStatus["status"]
  historyRequestKey?: string
}

const providerLabels: Record<Provider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
}

const emptyEvents: AgentSessionEvent[] = []

function csrfToken(): string {
  const item = document.cookie
    .split("; ")
    .find((value) => value.startsWith("sm_csrf="))
  return item ? decodeURIComponent(item.slice("sm_csrf=".length)) : ""
}

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method ?? "GET"
  const headers = new Headers(init.headers)
  if (method !== "GET") headers.set("x-csrf-token", csrfToken())
  if (init.body) headers.set("content-type", "application/json")
  const response = await fetch(`${relayOrigin}${path}`, {
    ...init,
    headers,
    credentials: "include",
  })
  const value = await response.json() as T & { error?: string }
  if (!response.ok) {
    if (response.status === 401 && value.error === "authentication-required") {
      window.dispatchEvent(new Event("relay:authentication-required"))
    }
    throw new Error(value.error ?? `Request failed: ${response.status}`)
  }
  return value
}

function formatTime(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })
}

function sessionLabel(session: AgentSession): string {
  return session.title || session.lastMessagePreview || "Untitled session"
}

function sessionStatusLabel(status: string): string {
  switch (status) {
    case "queued":
    case "running":
      return "Active"
    case "waiting":
      return "Needs input"
    case "idle":
      return "Available"
    case "failed":
      return "Failed"
    case "closed":
      return "Ended"
    case "gone":
      return "Unavailable"
    case "offline":
      return "Offline"
    case "syncing":
      return "Syncing status"
    case "sync-failed":
      return "Status sync failed"
    case "unsupported":
      return "Connector update required"
    case "unconfirmed":
      return "State not confirmed"
    case "unknown-device":
      return "Device status unknown"
    default:
      return "Execution state unknown"
  }
}

function inputRequestSummary(request: AgentInputRequest | null | undefined) {
  return request?.message
    ?? request?.questions[0]?.title
    ?? request?.questions[0]?.message
    ?? null
}

function allowsCustomAnswer(question: AgentInputQuestion) {
  return (
    question.kind === "single-select"
    || question.kind === "multi-select"
  ) && question.allowFreeformInput === true
}

function sessionPreview(session: AgentSession): string | null {
  if (session.status !== "waiting") return session.lastMessagePreview
  return inputRequestSummary(session.pendingInputRequest)
    ?? "Input request details unavailable — open to review and reply."
}

function eventLabel(event: AgentSessionEvent): string {
  if (event.type === "tool") return "Tool"
  if (event.type === "error") return "Error"
  if (event.role === "assistant") return "Copilot"
  if (event.role === "user") return "You"
  if (event.role === "system") return "System"
  return event.type[0].toUpperCase() + event.type.slice(1)
}

function eventBody(event: AgentSessionEvent): string {
  if (event.text) return event.text
  if (event.data) return JSON.stringify(event.data, null, 2)
  return "No additional details."
}

function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

function PendingInputPanel({
  request,
  canReply,
  onChoose,
  onCustomAnswer,
}: {
  request: AgentInputRequest | null | undefined
  canReply: boolean
  onChoose(value: string): void
  onCustomAnswer(): void
}) {
  const titleId = "pending-input-title"
  return (
    <section className="pending-input" aria-labelledby={titleId}>
      <div className="pending-input-heading">
        <CircleAlert aria-hidden="true" />
        <div>
          <span>Agent is waiting for your input</span>
          <strong id={titleId}>
            {request
              ? "Review the request and reply"
              : "Input request details unavailable"}
          </strong>
        </div>
      </div>
      {request
        ? (
            <div className="pending-input-body">
              {request.message && <MarkdownBody>{request.message}</MarkdownBody>}
              {request.url && (
                <a href={request.url} target="_blank" rel="noreferrer">
                  Open referenced resource
                </a>
              )}
              {request.questions.map((question) => {
                const options = question.options
                  ?? (question.kind === "boolean"
                    ? [
                        { id: "true", label: "Yes" },
                        { id: "false", label: "No" },
                      ]
                    : [])
                const customAnswer = allowsCustomAnswer(question)
                return (
                  <div className="pending-input-question" key={question.id}>
                    {question.title && <strong>{question.title}</strong>}
                    <span>
                      {question.message}
                      {question.required && (
                        <span className="pending-input-required"> Required</span>
                      )}
                    </span>
                    {(options.length > 0 || customAnswer) && (
                      <div
                        className="pending-input-options"
                        aria-label={`Options for ${question.title ?? question.message}`}
                      >
                        {options.map((option) => (
                          <button
                            type="button"
                            key={option.id}
                            onClick={() => onChoose(option.label)}
                            disabled={!canReply}
                          >
                            <span>{option.label}</span>
                            {"recommended" in option
                              && option.recommended
                              && (
                                <small className="pending-input-recommended">
                                  Recommended
                                </small>
                              )}
                            {"description" in option
                              && option.description
                              && <small>{option.description}</small>}
                          </button>
                        ))}
                        {customAnswer && (
                          <button
                            type="button"
                            onClick={onCustomAnswer}
                            disabled={!canReply}
                          >
                            <span>Enter custom answer</span>
                            <small>Type your own response below.</small>
                          </button>
                        )}
                      </div>
                    )}
                    {(question.kind === "text"
                      || question.kind === "number"
                      || question.kind === "integer") && (
                      <small className="pending-input-hint">
                        Enter your answer in the reply box below.
                      </small>
                    )}
                  </div>
                )
              })}
              {request.questions.length === 0 && (
                <p className="pending-input-hint">
                  Reply below with the information the agent requested.
                </p>
              )}
            </div>
          )
        : (
            <p className="pending-input-fallback">
              This older or incomplete Session does not include the original
              question metadata. Review the latest activity, then reply below
              with the missing confirmation or instruction.
            </p>
          )}
    </section>
  )
}

function toolStateLabel(part: TranscriptPart): string {
  switch (part.event.data?.state) {
    case "started":
    case "running":
      return "Running"
    case "waiting":
      return "Waiting"
    case "succeeded":
      return "Succeeded"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    default:
      return "Updated"
  }
}

function ToolStateIcon({ part }: { part: TranscriptPart }) {
  const state = part.event.data?.state
  if (state === "succeeded") return <Check aria-hidden="true" />
  if (state === "failed" || state === "cancelled") {
    return <CircleAlert aria-hidden="true" />
  }
  return <LoaderCircle className="animate-spin" aria-hidden="true" />
}

function ToolDisclosure({ part }: { part: TranscriptPart }) {
  const state = part.event.data?.state
  const name = typeof part.event.data?.toolName === "string"
    ? part.event.data.toolName
    : "Tool"
  const [open, setOpen] = useState(state !== "succeeded")
  return (
    <details
      className="turn-tool"
      data-state={state ?? "updated"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="turn-tool-state">
          <ToolStateIcon part={part} />
        </span>
        <strong>{name}</strong>
        <span>{toolStateLabel(part)}</span>
      </summary>
      <div className="turn-tool-detail">
        <p>{eventBody(part.event)}</p>
      </div>
    </details>
  )
}

function ToolGroup({ parts }: { parts: TranscriptPart[] }) {
  const failed = parts.some((part) =>
    part.event.data?.state === "failed"
    || part.event.data?.state === "cancelled"
  )
  const active = parts.some((part) =>
    part.event.data?.state === "started"
    || part.event.data?.state === "running"
    || part.event.data?.state === "waiting"
  )
  const summary = failed
    ? "Needs attention"
    : active
    ? "In progress"
    : "Completed"

  return (
    <section
      className="turn-tool-group"
      aria-label={`Tool activity, ${parts.length} ${
        parts.length === 1 ? "step" : "steps"
      }, ${summary.toLowerCase()}`}
    >
      <header>
        <span>
          <Wrench aria-hidden="true" />
          Tool activity · {parts.length}
        </span>
        <strong data-state={failed ? "failed" : active ? "running" : "succeeded"}>
          {summary}
        </strong>
      </header>
      {parts.map((part) => (
        <ToolDisclosure
          key={`${part.id}:${part.event.data?.state ?? "updated"}`}
          part={part}
        />
      ))}
    </section>
  )
}

function StructuredPart({ part }: { part: TranscriptPart }) {
  const body = eventBody(part.event)
  if (part.kind === "input") return null
  if (part.kind === "markdown") {
    return (
      <article
        className="turn-markdown"
        aria-label={`Copilot message sent ${formatTime(part.event.createdAt)}`}
      >
        <MarkdownBody>{body}</MarkdownBody>
      </article>
    )
  }
  if (part.kind === "system") {
    return (
      <div className="turn-system" aria-label="System notification">
        <strong>System</strong>
        <p>{body}</p>
      </div>
    )
  }
  if (part.kind === "error") {
    return (
      <div className="turn-error" aria-label="Agent error">
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Error</strong>
          <p>{body}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="turn-activity">
      <span aria-hidden="true" />
      <div>
        <strong>Activity</strong>
        <p>{body}</p>
      </div>
      <time dateTime={part.event.createdAt}>
        {formatRelativeTime(part.event.createdAt)}
      </time>
    </div>
  )
}

function TranscriptTurnView({
  turn,
  showTools,
}: {
  turn: TranscriptTurn
  showTools: boolean
}) {
  const blocks = groupTurnSegments(segmentTurnParts(turn.parts))
  const visibleBlocks = blocks.filter((block) =>
    block.kind === "answer"
    || showTools
    || block.segments.some((segment) => segment.kind !== "tools")
  )
  const lastEvent = turn.parts.at(-1)?.event ?? turn.request
  return (
    <article
      className="transcript-turn"
      aria-label={`Agent turn started ${formatTime(turn.createdAt)}`}
    >
      {turn.request?.text && (
        <div
          className={`turn-request ${
            turn.request.role === "user" ? "is-user" : "is-system"
          }`}
          aria-label={`${eventLabel(turn.request)} message sent ${
            formatTime(turn.request.createdAt)
          }`}
        >
          <p>{turn.request.text}</p>
        </div>
      )}
      {visibleBlocks.map((block, blockIndex) =>
        block.kind === "answer"
          ? (
              <div
                key={`answer:${block.part.id}`}
                className="turn-request is-user turn-input-answer"
                aria-label={`${eventLabel(block.part.event)} message sent ${
                  formatTime(block.part.event.createdAt)
                }`}
              >
                <p>{eventBody(block.part.event)}</p>
              </div>
            )
          : (
              <div
                className="turn-response"
                key={`response:${
                  block.segments[0]?.kind === "tools"
                    ? block.segments[0].parts[0]?.id
                    : block.segments[0]?.part.id
                }:${blockIndex}`}
              >
                <strong className="turn-response-label">Copilot</strong>
                {block.segments.map((segment, index) =>
                  segment.kind === "tools"
                    ? showTools && (
                        <ToolGroup
                          key={`tools:${segment.parts[0]?.id ?? index}`}
                          parts={segment.parts}
                        />
                      )
                    : (
                        <StructuredPart
                          key={`${segment.part.kind}:${segment.part.id}`}
                          part={segment.part}
                        />
                      )
                )}
              </div>
            )
      )}
      {lastEvent && (
        <time className="turn-time" dateTime={lastEvent.createdAt}>
          {formatTime(lastEvent.createdAt)}
        </time>
      )}
    </article>
  )
}

function LegacyEventView({ event }: { event: AgentSessionEvent }) {
  return event.type === "message"
    ? (
        <article
          className={`conversation-message message-${event.role ?? "system"}`}
          aria-label={`${eventLabel(event)} message sent ${
            formatTime(event.createdAt)
          }`}
        >
          {event.role === "assistant"
            ? <MarkdownBody>{eventBody(event)}</MarkdownBody>
            : <p>{eventBody(event)}</p>}
          <time className="message-time" dateTime={event.createdAt}>
            {formatTime(event.createdAt)}
          </time>
        </article>
      )
    : (
        <div className="activity-event" data-type={event.type}>
          <span className="activity-event-marker" aria-hidden="true" />
          <div>
            <strong>{eventLabel(event)}</strong>
            <pre>{eventBody(event)}</pre>
          </div>
          <time dateTime={event.createdAt}>
            {formatRelativeTime(event.createdAt)}
          </time>
        </div>
      )
}

function initials(value: string | null): string {
  if (!value?.trim()) return "SM"
  return value
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function selectionFromLocation(): SessionSelection | null {
  return workspaceRoute(window.location).selection
}

function updateLocationSelection(
  selection: SessionSelection | null,
  mode: "push" | "replace",
) {
  window.history[mode === "push" ? "pushState" : "replaceState"](
    {},
    "",
    workspaceUrl(window.location.href, "session", selection),
  )
}

function SessionNavigation({
  inDrawer,
  open,
  onOpenChange,
  restoreFocus,
  children,
}: {
  inDrawer: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  restoreFocus: () => void
  children: React.ReactNode
}) {
  if (!inDrawer) return <>{children}</>
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="session-navigation-drawer"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <DialogTitle className="sr-only">Sessions</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a Session to leave Settings.
        </DialogDescription>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="session-navigation-close"
            aria-label="Close Sessions"
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function initialAuthError(): string | null {
  return new URLSearchParams(window.location.search).has("authError")
    ? "We couldn’t verify that sign-in. Try again or choose another provider."
    : null
}

function ProviderIcon({ provider }: { provider: Provider }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      className="login-provider-icon"
      data-provider-icon={provider}
      src={`/provider-icons/${provider === "google" ? "google.png" : `${provider}.svg`}`}
    />
  )
}

function LoginPage({
  error,
  loading,
  returnTo,
  draftWarning,
}: {
  error: string | null
  loading: boolean
  returnTo?: string
  draftWarning?: string | null
}) {
  return (
    <main className="login-page">
      <div className="login-moon" aria-hidden="true" />
      <div className="login-page-content">
        <div className="login-brand">
          <RelayMark />
          <strong>Silvermoon</strong>
          <span>Relay</span>
        </div>
        <section className="login-hero" aria-labelledby="login-title">
          <h1 id="login-title">Your agents, within reach from anywhere.</h1>
          <p>
            Silvermoon keeps watch over every session, so you can pick up the
            thread wherever you are.
          </p>
        </section>
        <div className="login-body">
          <section className="login-card" aria-labelledby="login-card-title">
            {loading ? (
              <div className="login-loading" role="status">
                <LoaderCircle aria-hidden="true" />
                <div>
                  <h2 id="login-card-title">Opening your relay</h2>
                  <p>Checking your browser session…</p>
                </div>
              </div>
            ) : (
              <>
                <h2 id="login-card-title">Sign in or get started</h2>
                <p>
                  Choose an account to continue. We’ll create your Relay
                  account if you’re new.
                </p>
                {error && (
                  <p role="alert" className="login-error">
                    <strong>Sign-in unsuccessful</strong>
                    <span>{error}</span>
                  </p>
                )}
                {draftWarning && (
                  <p role="alert" className="login-error">{draftWarning}</p>
                )}
                <div className="login-providers">
                  {(["google", "microsoft", "github"] as const).map(
                    (provider) => (
                      <Button
                        asChild
                        key={provider}
                        variant="outline"
                        className="login-provider"
                      >
                        <a href={`${relayOrigin}/auth/${provider}/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}>
                          <ProviderIcon provider={provider} />
                          <span>Continue with {providerLabels[provider]}</span>
                          <span aria-hidden="true" />
                        </a>
                      </Button>
                    ),
                  )}
                </div>
                <small>
                  Provider credentials never enter the relay protocol.
                </small>
              </>
            )}
          </section>
          <div className="login-mascot-stage">
            <img
              className="login-mascot"
              src="/silvermoon-line-art.svg"
              alt="Silvermoon seen from behind, with long hair flowing across the ground"
            />
          </div>
        </div>
        <section className="login-capabilities" aria-label="Relay capabilities">
          <div>
            <strong>Across every device</strong>
            <span>See connected machines and their local Agent sessions.</span>
          </div>
          <div>
            <strong>Resume the thread</strong>
            <span>Continue without returning to the original machine.</span>
          </div>
          <div>
            <strong>Follow in real time</strong>
            <span>Watch progress and send the next instruction.</span>
          </div>
        </section>
      </div>
    </main>
  )
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [tokens, setTokens] = useState<ConnectionToken[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [history, setHistory] = useState<{
    key: string
    events: AgentSessionEvent[]
  } | null>(null)
  const [selection, setSelection] = useState<SessionSelection | null>(
    () => selectionFromLocation(),
  )
  const selectionUnavailable = useRef(false)
  const [loading, setLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [devicesRefreshFailed, setDevicesRefreshFailed] = useState(false)
  const [sessionsRefreshFailed, setSessionsRefreshFailed] = useState(false)
  const [sessionRefreshAttempt, setSessionRefreshAttempt] = useState(0)
  const deviceRefreshRequest = useRef(0)
  const [sessionsLoadedForKey, setSessionsLoadedForKey] = useState<
    string | null
  >(null)
  const [error, setError] = useState<string | null>(initialAuthError)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState("My device")
  const [expiresInDays, setExpiresInDays] = useState("90")
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState("")
  const [sessionPrompt, setSessionPrompt] = useState("")
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(
    () => workspaceRoute(window.location).view,
  )
  const [deviceFormOpen, setDeviceFormOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  )
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [, setDraftRevision] = useState(0)
  const [drafts] = useState(() => new SessionDrafts(
    () => window.sessionStorage,
    (message) => {
      console.error(JSON.stringify({ event: "draft-cache-error", message }))
      setDraftWarning(message)
    },
  ))
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionConnectorId, setNewSessionConnectorId] = useState<
    string | null
  >(null)
  const [sessionQuery, setSessionQuery] = useState("")
  const [sessionStatusView, setSessionStatusView] =
    useState<SessionStatusView>("all")
  const [collapsedSessionKeys, setCollapsedSessionKeys] =
    useState<Set<string>>(() => new Set())
  const [expandedDeviceIds, setExpandedDeviceIds] =
    useState<Set<string>>(() => new Set())
  const [showToolEvents, setShowToolEvents] = useState(false)
  const [mobileView, setMobileView] = useState<"list" | "session">(
    () => selectionFromLocation() ? "session" : "list",
  )
  const [trackedCommand, setTrackedCommand] =
    useState<TrackedCommand | null>(null)
  const [historySyncFailure, setHistorySyncFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const [historySyncAttempt, setHistorySyncAttempt] = useState(0)
  const historyRequests = useRef(new Set<string>())
  const followUpInputRef = useRef<HTMLTextAreaElement>(null)
  const accountRef = useRef<Account | null>(null)
  const authEpoch = useRef(0)
  const settingsVisit = useRef(0)
  const routeRef = useRef(workspaceView)
  const focusDestination = useRef(false)
  const restoreAddDeviceFocus = useRef(false)
  const accountMenuNavigated = useRef(false)
  const settingsPageRef = useRef<HTMLElement>(null)
  const desktopHeadingRef = useRef<HTMLHeadingElement>(null)
  const mobileHeadingRef = useRef<HTMLHeadingElement>(null)
  const openSessionsRef = useRef<HTMLButtonElement>(null)
  const addDeviceRef = useRef<HTMLButtonElement>(null)
  const deviceNameRef = useRef<HTMLInputElement>(null)
  const selectedConnectorId = selection?.connectorId ?? null
  const selectedSessionId = selection?.sessionId ?? null
  const selectionKey = JSON.stringify([selectedConnectorId, selectedSessionId])
  const events = history?.key === selectionKey ? history.events : emptyEvents
  const accountSessionId = account?.sessionId
  const accountId = account?.user.id ?? null
  const {
    preferences: {
      showEnded: showEndedSessions,
      showUnavailable: showUnavailableSessions,
      showOffline: showOfflineSessions,
      groupByDevice: deviceGroupingEnabled,
    },
    warning: viewPreferencesWarning,
    update: updateViewPreference,
    dismissWarning: dismissViewPreferencesWarning,
  } = useSessionViewPreferences(accountId)
  const initializedDeviceGrouping = useRef<string | null>(null)
  const isSettings = workspaceView === "settings"
  const currentDraft = accountId && selection ? drafts.read(accountId, selection) : null
  const followUp = currentDraft?.text ?? ""
  const pendingFollowUps = accountId ? drafts.pending(accountId) : []
  const pendingFollowUp = pendingFollowUps.find((draft) =>
    draft.pending?.commandId || draft.pending?.status !== "unknown",
  )
  const activeCommand = pendingFollowUp?.pending
    ? { label: "Follow-up", status: pendingFollowUp.pending.status }
    : trackedCommand
  const pendingCommandKey = JSON.stringify(
    pendingFollowUps.filter((draft) => draft.pending?.commandId)
      .map((draft) => [draft.selection, draft.pending?.commandId]),
  )
  const connectorIdKey = useMemo(
    () => connectors.map((connector) => connector.id).sort().join("|"),
    [connectors],
  )

  const clearAuthenticatedState = useCallback(() => {
    const previous = accountRef.current
    authEpoch.current++
    settingsVisit.current++
    accountRef.current = null
    if (previous) drafts.clear(previous.user.id)
    setAccount(null)
    setTokens([])
    setConnectors([])
    setAgentSessions([])
    setSessionsLoadedForKey(null)
    setDevicesRefreshFailed(false)
    setSessionsRefreshFailed(false)
    selectionUnavailable.current = false
    setHistory(null)
    historyRequests.current.clear()
    setShowToolEvents(false)
    setSelection(null)
    setTrackedCommand(null)
    setRevealedToken(null)
    setDeviceFormOpen(false)
    setDeviceName("My device")
    setExpiresInDays("90")
    setNewSessionOpen(false)
    setSessionTitle("")
    setSessionPrompt("")
    setHistorySyncFailure(null)
    setDrawerOpen(false)
    setExpandedDeviceIds(new Set())
    setBusyAction(null)
    setNotice(null)
    setMobileView("list")
    const view = routeRef.current === "settings" ? "settings" : "session"
    routeRef.current = view
    setWorkspaceView(view)
    window.history.replaceState({}, "", workspaceUrl(window.location.href, view, null))
  }, [drafts])

  useEffect(() => {
    window.addEventListener("relay:authentication-required", clearAuthenticatedState)
    return () => window.removeEventListener("relay:authentication-required", clearAuthenticatedState)
  }, [clearAuthenticatedState])

  useEffect(() => {
    if (!accountId) return
    drafts.load(accountId)
    // oxlint-disable-next-line react/set-state-in-effect -- Hydrate the authenticated account's tab-local drafts.
    setDraftRevision((revision) => revision + 1)
  }, [accountId, drafts])

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)")
    const change = () => {
      setNarrowViewport(media.matches)
      if (!media.matches) setDrawerOpen(false)
    }
    media.addEventListener("change", change)
    return () => media.removeEventListener("change", change)
  }, [])

  useLayoutEffect(() => {
    if (!focusDestination.current || loading || !account) return
    focusDestination.current = false
    if (isSettings && window.location.hash === "#devices") {
      settingsPageRef.current?.querySelector<HTMLElement>("#settings-devices")?.focus()
      settingsPageRef.current?.querySelector("#settings-devices")?.scrollIntoView()
    } else {
      const heading = narrowViewport ? mobileHeadingRef.current : desktopHeadingRef.current
      heading?.focus({ preventScroll: true })
    }
  }, [account, isSettings, loading, mobileView, narrowViewport, selectionKey, workspaceView, navigationRevision])

  useLayoutEffect(() => {
    if (deviceFormOpen) deviceNameRef.current?.focus()
    else if (restoreAddDeviceFocus.current && busyAction === null) {
      restoreAddDeviceFocus.current = false
      addDeviceRef.current?.focus()
    }
  }, [busyAction, deviceFormOpen])

  const resizeFollowUpInput = useCallback(() => {
    const input = followUpInputRef.current
    if (!input) return
    input.style.height = "auto"
    const contentHeight = input.scrollHeight
    const maxHeight = Number.parseFloat(
      window.getComputedStyle(input).maxHeight,
    )
    const nextHeight = Number.isFinite(maxHeight)
      ? Math.min(contentHeight, maxHeight)
      : contentHeight
    input.style.height = `${nextHeight}px`
    input.style.overflowY =
      Number.isFinite(maxHeight) && contentHeight > maxHeight
        ? "auto"
        : "hidden"
  }, [])

  useLayoutEffect(() => {
    resizeFollowUpInput()
  }, [followUp, mobileView, resizeFollowUpInput, selectedSessionId, workspaceView])

  useEffect(() => {
    window.addEventListener("resize", resizeFollowUpInput)
    return () => window.removeEventListener("resize", resizeFollowUpInput)
  }, [resizeFollowUpInput])

  const refresh = useCallback(async () => {
    const request = ++deviceRefreshRequest.current
    const epoch = authEpoch.current
    try {
      const current = await api<Account>("/api/me")
      if (epoch !== authEpoch.current) return
      const [tokenItems, connectorItems] = await Promise.all([
        api<ConnectionToken[]>("/api/tokens"),
        api<Connector[]>("/api/connectors"),
      ])
      if (epoch !== authEpoch.current || request !== deviceRefreshRequest.current) return
      if (accountRef.current && accountRef.current.user.id !== current.user.id) {
        clearAuthenticatedState()
      }
      accountRef.current = current
      setAccount(current)
      setTokens(tokenItems)
      setConnectors(connectorItems)
      setDevicesRefreshFailed(false)
      setError(null)
    } catch (caught) {
      if (request !== deviceRefreshRequest.current || epoch !== authEpoch.current) return
      if (
        caught instanceof Error
        && caught.message === "authentication-required"
      ) {
        clearAuthenticatedState()
      } else if (caught instanceof Error) {
        if (request === deviceRefreshRequest.current) setDevicesRefreshFailed(true)
        setError(caught.message)
      }
    } finally {
      if (request === deviceRefreshRequest.current) setLoading(false)
    }
  }, [clearAuthenticatedState])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Initial remote state loads after mount.
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!account) return
    let active = true
    const poll = async () => {
      const request = ++deviceRefreshRequest.current
      try {
        const items = await api<Connector[]>("/api/connectors")
        if (active && request === deviceRefreshRequest.current) {
          setConnectors(items)
          setDevicesRefreshFailed(false)
        }
      } catch (caught) {
        if (active && request === deviceRefreshRequest.current && caught instanceof Error) {
          setDevicesRefreshFailed(true)
          setError(caught.message)
        }
      }
    }
    const timer = window.setInterval(() => void poll(), 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account])

  useEffect(() => {
    if (!account) return
    const connectorIds = connectorIdKey ? connectorIdKey.split("|") : []
    if (connectorIds.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- The remote index is empty when no Devices exist.
      setAgentSessions([])
      setSessionsLoading(false)
      setSessionsLoadedForKey("")
      return
    }
    let active = true
    let firstLoad = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      if (firstLoad) setSessionsLoading(true)
      try {
        const groups = await Promise.all(
          connectorIds.map(async (connectorId) => {
            const sessions: AgentSession[] = []
            const cursors = new Set<string>()
            let cursor: string | null = null
            do {
              const parameters = new URLSearchParams({ paged: "1" })
              if (cursor) parameters.set("cursor", cursor)
              const page = await api<{
                sessions: AgentSession[]
                nextCursor: string | null
              } | AgentSession[]>(
                `/api/connectors/${encodeURIComponent(connectorId)}/sessions?${parameters}`,
              )
              if (!active) return []
              if (Array.isArray(page)) {
                if (page.length >= 500) throw new Error("Relay update required: Session pagination is unavailable.")
                sessions.push(...page)
                break
              }
              sessions.push(...page.sessions)
              cursor = page.nextCursor
              if (cursor && cursors.has(cursor)) throw new Error("Session pagination returned a repeated cursor.")
              if (cursor) cursors.add(cursor)
            } while (cursor)
            return sessions
          }),
        )
        if (active) {
          setAgentSessions(groups.flat())
          setSessionsLoadedForKey(connectorIdKey)
          setSessionsRefreshFailed(false)
        }
      } catch (caught) {
        if (active && caught instanceof Error) {
          setSessionsRefreshFailed(true)
          setError(caught.message)
        }
      } finally {
        polling = false
        if (active && firstLoad) setSessionsLoading(false)
        firstLoad = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account, connectorIdKey, sessionRefreshAttempt])
  const retryRefresh = () => {
    setSessionRefreshAttempt((attempt) => attempt + 1)
    void refresh()
  }

  useEffect(() => {
    if (
      !account
      || loading
      || workspaceView !== "session"
      || sessionsLoading
      || sessionsLoadedForKey !== connectorIdKey
    ) {
      return
    }
    if (
      selection
      && agentSessions.some(
        (session) =>
          session.connectorId === selection.connectorId
          && session.id === selection.sessionId,
      )
    ) {
      return
    }
    if (selection) {
      selectionUnavailable.current = true
      // oxlint-disable-next-line react/set-state-in-effect -- A completed remote inventory invalidates this selection.
      setError("The selected Session is no longer available. Choose another Session.")
      // oxlint-disable-next-line react/set-state-in-effect -- Removed remote work must not keep an accessible workspace.
      setSelection(null)
      updateLocationSelection(null, "replace")
      return
    }
    if (selectionUnavailable.current) return
    const requested = selectionFromLocation()
    const requestedSession = requested
      ? agentSessions.find(
          (session) =>
            session.connectorId === requested.connectorId
            && session.id === requested.sessionId,
        )
      : null
    const fallback = requestedSession ?? agentSessions.find((session) =>
      connectors.some((connector) => connector.id === session.connectorId && connector.status === "online")
      && !["closed", "gone"].includes(session.status),
    ) ?? null
    // oxlint-disable-next-line react/set-state-in-effect -- A replacement Session restores the default transcript filters.
    setShowToolEvents(false)
    // oxlint-disable-next-line react/set-state-in-effect -- Selection follows the latest remote Session index.
    setSelection(
      fallback
        ? { connectorId: fallback.connectorId, sessionId: fallback.id }
        : null,
    )
    if (requested && !requestedSession) updateLocationSelection(null, "replace")
  }, [
    account,
    loading,
    agentSessions,
    connectorIdKey,
    connectors,
    selection,
    sessionsLoadedForKey,
    sessionsLoading,
    workspaceView,
  ])

  const applyRoute = useCallback((
    view: WorkspaceView,
    nextSelection: SessionSelection | null,
  ) => {
    if (routeRef.current !== view) {
      settingsVisit.current++
      setRevealedToken(null)
      setDeviceFormOpen(false)
      setDeviceName("My device")
      setExpiresInDays("90")
    }
    const sameSession = selection?.connectorId === nextSelection?.connectorId
      && selection?.sessionId === nextSelection?.sessionId
    if (!sameSession) setShowToolEvents(false)
    routeRef.current = view
    focusDestination.current = true
    setWorkspaceView(view)
    setNavigationRevision((revision) => revision + 1)
    setSelection(nextSelection)
    setMobileView(nextSelection ? "session" : "list")
    setDrawerOpen(false)
  }, [selection])

  const navigate = useCallback((
    view: Exclude<WorkspaceView, "not-found">,
    nextSelection: SessionSelection | null,
    hash = "",
  ) => {
    const url = workspaceUrl(window.location.href, view, nextSelection, hash)
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
      window.history.pushState({}, "", url)
    }
    applyRoute(view, nextSelection)
  }, [applyRoute])

  const openSettings = useCallback((devices = false) => {
    navigate("settings", selection, devices ? "devices" : "")
    if (!devices) settingsPageRef.current?.scrollTo({ top: 0 })
  }, [navigate, selection])

  useEffect(() => {
    const handlePopState = () => {
      selectionUnavailable.current = false
      const next = workspaceRoute(window.location)
      applyRoute(next.view, next.selection)
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [applyRoute])

  const selectAgentSession = useCallback((session: AgentSession) => {
    selectionUnavailable.current = false
    const nextSelection = {
      connectorId: session.connectorId,
      sessionId: session.id,
    }
    navigate("session", nextSelection)
  }, [navigate])

  const openSessionList = useCallback(() => {
    if (routeRef.current !== "session") {
      navigate("session", null)
      return
    }
    setMobileView("list")
    updateLocationSelection(null, "push")
  }, [navigate])

  const selectedSessionAvailable = Boolean(
    selectedConnectorId
    && selectedSessionId
    && agentSessions.some(
      (session) =>
        session.connectorId === selectedConnectorId
        && session.id === selectedSessionId,
    ),
  )
  const selectedConnector = useMemo(
    () =>
      connectors.find((connector) => connector.id === selectedConnectorId)
      ?? null,
    [connectors, selectedConnectorId],
  )
  const selectedAgentSession = useMemo(
    () =>
      agentSessions.find(
        (session) =>
          session.connectorId === selectedConnectorId
          && session.id === selectedSessionId,
      ) ?? null,
    [agentSessions, selectedConnectorId, selectedSessionId],
  )
  const selectedSessionArchived = selectedAgentSession
    ? sessionIsArchived(selectedAgentSession)
    : false
  const transcriptItems = useMemo(
    () => buildTranscript(events),
    [events],
  )
  const toolEventCount = useMemo(
    () => transcriptToolCount(transcriptItems),
    [transcriptItems],
  )
  const visibleTranscriptItems = useMemo(
    () =>
      transcriptItems.filter((item) =>
        transcriptItemIsVisible(item, showToolEvents)
      ),
    [showToolEvents, transcriptItems],
  )
  const toolEventToggleLabel = showToolEvents
    ? "Hide tool messages"
    : `Show ${toolEventCount} tool ${
      toolEventCount === 1 ? "message" : "messages"
    }`
  const canSyncSelectedHistory = !devicesRefreshFailed && !sessionsRefreshFailed
    && selectedConnector?.status === "online"
    && selectedConnector.capabilities.streamEvents

  useEffect(() => {
    if (
      !accountSessionId
      || !selectedConnectorId
      || !selectedSessionId
      || !selectedSessionAvailable
      || !canSyncSelectedHistory
    ) {
      return
    }
    let active = true
    const connectorId = encodeURIComponent(selectedConnectorId)
    const sessionId = encodeURIComponent(selectedSessionId)
    const requestHistory = async () => {
      if (historyRequests.current.has(selectionKey)) return
      historyRequests.current.add(selectionKey)
      setHistorySyncFailure((current) =>
        current?.key === selectionKey ? null : current
      )
      try {
        const result = await api<HistorySyncResponse>(
          `/api/connectors/${connectorId}/sessions/${sessionId}/events/sync`,
          { method: "POST" },
        )
        if (active && result.command?.type === "session.history") {
          setTrackedCommand({
            id: result.command.id,
            label: "History sync",
            status: result.command.status,
            historyRequestKey: selectionKey,
          })
        }
      } catch (caught) {
        historyRequests.current.delete(selectionKey)
        if (active && caught instanceof Error) {
          setHistorySyncFailure({ key: selectionKey, message: caught.message })
        }
      }
    }
    void requestHistory()
    return () => { active = false }
  }, [
    accountSessionId,
    canSyncSelectedHistory,
    selectedConnectorId,
    selectedSessionAvailable,
    selectedSessionId,
    selectionKey,
    historySyncAttempt,
  ])

  useEffect(() => {
    if (
      !accountSessionId
      || !selectedConnectorId
      || !selectedSessionId
      || !selectedSessionAvailable
    ) {
      return
    }
    let active = true
    let after = -1
    let loadedEvents: AgentSessionEvent[] = []
    let polling = false
    const connectorId = encodeURIComponent(selectedConnectorId)
    const sessionId = encodeURIComponent(selectedSessionId)
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const result = await api<{
          events: AgentSessionEvent[]
          nextAfter: number
        }>(
          `/api/connectors/${connectorId}/sessions/${sessionId}/events?after=${after}`,
        )
        if (!active) return
        if (result.events.length > 0) {
          loadedEvents = [...loadedEvents, ...result.events]
          after = result.nextAfter
        }
        setHistory({ key: selectionKey, events: loadedEvents })
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    accountSessionId,
    selectedConnectorId,
    selectedSessionAvailable,
    selectedSessionId,
    selectionKey,
  ])

  const connectorById = useMemo(
    () => new Map<string, SessionSource>(connectors.map((connector) => [
      connector.id,
      {
        ...connector,
        status: devicesRefreshFailed || sessionsRefreshFailed ? "unknown" : connector.status,
      },
    ])),
    [connectors, devicesRefreshFailed, sessionsRefreshFailed],
  )
  const activeTokenByDevice = useMemo(
    () =>
      new Map(
        tokens
          .filter((token) => !token.revokedAt)
          .map((token) => [token.deviceId, token]),
      ),
    [tokens],
  )
  const sessionStatusCounts = useMemo(
    () => deriveSessionFacets(agentSessions, connectorById, {
      query: sessionQuery, showEnded: showEndedSessions, showUnavailable: showUnavailableSessions,
    }),
    [agentSessions, connectorById, sessionQuery, showEndedSessions, showUnavailableSessions],
  )
  const visibleAgentSessions = useMemo(
    () =>
      deriveVisibleSessions(agentSessions, connectorById, {
        query: sessionQuery,
        statusView: sessionStatusView,
        showEnded: showEndedSessions,
        showUnavailable: showUnavailableSessions,
        showOffline: showOfflineSessions,
        collapsedSessionKeys,
      }),
    [
      agentSessions,
      collapsedSessionKeys,
      connectorById,
      sessionQuery,
      sessionStatusView,
      showEndedSessions,
      showUnavailableSessions,
      showOfflineSessions,
    ],
  )
  const sessionDeviceGroups = useMemo(
    () => groupSessionsByDevice(visibleAgentSessions, connectorById),
    [connectorById, visibleAgentSessions],
  )
  const visibleSessionCount = useMemo(() => deriveVisibleSessions(
    agentSessions, connectorById, {
      query: sessionQuery, statusView: sessionStatusView,
      showEnded: showEndedSessions, showUnavailable: showUnavailableSessions,
      showOffline: showOfflineSessions,
    },
  ).filter((item) => !item.isContext).length, [
    agentSessions, connectorById, sessionQuery, sessionStatusView,
    showEndedSessions, showUnavailableSessions, showOfflineSessions,
  ])
  const hasCustomSessionView =
    showEndedSessions || showUnavailableSessions || showOfflineSessions || deviceGroupingEnabled
  const selectedSource = selectedConnectorId ? connectorById.get(selectedConnectorId) : undefined
  const selectedDisplayStatus = selectedAgentSession
    ? sessionDisplayStatus(selectedAgentSession, selectedSource) : "unknown"
  const selectedConfirmationCurrent = selectedAgentSession
    ? sessionConfirmationIsCurrent(selectedAgentSession, selectedSource) : false
  const showOfflineShortcut = sessionStatusCounts.offline > 0
    && (!showOfflineSessions || sessionStatusView !== "all")
    && (sessionQuery.trim().length > 0 || visibleSessionCount === 0 || sessionStatusView !== "all")
  const revealOfflineHistory = () => {
    updateViewPreference("showOffline", true)
    setSessionStatusView("all")
  }
  const toggleSessionCollapsed = useCallback((session: AgentSession) => {
    const key = sessionKey(session)
    setCollapsedSessionKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleDeviceExpanded = useCallback((connectorId: string) => {
    setExpandedDeviceIds((current) => {
      const next = new Set(current)
      if (next.has(connectorId)) next.delete(connectorId)
      else next.add(connectorId)
      return next
    })
  }, [])
  useEffect(() => {
    if (!deviceGroupingEnabled || !accountId) {
      initializedDeviceGrouping.current = null
      return
    }
    if (initializedDeviceGrouping.current === accountId || sessionDeviceGroups.length === 0) return
    initializedDeviceGrouping.current = accountId
    // oxlint-disable-next-line react/set-state-in-effect -- Initialize restored or newly enabled grouping once its device data is available.
    setExpandedDeviceIds((current) => {
      if (current.size > 0) return current
      const preferred = sessionDeviceGroups.find((group) => group.source.id === selectedConnectorId)?.source.id
        ?? sessionDeviceGroups[0]?.source.id
      return preferred ? new Set([preferred]) : current
    })
  }, [
    accountId,
    deviceGroupingEnabled,
    selectedConnectorId,
    sessionDeviceGroups,
  ])
  const onlineCreateConnectors = useMemo(
    () =>
      devicesRefreshFailed || sessionsRefreshFailed ? [] : connectors.filter(
        (connector) =>
          connector.status === "online"
          && connector.capabilities.createSession,
      ),
    [connectors, devicesRefreshFailed, sessionsRefreshFailed],
  )
  const newSessionConnector = useMemo(
    () =>
      onlineCreateConnectors.find(
        (connector) => connector.id === newSessionConnectorId,
      ) ?? null,
    [newSessionConnectorId, onlineCreateConnectors],
  )
  const canSendFollowUp = selectedConfirmationCurrent
    && selectedAgentSession?.capabilityConfirmed === true
    && selectedConnector?.status === "online"
    && selectedConnector.capabilities.sendMessage
    && selectedAgentSession?.canSendMessage !== false
  const hasCurrentPendingInput = selectedConfirmationCurrent
    && selectedAgentSession?.executionStateKnown === true
    && selectedAgentSession.status === "waiting"
  const pendingInputRequest = hasCurrentPendingInput
    ? selectedAgentSession.pendingInputRequest
    : null
  const pendingInputAllowsCustomAnswer =
    pendingInputRequest?.questions.some(allowsCustomAnswer) ?? false

  useEffect(() => {
    if (!accountId) return
    const owner = accountId
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        await Promise.all(drafts.pending(owner).map(async (draft) => {
          const commandId = draft.pending?.commandId
          if (!commandId) return
          try {
            const result = await api<CommandStatus>(
              `/api/commands/${encodeURIComponent(commandId)}`,
            )
            if (!active || accountRef.current?.user.id !== owner) return
            if (
              result.connectorId !== draft.selection.connectorId
              || result.sessionId !== draft.selection.sessionId
              || result.type !== "session.message"
            ) {
              throw new Error("The follow-up receipt does not match its Session.")
            }
            if (result.status === "succeeded" || result.status === "failed") {
              drafts.finish(owner, draft.selection, commandId, result.status === "succeeded")
              setDraftRevision((revision) => revision + 1)
              if (result.status === "failed") {
                setError(result.error?.message ?? result.error?.code ?? "Follow-up failed.")
                setNotice(null)
              } else {
                setNotice("Follow-up completed.")
              }
            } else {
              if (result.status === "unknown") setNotice(null)
              if (drafts.status(owner, draft.selection, commandId, result.status)) {
                setDraftRevision((revision) => revision + 1)
              }
            }
          } catch (caught) {
            if (active && accountRef.current?.user.id === owner) {
              setError(caught instanceof Error ? caught.message : "Follow-up status could not be checked.")
            }
          }
        }))
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [accountId, drafts, pendingCommandKey])
  const trackedCommandId = trackedCommand?.id ?? null
  const trackedCommandLabel = trackedCommand?.label ?? null
  const trackedHistoryRequestKey = trackedCommand?.historyRequestKey ?? null

  useEffect(() => {
    if (!trackedCommandId || !trackedCommandLabel) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await api<CommandStatus>(
          `/api/commands/${encodeURIComponent(trackedCommandId)}`,
        )
        if (!active) return
        if (result.status === "succeeded") {
          if (timer !== undefined) window.clearInterval(timer)
          setTrackedCommand(null)
          setNotice(`${trackedCommandLabel} completed.`)
          if (trackedHistoryRequestKey) {
            setHistorySyncFailure((current) =>
              current?.key === trackedHistoryRequestKey ? null : current
            )
          }
          setError(null)
          return
        }
        if (result.status === "unknown" && trackedHistoryRequestKey) {
          setTrackedCommand(null)
          historyRequests.current.delete(trackedHistoryRequestKey)
          setHistorySyncFailure({
            key: trackedHistoryRequestKey,
            message: "History sync result is not confirmed. You can retry this read-only sync.",
          })
          return
        }
        if (result.status === "failed") {
          if (timer !== undefined) window.clearInterval(timer)
          setTrackedCommand(null)
          const message = result.error?.message
            || result.error?.code
            || `${trackedCommandLabel} failed.`
          setNotice(null)
          if (trackedHistoryRequestKey) {
            historyRequests.current.delete(trackedHistoryRequestKey)
            setHistorySyncFailure({
              key: trackedHistoryRequestKey,
              message,
            })
          } else {
            setError(message)
          }
          return
        }
        if (result.status === "unknown") setNotice(null)
        setTrackedCommand((current) =>
          current?.id === result.id
            ? { ...current, status: result.status }
            : current
        )
      } catch (caught) {
        if (active && caught instanceof Error) setError(caught.message)
      }
    }
    void poll()
    timer = window.setInterval(() => void poll(), 1_000)
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [trackedCommandId, trackedCommandLabel, trackedHistoryRequestKey])

  function openNewSession() {
    const preferred =
      onlineCreateConnectors.find(
        (connector) => connector.id === selectedConnectorId,
      ) ?? onlineCreateConnectors[0] ?? null
    setNewSessionConnectorId(preferred?.id ?? null)
    setNewSessionOpen(true)
  }

  async function createAgentSession(event: React.FormEvent) {
    event.preventDefault()
    if (!newSessionConnector || !sessionPrompt.trim() || activeCommand) return
    setBusyAction("create-session")
    setNotice(null)
    setError(null)
    const epoch = authEpoch.current
    try {
      const connectorId = encodeURIComponent(newSessionConnector.id)
      const result = await api<CommandResponse>(
        `/api/connectors/${connectorId}/sessions`,
        {
          method: "POST",
          body: JSON.stringify({
            prompt: sessionPrompt.trim(),
            ...(sessionTitle.trim() ? { title: sessionTitle.trim() } : {}),
          }),
        },
      )
      if (epoch !== authEpoch.current) return
      setSessionTitle("")
      setSessionPrompt("")
      setNewSessionOpen(false)
      setTrackedCommand({
        id: result.command.id,
        label: "Session",
        status: result.command.status,
      })
      setNotice(`Starting a Session on ${newSessionConnector.displayName}...`)
    } catch (caught) {
      if (epoch === authEpoch.current) setError(
        caught instanceof Error ? caught.message : "Session creation failed",
      )
    } finally {
      if (epoch === authEpoch.current) setBusyAction(null)
    }
  }

  async function sendFollowUp(event: React.FormEvent) {
    event.preventDefault()
    if (
      !selectedConnector
      || !selectedAgentSession
      || !canSendFollowUp
      || !followUp.trim()
      || !accountId
      || !selection
      || activeCommand
      || busyAction === "send-message"
    ) {
      return
    }
    setBusyAction("send-message")
    setNotice(null)
    setError(null)
    const owner = accountId
    const source = selection
    const epoch = authEpoch.current
    const submitted = drafts.begin(owner, source)
    setDraftRevision((revision) => revision + 1)
    try {
      const connectorId = encodeURIComponent(selectedConnector.id)
      const sessionId = encodeURIComponent(selectedAgentSession.id)
      const result = await api<CommandResponse>(
        `/api/connectors/${connectorId}/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message: followUp.trim(),
            connectionId: selectedConnector.connectionId,
          }),
        },
      )
      if (epoch !== authEpoch.current) return
      drafts.accept(owner, source, submitted.version, result.command.id, result.command.status)
      setDraftRevision((revision) => revision + 1)
      setNotice("Delivering your follow-up...")
    } catch (caught) {
      if (epoch !== authEpoch.current) return
      drafts.failRequest(owner, source, submitted.version)
      setDraftRevision((revision) => revision + 1)
      setError(
        caught instanceof Error ? caught.message : "Message delivery failed",
      )
    } finally {
      if (epoch === authEpoch.current) setBusyAction(null)
    }
  }

  async function retrySessionState() {
    if (!selectedConnectorId) return
    const epoch = authEpoch.current
    setBusyAction("sync-state")
    setError(null)
    try {
      const result = await api<CommandResponse>(
        `/api/connectors/${encodeURIComponent(selectedConnectorId)}/sessions/sync`,
        { method: "POST", body: "{}" },
      )
      if (epoch !== authEpoch.current) return
      setTrackedCommand({ id: result.command.id, label: "Session state sync", status: result.command.status })
      setNotice("Confirming current Session state and capabilities.")
    } catch (caught) {
      if (epoch === authEpoch.current) {
        setError(caught instanceof Error ? caught.message : "Session state sync failed.")
      }
    } finally {
      if (epoch === authEpoch.current) setBusyAction(null)
    }
  }

  function cancelDeviceForm() {
    restoreAddDeviceFocus.current = true
    setDeviceFormOpen(false)
    setDeviceName("My device")
    setExpiresInDays("90")
  }

  async function createConnectionToken(event: React.FormEvent) {
    event.preventDefault()
    if (!deviceName.trim()) {
      setError("Enter a device name.")
      return
    }
    const epoch = authEpoch.current
    const visit = settingsVisit.current
    setBusyAction("create-token")
    setError(null)
    try {
      const result = await api<{ token: string; metadata: ConnectionToken }>(
        "/api/tokens",
        {
          method: "POST",
          body: JSON.stringify({
            name: deviceName,
            expiresInDays: expiresInDays ? Number(expiresInDays) : null,
          }),
        },
      )
      if (epoch !== authEpoch.current) return
      if (visit === settingsVisit.current && routeRef.current === "settings") {
        setRevealedToken(
          `version: 1\nrelay: ${relayOrigin}\ntoken: ${result.token}\n`,
        )
        cancelDeviceForm()
      } else {
        setNotice("Device created. Return to Settings to rotate its token if you did not copy the profile.")
      }
      await refresh()
    } catch (caught) {
      if (epoch === authEpoch.current) {
        setError(caught instanceof Error ? caught.message : "Token creation failed")
      }
    } finally {
      if (epoch === authEpoch.current) setBusyAction(null)
    }
  }

  async function revokeConnectionToken(id: string) {
    const epoch = authEpoch.current
    setError(null)
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" })
      if (epoch !== authEpoch.current) return
      await refresh()
    } catch (caught) {
      if (epoch === authEpoch.current) setError(
        caught instanceof Error ? caught.message : "Token revocation failed",
      )
    }
  }

  async function rotateConnectionToken(id: string) {
    const epoch = authEpoch.current
    const visit = settingsVisit.current
    setBusyAction(`rotate-token:${id}`)
    setError(null)
    try {
      const result = await api<{ token: string }>(
        `/api/tokens/${id}/rotate`,
        { method: "POST" },
      )
      if (epoch !== authEpoch.current) return
      if (visit === settingsVisit.current && routeRef.current === "settings") {
        setRevealedToken(
          `version: 1\nrelay: ${relayOrigin}\ntoken: ${result.token}\n`,
        )
      } else {
        setNotice("Token rotated. Return to Settings to rotate again if you did not copy the profile.")
      }
      await refresh()
    } catch (caught) {
      if (epoch === authEpoch.current) setError(
        caught instanceof Error ? caught.message : "Token rotation failed",
      )
    } finally {
      if (epoch === authEpoch.current) setBusyAction(null)
    }
  }

  async function logout() {
    const epoch = authEpoch.current
    setError(null)
    try {
      await api("/api/logout", { method: "POST" })
      if (epoch === authEpoch.current) clearAuthenticatedState()
    } catch (caught) {
      if (epoch === authEpoch.current) {
        setError(caught instanceof Error ? caught.message : "Sign out failed")
      }
    }
  }

  async function copyRevealedToken() {
    if (!revealedToken) return
    const epoch = authEpoch.current
    try {
      await navigator.clipboard.writeText(revealedToken)
      if (epoch !== authEpoch.current) return
      setNotice("Connection token copied.")
      setError(null)
    } catch (caught) {
      if (epoch === authEpoch.current) {
        setError(caught instanceof Error ? caught.message : "Copy failed")
      }
    }
  }

  async function unlinkIdentity(provider: Provider) {
    const epoch = authEpoch.current
    setError(null)
    try {
      await api(`/api/identities/${provider}`, { method: "DELETE" })
      if (epoch !== authEpoch.current) return
      await refresh()
    } catch (caught) {
      if (epoch === authEpoch.current) setError(
        caught instanceof Error ? caught.message : "Identity unlink failed",
      )
    }
  }

  if (loading) {
    return <LoginPage error={null} loading />
  }

  if (!account) {
    return (
      <LoginPage
        error={error}
        loading={false}
        draftWarning={draftWarning}
        returnTo={isSettings || selection
          ? workspaceUrl(window.location.href, isSettings ? "settings" : "session", selection)
          : undefined}
      />
    )
  }

  const accountName =
    account.user.displayName
    ?? account.identities[0]?.displayName
    ?? account.identities[0]?.email
    ?? "Relay user"
  const accountDetail =
    account.identities.find((identity) => identity.email)?.email
    ?? "Signed in"
  const onlineConnectorCount = connectors.filter(
    (connector) => connector.status === "online",
  ).length

  const renderSessionRow = (
    item: OrderedSession<AgentSession>,
    groupedByDevice: boolean,
  ) => {
    const { session } = item
    const connector = connectorById.get(session.connectorId)
    const displayStatus = sessionDisplayStatus(session, connector)
    const executionStateCurrent = sessionConfirmationIsCurrent(session, connector)
      && session.executionStateKnown === true
    const isSelected =
      !isSettings
      && session.connectorId === selectedConnectorId
      && session.id === selectedSessionId
    const isCollapsed = collapsedSessionKeys.has(sessionKey(session))
    const preview = executionStateCurrent ? sessionPreview(session) : session.lastMessagePreview
    return (
      <div
        key={`${session.connectorId}:${session.id}`}
        className={`session-list-item${isSelected ? " is-selected" : ""}${item.isSubsession ? " is-subsession" : ""}${item.hasChildren ? " has-children" : ""}${item.isLastChild ? " is-last-child" : ""}${item.isContext ? " is-context" : ""}`}
      >
        <span className="session-tree-control">
          <span
            className="session-state-dot"
            data-status={displayStatus}
            aria-hidden="true"
          />
          {item.hasChildren && (
            <button
              type="button"
              className="session-tree-toggle"
              onClick={() => toggleSessionCollapsed(session)}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${
                sessionLabel(session)
              }`}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed
                ? <ChevronRight aria-hidden="true" />
                : <ChevronDown aria-hidden="true" />}
            </button>
          )}
        </span>
        <button
          type="button"
          className="session-item-select"
          onClick={() => selectAgentSession(session)}
          aria-current={isSelected ? "page" : undefined}
        >
          <span className="session-item-main">
            <span className="session-item-title-line">
              <span className="session-item-title">
                {sessionLabel(session)}
              </span>
              {item.hasChildren && (
                <span className="session-child-count" aria-label="Has children">
                  {
                    visibleAgentSessions.filter((candidate) =>
                      candidate.session.connectorId === session.connectorId
                      && candidate.session.parentSessionId === session.id
                    ).length
                  }
                </span>
              )}
              {item.isContext && (
                <span className="session-context-label">Context</span>
              )}
            </span>
            <span
              className="session-item-meta"
              title={executionStateCurrent && session.nativeStatus
                ? `Agent status: ${session.nativeStatus}`
                : undefined}
            >
              <span className="session-item-status">
                {sessionStatusLabel(displayStatus)}
              </span>
              {!groupedByDevice && (
                <span className="device-tag">
                  <Laptop aria-hidden="true" />
                  {connector?.displayName ?? "Unknown device"}
                </span>
              )}
            </span>
            {preview && !item.isContext && (
              <span className="session-item-preview">
                {preview}
              </span>
            )}
          </span>
          <time
            className="session-item-time"
            dateTime={session.lastActivityAt}
            title={formatTime(session.lastActivityAt)}
          >
            {formatRelativeTime(session.lastActivityAt)}
          </time>
        </button>
      </div>
    )
  }

  return (
    <>
      <main className={`relay-app mobile-view-${mobileView} workspace-view-${workspaceView}`}>
        <header className="relay-brand">
          <RelayMark />
          <div className="brand-lockup">
            <strong>Silvermoon</strong>
            <span>Relay</span>
          </div>
        </header>

        <header className="session-topbar">
          <div className="mobile-topbar-context">
            {isSettings ? (
              <button
                ref={openSessionsRef}
                type="button"
                className="mobile-back-button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open Sessions"
                aria-expanded={drawerOpen}
              >
                <Menu aria-hidden="true" />
              </button>
            ) : mobileView === "session" && (
              <button
                type="button"
                className="mobile-back-button"
                onClick={openSessionList}
                aria-label="Back to Sessions"
              >
                <ArrowLeft aria-hidden="true" />
              </button>
            )}
            <RelayMark compact />
            <h1 ref={mobileHeadingRef} tabIndex={-1}>
              {isSettings ? "Settings" : mobileView === "session" ? "Session" : "Sessions"}
            </h1>
          </div>

          <div className="desktop-session-context">
            {isSettings
              ? <div className="session-heading-copy"><h1 ref={desktopHeadingRef} tabIndex={-1}>Settings</h1><span>Account and connections</span></div>
              : selectedAgentSession
              ? (
                  <>
                    <div className="session-heading-copy">
                      <h1 ref={desktopHeadingRef} tabIndex={-1}>{sessionLabel(selectedAgentSession)}</h1>
                      <span>
                        {selectedConnector?.displayName
                          ?? "Unknown device"}
                      </span>
                    </div>
                    <SessionStatus
                      status={selectedDisplayStatus}
                      nativeStatus={selectedConfirmationCurrent && selectedAgentSession.executionStateKnown
                        ? selectedAgentSession.nativeStatus : null}
                    />
                  </>
                )
              : (
                  <div className="session-heading-copy">
                    <h1 ref={desktopHeadingRef} tabIndex={-1}>Select a Session</h1>
                    <span>Choose active work from the Session list</span>
                  </div>
                )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="account-trigger"
                aria-label={`Account menu for ${accountName}`}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.user.avatarUrl
                    ? <img src={account.user.avatarUrl} alt="" />
                    : initials(accountName)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="account-menu"
              onCloseAutoFocus={(event) => {
                if (accountMenuNavigated.current) {
                  event.preventDefault()
                  accountMenuNavigated.current = false
                }
              }}
            >
              <DropdownMenuLabel>
                <span className="account-menu-name">{accountName}</span>
                <span className="account-menu-detail">{accountDetail}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => {
                accountMenuNavigated.current = true
                openSettings()
              }}>
                <Settings aria-hidden="true" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void logout()}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <SessionNavigation
          inDrawer={isSettings && narrowViewport}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          restoreFocus={() => {
            if (routeRef.current === "settings" && window.location.hash === "#devices") {
              settingsPageRef.current?.querySelector<HTMLElement>("#settings-devices")?.focus()
            } else if (routeRef.current === "settings") openSessionsRef.current?.focus()
            else (narrowViewport ? mobileHeadingRef : desktopHeadingRef).current?.focus()
          }}
        >
        <aside className="session-rail" aria-label="Sessions">
          <div className="session-rail-heading">
            <div>
              <h2>Sessions</h2>
              <p>
                {visibleSessionCount} matching {visibleSessionCount === 1 ? "Session" : "Sessions"}
                {showOfflineSessions && sessionStatusView === "all" && sessionStatusCounts.offline > 0
                  ? ` · ${sessionStatusCounts.offline} offline history` : ""}
                {sessionStatusView === "all" && sessionStatusCounts.pending > 0 ? ` · ${sessionStatusCounts.pending} state unconfirmed` : ""}
              </p>
            </div>
            <Button
              size="icon"
              className="new-session-button"
              onClick={openNewSession}
              disabled={onlineCreateConnectors.length === 0}
              title={
                onlineCreateConnectors.length === 0
                  ? "No online Device can create Sessions"
                  : "New Session"
              }
            >
              <Plus aria-hidden="true" />
              <span className="sr-only">New Session</span>
            </Button>
          </div>

          <div className="session-rail-tools">
            <label className="session-search">
              <Search aria-hidden="true" />
              <Input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Search Sessions, Agents, Devices"
                aria-label="Search Sessions, Agents, and Devices"
              />
            </label>
            <div className="session-filters" aria-label="Session filters">
              <button
                type="button"
                aria-pressed={sessionStatusView === "all"}
                onClick={() => setSessionStatusView("all")}
              >
                All
              </button>
              {(sessionStatusCounts.active > 0 || sessionStatusView === "active") && (
                <button
                  type="button"
                  aria-pressed={sessionStatusView === "active"}
                  onClick={() => setSessionStatusView("active")}
                >
                  Active {sessionStatusCounts.active}
                </button>
              )}
              {(sessionStatusCounts.waiting > 0 || sessionStatusView === "waiting") && (
                <button
                  type="button"
                  className="is-waiting"
                  aria-pressed={sessionStatusView === "waiting"}
                  onClick={() => setSessionStatusView("waiting")}
                >
                  Needs input {sessionStatusCounts.waiting}
                </button>
              )}
              {(sessionStatusCounts.failed > 0 || sessionStatusView === "failed") && (
                <button
                  type="button"
                  className="is-failed"
                  aria-pressed={sessionStatusView === "failed"}
                  onClick={() => setSessionStatusView("failed")}
                >
                  Failed {sessionStatusCounts.failed}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="session-view-trigger"
                    data-active={hasCustomSessionView || undefined}
                    aria-label="Session view options"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="session-view-menu"
                >
                  <DropdownMenuCheckboxItem
                    checked={showEndedSessions}
                    onCheckedChange={(checked) =>
                      updateViewPreference("showEnded", checked === true)}
                  >
                    Show ended
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUnavailableSessions}
                    onCheckedChange={(checked) =>
                      updateViewPreference("showUnavailable", checked === true)}
                  >
                    Show unavailable
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showOfflineSessions}
                    onCheckedChange={(checked) => updateViewPreference("showOffline", checked === true)}
                  >
                    Show offline Sessions ({devicesRefreshFailed || sessionsRefreshFailed
                      ? "unknown" : sessionStatusCounts.offline})
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={deviceGroupingEnabled}
                    onCheckedChange={(checked) =>
                      updateViewPreference("groupByDevice", checked === true)}
                  >
                    Group by Device
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {viewPreferencesWarning && (
            <div className="session-view-notice is-error" role="alert">
              <span>{viewPreferencesWarning}</span>
              <button type="button" aria-label="Dismiss view preferences warning" onClick={dismissViewPreferencesWarning}>Dismiss</button>
            </div>
          )}
          {(devicesRefreshFailed || sessionsRefreshFailed) && (
            <div className="session-view-notice is-error" role="alert">
              <strong>Unable to refresh Sessions</strong>
              <span>Showing saved content. Device and execution states are not confirmed.</span>
              <button type="button" onClick={retryRefresh}>Retry refresh</button>
            </div>
          )}
          {showOfflineShortcut && (
            <div className="session-view-notice" role="status">
              <span>{sessionStatusCounts.offline} matching offline Sessions are hidden.
                {sessionStatusView !== "all" ? " Current state filters do not include offline history." : ""}</span>
              <button type="button" onClick={revealOfflineHistory}>
                {sessionStatusView === "all" ? "View offline history" : "View offline history (switch to All)"}
              </button>
            </div>
          )}
          {!showOfflineShortcut && !showOfflineSessions && sessionStatusCounts.offline > 0 && (
            <p className="session-hidden-hint">{sessionStatusCounts.offline} offline Sessions hidden · View options</p>
          )}
          <div className="session-list">
            {sessionsLoading && agentSessions.length === 0 && (
              <div className="session-list-state" role="status">
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                <strong>Loading Sessions</strong>
                <span>Reading recent work from your Devices.</span>
              </div>
            )}

            {!sessionsLoading && !sessionsRefreshFailed && !devicesRefreshFailed && agentSessions.length === 0 && (
              <div className="session-list-state">
                <Laptop aria-hidden="true" />
                <strong>No Sessions yet</strong>
                <span>
                  Bring a Device online, then start the first Session.
                </span>
                {onlineCreateConnectors.length > 0 && (
                  <Button size="sm" onClick={openNewSession}>
                    <Plus aria-hidden="true" />
                    New Session
                  </Button>
                )}
              </div>
            )}

            {agentSessions.length > 0 && visibleAgentSessions.length === 0 && (
              <div className="session-list-state">
                <Search aria-hidden="true" />
                <strong>{sessionStatusCounts.offline > 0 && !showOfflineSessions && !sessionQuery.trim() && sessionStatusView === "all"
                  ? "No online Sessions in this view"
                  : sessionStatusCounts.hiddenLifecycle > 0 ? "Some history is hidden by view options" : "No matching Sessions"}</strong>
                <span>{sessionStatusCounts.hiddenLifecycle > 0
                  ? "Show ended / Show unavailable controls also apply. Offline visibility does not override them."
                  : showOfflineShortcut ? "Your offline history is still available from the entry above." : "Try a different search or show all states."}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSessionQuery("")
                    setSessionStatusView("all")
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}

            {deviceGroupingEnabled
              ? sessionDeviceGroups.map((group) => {
                  const expanded = expandedDeviceIds.has(group.source.id)
                  const groupCounts = deriveSessionFacets(
                    agentSessions.filter((session) => session.connectorId === group.source.id),
                    connectorById,
                    { query: sessionQuery, showEnded: showEndedSessions, showUnavailable: showUnavailableSessions },
                  )
                  return (
                    <section
                      className="session-device-group"
                      key={group.source.id}
                      aria-labelledby={`device-${group.source.id}`}
                    >
                      <button
                        type="button"
                        className="session-device-heading"
                        onClick={() => toggleDeviceExpanded(group.source.id)}
                        aria-expanded={expanded}
                      >
                        {expanded
                          ? <ChevronDown aria-hidden="true" />
                          : <ChevronRight aria-hidden="true" />}
                        <strong id={`device-${group.source.id}`}>
                          {group.source.displayName}
                        </strong>
                        <span>{group.sessions.length}</span>
                        <span className="session-device-alerts">
                          {groupCounts.waiting > 0
                            && `${groupCounts.waiting} input`}
                          {groupCounts.waiting > 0 && groupCounts.failed > 0
                            && " · "}
                          {groupCounts.failed > 0
                            && `${groupCounts.failed} failed`}
                        </span>
                        <span
                          className="session-device-status"
                          data-status={group.source.status}
                        >
                          {group.source.status}
                        </span>
                      </button>
                      {expanded && group.sessions.map((item) =>
                        renderSessionRow(item, true)
                      )}
                    </section>
                  )
                })
              : visibleAgentSessions.map((item) =>
                  renderSessionRow(item, false)
                )}
          </div>

          <div className="session-rail-footer">
            <span>
              <span className="online-pin" aria-hidden="true" />
              {onlineConnectorCount} online
            </span>
            <button type="button" onClick={() => openSettings(true)}>
              {connectors.length === 1
                ? "1 Device"
                : `${connectors.length} Devices`}
            </button>
          </div>
        </aside>
        </SessionNavigation>

        {isSettings && (
          <SettingsPage
            pageRef={settingsPageRef}
            deviceNameRef={deviceNameRef}
            addDeviceRef={addDeviceRef}
            devices={connectors}
            tokens={activeTokenByDevice}
            identities={account.identities}
            providerLabels={providerLabels}
            deviceFormOpen={deviceFormOpen}
            setDeviceFormOpen={setDeviceFormOpen}
            deviceName={deviceName}
            setDeviceName={setDeviceName}
            expiresInDays={expiresInDays}
            setExpiresInDays={setExpiresInDays}
            busyAction={busyAction}
            revealedToken={revealedToken}
            hideToken={() => setRevealedToken(null)}
            createDevice={createConnectionToken}
            cancelDevice={cancelDeviceForm}
            rotateToken={rotateConnectionToken}
            revokeToken={revokeConnectionToken}
            unlinkIdentity={unlinkIdentity}
            copyProfile={copyRevealedToken}
            formatTime={formatTime}
            identityLink={(provider) =>
              `${relayOrigin}/auth/${provider}/start?mode=link&returnTo=${encodeURIComponent(
                workspaceUrl(window.location.href, "settings", selection),
              )}`}
          />
        )}

        <section className="session-workspace" aria-label="Session workspace" hidden={isSettings}>
          {workspaceView === "not-found"
            ? <div className="workspace-empty"><h2>Page not found</h2><Button onClick={openSessionList}>Open Sessions</Button></div>
            : !selectedAgentSession
            ? (
                <div className="workspace-empty">
                  <RelayMark />
                  <h2>Select a Session to continue</h2>
                  <p>
                    The Session list keeps work from every Device in one place.
                  </p>
                </div>
              )
            : (
                <>
                  <div className="mobile-session-meta">
                    <div>
                      <h1>{sessionLabel(selectedAgentSession)}</h1>
                      <span>
                        {selectedConnector?.displayName ?? "Unknown device"}
                      </span>
                    </div>
                    <SessionStatus
                      status={selectedDisplayStatus}
                      nativeStatus={selectedConfirmationCurrent && selectedAgentSession.executionStateKnown
                        ? selectedAgentSession.nativeStatus : null}
                    />
                  </div>

                  {["offline", "unknown-device", "syncing", "sync-failed", "unsupported", "unconfirmed"].includes(selectedDisplayStatus) && (
                    <div className={`session-connection-notice${selectedDisplayStatus === "sync-failed" ? " is-error" : ""}`}
                      role={selectedDisplayStatus === "sync-failed" ? "alert" : "status"}>
                      <strong>{sessionStatusLabel(selectedDisplayStatus)}</strong>
                      <span>{selectedDisplayStatus === "offline"
                        ? "The Device is unreachable. Read saved content or edit a local draft; reconnect and confirm capabilities to continue."
                        : selectedDisplayStatus === "unsupported"
                        ? "Update the connector to support current-connection confirmation. Saved content and local drafts remain available."
                        : selectedDisplayStatus === "sync-failed"
                        ? selectedSource?.sessionSyncError ?? "The current Session state could not be confirmed."
                        : selectedDisplayStatus === "unconfirmed"
                        ? "This Session was not confirmed in the current inventory. Its saved content may be incomplete."
                        : "Current Device or Session information is not confirmed. Saved content and local drafts remain available."}</span>
                      {selectedDisplayStatus === "offline" && !showOfflineSessions && (
                        <button type="button" onClick={revealOfflineHistory}>View offline history</button>
                      )}
                      {["sync-failed", "unconfirmed"].includes(selectedDisplayStatus) && (
                        <button type="button" onClick={() => void retrySessionState()}
                          disabled={busyAction === "sync-state" || Boolean(trackedCommand)}>
                          Retry state sync
                        </button>
                      )}
                      {selectedDisplayStatus === "unknown-device" && (
                        <button type="button" onClick={retryRefresh}>Refresh Device information</button>
                      )}
                    </div>
                  )}
                  {trackedCommand && (trackedCommand.status === "unknown" || selectedDisplayStatus === "offline") && (
                    <div className="session-connection-notice" role="status">
                      <strong>Command result not confirmed</strong>
                      <span>Reconnecting does not mean execution failed or succeeded. The command will not be resent automatically.</span>
                      <button type="button" onClick={() => {
                        setTrackedCommand(null)
                        setNotice("Stopped watching this result; its command record remains unconfirmed. Nothing was resent.")
                      }}>Stop watching this result</button>
                    </div>
                  )}
                  {currentDraft?.pending?.commandId && (
                    currentDraft.pending.status === "unknown" || selectedDisplayStatus === "offline"
                  ) && (
                    <div className="session-connection-notice" role="status">
                      <strong>Command result not confirmed</strong>
                      <span>Reconnecting does not mean execution failed or succeeded. The command will not be resent automatically.</span>
                      <button type="button" onClick={() => {
                        if (!accountId || !selection || !currentDraft.pending?.commandId) return
                        drafts.finish(accountId, selection, currentDraft.pending.commandId, false)
                        setDraftRevision((revision) => revision + 1)
                        setNotice("Stopped watching this result; its command record remains unconfirmed. Nothing was resent.")
                      }}>Stop watching this result</button>
                    </div>
                  )}
                  <TranscriptScroll key={selectionKey}>
                      <div className="transcript-origin">
                        <span>Session opened</span>
                        <time dateTime={selectedAgentSession.createdAt}>
                          {formatTime(selectedAgentSession.createdAt)}
                        </time>
                        <span>
                          on {selectedConnector?.displayName ?? "Unknown device"}
                        </span>
                        {toolEventCount > 0 && (
                          <button
                            type="button"
                            className="transcript-tool-toggle"
                            aria-pressed={showToolEvents}
                            aria-label={toolEventToggleLabel}
                            onClick={() =>
                              setShowToolEvents((visible) => !visible)}
                          >
                            <Wrench aria-hidden="true" />
                            {toolEventToggleLabel}
                          </button>
                        )}
                      </div>

                      {selectedSessionArchived && selectedConfirmationCurrent && (
                        <div className="history-state-notice" role="status">
                          <strong>This Session is archived and read-only.</strong>
                          <span>Its saved activity remains available.</span>
                        </div>
                      )}

                      {historySyncFailure?.key === selectionKey && (
                        <div
                          className="history-state-notice is-error"
                          role="alert"
                        >
                          <CircleAlert aria-hidden="true" />
                          <span>
                            <strong>History sync failed.</strong>
                            {historySyncFailure.message}
                          </span>
                          <button
                            type="button"
                            disabled={!canSyncSelectedHistory || Boolean(trackedCommand)}
                            onClick={() => {
                              historyRequests.current.delete(selectionKey)
                              setHistorySyncFailure(null)
                              setHistorySyncAttempt((attempt) => attempt + 1)
                            }}
                          >
                            Retry sync
                          </button>
                        </div>
                      )}

                      {events.length === 0 && (
                        <div className="transcript-empty" role="status">
                          {selectedDisplayStatus === "offline"
                            ? <WifiOff aria-hidden="true" />
                            : <LoaderCircle className="animate-spin" aria-hidden="true" />}
                          <strong>
                            {selectedDisplayStatus === "offline"
                              ? "Device is offline"
                              : !selectedConfirmationCurrent ? "No saved activity loaded" : "Waiting for activity"}
                          </strong>
                          <span>
                            {selectedDisplayStatus === "offline"
                              ? "Recent events remain available. Reconnect the Device to continue."
                              : !selectedConfirmationCurrent ? "Only synchronized content can be read until the Device is reachable and confirmed."
                              : "Events will appear here as the agent works."}
                          </span>
                        </div>
                      )}

                      {events.length > 0
                        && visibleTranscriptItems.length === 0 && (
                        <div
                          className="transcript-empty transcript-empty-filtered"
                          role="status"
                        >
                          <Wrench aria-hidden="true" />
                          <strong>Tool messages are hidden</strong>
                          <span>
                            Use the control above to inspect tool activity for
                            this Session.
                          </span>
                        </div>
                      )}

                      {visibleTranscriptItems.map((item) =>
                        item.kind === "turn"
                          ? (
                              <TranscriptTurnView
                                key={`turn:${item.id}`}
                                turn={item}
                                showTools={showToolEvents}
                              />
                            )
                          : (
                              <LegacyEventView
                                key={`event:${item.event.id}`}
                                event={item.event}
                              />
                            )
                      )}
                  </TranscriptScroll>

                  <div
                    className={`session-composer-shell${
                      hasCurrentPendingInput
                        ? " has-pending-input"
                        : ""
                    }`}
                  >
                    <form className="session-composer" onSubmit={sendFollowUp}>
                      {hasCurrentPendingInput && (
                        <PendingInputPanel
                          request={pendingInputRequest}
                          canReply={canSendFollowUp}
                          onChoose={(value) => {
                            if (!accountId || !selection) return
                            drafts.write(accountId, selection, value)
                            setDraftRevision((revision) => revision + 1)
                            window.requestAnimationFrame(() =>
                              followUpInputRef.current?.focus())
                          }}
                          onCustomAnswer={() => {
                            if (!accountId || !selection) return
                            drafts.write(accountId, selection, "")
                            setDraftRevision((revision) => revision + 1)
                            window.requestAnimationFrame(() =>
                              followUpInputRef.current?.focus())
                          }}
                        />
                      )}
                      <div className="composer-frame">
                        <label htmlFor="session-follow-up" className="sr-only">
                          Follow-up message
                        </label>
                        <Textarea
                          ref={followUpInputRef}
                          id="session-follow-up"
                          value={followUp}
                          onChange={(event) => {
                            if (!accountId || !selection) return
                            drafts.write(accountId, selection, event.target.value)
                            setDraftRevision((revision) => revision + 1)
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter"
                              && !event.shiftKey
                              && !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault()
                              event.currentTarget.form?.requestSubmit()
                            }
                          }}
                          placeholder={
                            selectedConfirmationCurrent && selectedAgentSession.canSendMessage === false
                              ? "This Session is read-only"
                              : hasCurrentPendingInput
                              ? pendingInputAllowsCustomAnswer
                                ? "Enter a custom answer... Shift+Enter for a new line."
                                : "Reply to the agent's request... Shift+Enter for a new line."
                              : canSendFollowUp
                              ? "Ask for the next step... Shift+Enter for a new line."
                              : "This Session cannot receive messages right now"
                          }
                          rows={2}
                          disabled={selectedConfirmationCurrent && selectedAgentSession.canSendMessage === false}
                        />
                        <div className="composer-toolbar">
                          <div className="composer-status" aria-live="polite">
                            {activeCommand
                              ? (
                                  <>
                                    <LoaderCircle
                                      className="animate-spin"
                                      aria-hidden="true"
                                    />
                                    {activeCommand.label}{" "}
                                    {activeCommand.status === "unknown" ? "result not confirmed" : activeCommand.status}
                                  </>
                                )
                              : selectedDisplayStatus === "offline"
                              ? (
                                  <>
                                    <WifiOff aria-hidden="true" />
                                    Reconnect {selectedConnector?.displayName ?? "the Device"} to
                                    send a follow-up.
                                  </>
                                )
                              : !canSendFollowUp
                              ? <span>Local draft only · sending is not available.</span>
                              : (
                                  <>
                                    <Laptop aria-hidden="true" />
                                    Send to{" "}
                                    {selectedConnector?.displayName
                                      ?? "current Device"}
                                  </>
                                )}
                          </div>
                          <Button
                            type="submit"
                            size="icon"
                            className="composer-send"
                            disabled={
                              !followUp.trim()
                              || !canSendFollowUp
                              || busyAction === "send-message"
                              || Boolean(activeCommand)
                            }
                          >
                            {busyAction === "send-message"
                              ? (
                                  <LoaderCircle
                                    className="animate-spin"
                                    aria-hidden="true"
                                  />
                                )
                              : <Send aria-hidden="true" />}
                            <span className="sr-only">Send follow-up</span>
                          </Button>
                        </div>
                        {currentDraft?.pending?.status === "unknown" && !currentDraft.pending.commandId && (
                          <div className="history-state-notice" role="status">
                            Delivery could not be confirmed after refreshing. Check the message stream before sending again.
                          </div>
                        )}
                      </div>
                    </form>
                  </div>
                </>
              )}
        </section>
      </main>

      <div className="relay-notifications" aria-live="polite">
        {draftWarning && (
          <div className="relay-notice is-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{draftWarning}</span>
            <button type="button" aria-label="Dismiss draft warning" onClick={() => setDraftWarning(null)}><X aria-hidden="true" /></button>
          </div>
        )}
        {error && (
          <div className="relay-notice is-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
        {!error && notice && (
          <div className="relay-notice is-success" role="status">
            {trackedCommand
              ? <LoaderCircle className="animate-spin" aria-hidden="true" />
              : <Check aria-hidden="true" />}
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <Dialog open={newSessionOpen} onOpenChange={setNewSessionOpen}>
        <DialogContent className="new-session-dialog">
          <DialogHeader>
            <DialogTitle>Start a new Session</DialogTitle>
            <DialogDescription>
              Choose the Device that will own this agent Session, then give it
              the first instruction.
            </DialogDescription>
          </DialogHeader>
          <form className="dialog-form" onSubmit={createAgentSession}>
            <label className="field-stack">
              <span>Device</span>
              <select
                value={newSessionConnectorId ?? ""}
                onChange={(event) =>
                  setNewSessionConnectorId(event.target.value || null)}
                disabled={onlineCreateConnectors.length === 0}
                required
              >
                <option value="" disabled>Select an online Device</option>
                {onlineCreateConnectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.displayName}
                  </option>
                ))}
              </select>
            </label>
            {onlineCreateConnectors.length === 0 && (
              <div className="inline-callout">
                <WifiOff aria-hidden="true" />
                No online Device currently supports Session creation.
              </div>
            )}
            <label className="field-stack">
              <span>Title <small>Optional</small></span>
              <Input
                value={sessionTitle}
                onChange={(event) => setSessionTitle(event.target.value)}
                placeholder="Review the release plan"
              />
            </label>
            <label className="field-stack">
              <span>First instruction</span>
              <Textarea
                value={sessionPrompt}
                onChange={(event) => setSessionPrompt(event.target.value)}
                placeholder="Describe the outcome you want from the agent..."
                rows={5}
                required
              />
            </label>
            <DialogFooter className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewSessionOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !newSessionConnector
                  || !sessionPrompt.trim()
                  || busyAction === "create-session"
                  || Boolean(activeCommand)
                }
              >
                {busyAction === "create-session"
                  ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    )
                  : <Plus aria-hidden="true" />}
                Start Session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </>
  )
}

function RelayMark({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={`relay-mark${compact ? " is-compact" : ""}`}
      src="/silvermoon-badge.svg"
      alt=""
      aria-hidden="true"
    />
  )
}

function SessionStatus({
  status,
  nativeStatus,
}: {
  status: string
  nativeStatus?: string | null
}) {
  return (
    <span
      className="session-status"
      data-status={status}
      title={nativeStatus ? `Agent status: ${nativeStatus}` : undefined}
    >
      <span aria-hidden="true" />
      {sessionStatusLabel(status)}
    </span>
  )
}

export default App
