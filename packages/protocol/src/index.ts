import { z } from "zod";

export const PROTOCOL_VERSION = 2 as const;

const namedIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const connectorIdSchema = namedIdSchema;
export const sessionIdSchema = z.string().trim().min(1).max(256);
export const requestIdSchema = z.uuid();
export const eventIdSchema = z.string().trim().min(1).max(256);
export const timestampSchema = z.string().datetime({ offset: true });

export const sessionStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "idle",
  "failed",
  "closed",
  "gone",
  "unknown",
]);

export const sessionWorkStateSchema = z.enum(["open", "completed"]);
export type SessionWorkState = z.infer<typeof sessionWorkStateSchema>;

export const connectorCapabilitiesSchema = z.object({
  listSessions: z.boolean(),
  createSession: z.boolean(),
  sendMessage: z.boolean(),
  streamEvents: z.boolean(),
});

export const agentInputOptionSchema = z.object({
  id: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(512),
  description: z.string().trim().min(1).max(2_048).optional(),
  recommended: z.boolean().optional(),
});

export const agentInputQuestionSchema = z.object({
  id: z.string().trim().min(1).max(256),
  kind: z.enum([
    "text",
    "number",
    "integer",
    "boolean",
    "single-select",
    "multi-select",
  ]),
  title: z.string().trim().min(1).max(512).optional(),
  message: z.string().trim().min(1).max(4_096),
  required: z.boolean().optional(),
  options: z.array(agentInputOptionSchema).max(100).optional(),
  allowFreeformInput: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const agentInputRequestSchema = z.object({
  id: z.string().trim().min(1).max(256),
  message: z.string().trim().min(1).max(4_096).nullable().default(null),
  url: z.string().url().max(8_192).nullable().default(null),
  questions: z.array(agentInputQuestionSchema).max(100).default([]),
});

export const agentDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(64).optional(),
});

export const agentSessionSchema = z.object({
  id: sessionIdSchema,
  parentSessionId: sessionIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(256).nullable(),
  status: sessionStatusSchema,
  nativeStatus: z.string().trim().min(1).max(128).nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessagePreview: z.string().max(512).nullable().default(null),
  canSendMessage: z.boolean().optional(),
  pendingInputRequest: agentInputRequestSchema.nullable().optional(),
  executionStateKnown: z.boolean().optional(),
});

export const agentSessionEventPartKindSchema = z.enum([
  "request",
  "markdown",
  "tool",
  "system",
  "activity",
  "error",
]);

export const agentSessionToolStateSchema = z.enum([
  "started",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);

export const agentSessionEventDataSchema = z.object({
  turnId: z.string().trim().min(1).max(256).optional(),
  partId: z.string().trim().min(1).max(256).optional(),
  partIndex: z.number().int().nonnegative().optional(),
  partKind: agentSessionEventPartKindSchema.optional(),
  update: z.literal("snapshot").optional(),
  toolName: z.string().trim().min(1).max(512).optional(),
  toolCallId: z.string().trim().min(1).max(256).optional(),
  state: agentSessionToolStateSchema.optional(),
  inputRequestId: z.string().trim().min(1).max(256).optional(),
  inputRequest: agentInputRequestSchema.optional(),
  inputRequestResolved: z.boolean().optional(),
}).catchall(z.unknown());

export const agentSessionEventSchema = z.object({
  id: eventIdSchema,
  sessionId: sessionIdSchema,
  sequence: z.number().int().nonnegative(),
  type: z.enum(["message", "activity", "tool", "status", "error"]),
  role: z.enum(["user", "assistant", "system"]).optional(),
  text: z.string().max(65_536).optional(),
  status: sessionStatusSchema.optional(),
  data: agentSessionEventDataSchema.optional(),
  createdAt: timestampSchema,
});

const commandBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: requestIdSchema,
  connectionId: z.uuid().optional(),
});

export const listSessionsCommandSchema = commandBaseSchema.extend({
  type: z.literal("sessions.list"),
});

export const createSessionCommandSchema = commandBaseSchema.extend({
  type: z.literal("session.create"),
  prompt: z.string().trim().min(1).max(32_768),
  title: z.string().trim().min(1).max(256).optional(),
});

export const sendSessionMessageCommandSchema = commandBaseSchema.extend({
  type: z.literal("session.message"),
  sessionId: sessionIdSchema,
  message: z.string().trim().min(1).max(32_768),
});

export const syncSessionHistoryCommandSchema = commandBaseSchema.extend({
  type: z.literal("session.history"),
  sessionId: sessionIdSchema,
});

export const connectorCommandSchema = z.discriminatedUnion("type", [
  listSessionsCommandSchema,
  createSessionCommandSchema,
  sendSessionMessageCommandSchema,
  syncSessionHistoryCommandSchema,
]);

export type ConnectorId = z.infer<typeof connectorIdSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ConnectorCapabilities = z.infer<typeof connectorCapabilitiesSchema>;
export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;
export type AgentInputOption = z.infer<typeof agentInputOptionSchema>;
export type AgentInputQuestion = z.infer<typeof agentInputQuestionSchema>;
export type AgentInputRequest = z.infer<typeof agentInputRequestSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentSessionEventData = z.infer<
  typeof agentSessionEventDataSchema
>;
export type AgentSessionEvent = z.infer<typeof agentSessionEventSchema>;
export type ConnectorCommand = z.infer<typeof connectorCommandSchema>;

export const daemonIdSchema = connectorIdSchema;
export type DaemonId = ConnectorId;
