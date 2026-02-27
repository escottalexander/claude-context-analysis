// Content block types within assistant messages
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock | ToolResultBlock;

// Usage / token tracking
export interface CacheCreationDetail {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

export interface UsageData {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  cache_creation?: CacheCreationDetail;
  service_tier?: string;
}

// The inner message object on assistant/user events
export interface AssistantMessage {
  model?: string;
  id?: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: UsageData;
}

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
}

// Top-level JSONL event types
export interface UserEvent {
  type: "user";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  message: UserMessage;
  isSidechain: boolean;
  cwd: string;
  version?: string;
  gitBranch?: string;
  thinkingMetadata?: { maxThinkingTokens: number };
  permissionMode?: string;
  toolUseResult?: ToolUseResultMeta;
  sourceToolAssistantUUID?: string;
  slug?: string;
  todos?: unknown[];
}

export interface ToolUseResultMeta {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  filenames?: string[];
  durationMs?: number;
  numFiles?: number;
  truncated?: boolean;
}

export interface AssistantEvent {
  type: "assistant";
  uuid: string;
  parentUuid: string;
  sessionId: string;
  timestamp: string;
  message: AssistantMessage;
  requestId?: string;
  isSidechain: boolean;
  cwd: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  agentId?: string;
}

export interface CompactMetadata {
  trigger?: string;
  preTokens?: number;
}

export interface SystemEvent {
  type: "system";
  uuid: string;
  parentUuid: string | null;
  logicalParentUuid?: string | null;
  sessionId?: string;
  timestamp: string;
  subtype?: string;
  content?: string;
  level?: string;
  isSidechain: boolean;
  isMeta?: boolean;
  compactMetadata?: CompactMetadata;
}

export interface ProgressEvent {
  type: "progress";
  uuid: string;
  parentUuid: string | null;
  sessionId?: string;
  timestamp: string;
  data: {
    type: string;
    hookEvent?: string;
    hookName?: string;
    command?: string;
  };
  parentToolUseID?: string;
  toolUseID?: string;
  isSidechain: boolean;
}

export interface FileHistorySnapshot {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export type SessionEvent =
  | UserEvent
  | AssistantEvent
  | SystemEvent
  | ProgressEvent
  | FileHistorySnapshot;

// Tool call paired with its result
export interface ToolPair {
  toolUse: ToolUseBlock;
  toolResult: ToolResultBlock | null;
  assistantTimestamp: string;
  resultTimestamp: string | null;
  assistantUuid: string;
  resultUuid: string | null;
}

// Analysis output types

export interface TimelineEntry {
  type: "thinking" | "tool_use" | "tool_result" | "text";
  timestamp: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  isError?: boolean;
  ctxSpikeTokens?: number;
  assistantTurnId?: string;
}

export interface ToolStats {
  name: string;
  count: number;
  successes: number;
  failures: number;
  avgDurationMs: number | null;
  attributedInputTokens: number;
  attributedCacheCreationTokens: number;
  attributedCacheReadTokens: number;
  attributedOutputTokens: number;
  attributedTotalTokens: number;
}

export interface FileAccess {
  path: string;
  reads: number;
  writes: number;
  edits: number;
}

export interface ToolPattern {
  sequence: string[];
  count: number;
}

export interface TokenTurn {
  turnIndex: number;
  timestamp: string;
  scopeId?: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  percentOfLimit: number;
}

export interface CompactionEvent {
  afterTurnIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensFreed: number;
}

export interface SkillFileImpact {
  filePath: string;
  type: "claude-md" | "skill" | "config";
  estimatedTokens: number;
  cacheCreationSpike: number;
}

export interface NetworkRequestEntry {
  toolUseId: string;
  toolName: string;
  scopeId: string;
  linkedSubagentId: string | null;
  startTimestamp: string;
  endTimestamp: string | null;
  timeMs: number | null;
  ctxSpikeTokens: number;
  isError: boolean;
  toolInput: Record<string, unknown>;
  toolResultContent: string | null;
}

export type NetworkEventKind =
  | "tool_use"
  | "user_message"
  | "assistant_text"
  | "thinking"
  | "hook"
  | "system"
  | "compaction";

export interface NetworkTimelineEvent {
  id: string;
  kind: NetworkEventKind;
  timestamp: string;
  scopeId: string;
  // Short label for table display
  summary: string;
  // Full content for detail panel
  content: string;
  // Tool-specific (kind === "tool_use")
  toolName?: string;
  toolUseId?: string;
  linkedSubagentId?: string | null;
  timeMs?: number | null;
  ctxSpikeTokens?: number;
  isError?: boolean;
  toolInput?: Record<string, unknown>;
  toolResultContent?: string | null;
  // Tool result-specific
  toolUseResult?: Record<string, unknown>;
  // Progress-specific
  hookEvent?: string;
  hookName?: string;
  progressType?: string;
  // Assistant-specific: token usage
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  // Streaming: groups events from the same API request
  requestId?: string;
  // System-specific
  subtype?: string;
  durationMs?: number;
  // Compaction-specific
  compactTrigger?: string;
  preTokens?: number;
}

export interface NetworkAgentScope {
  id: string;
  label: string;
  requests: NetworkRequestEntry[];
  events: NetworkTimelineEvent[];
}

export interface AnalysisResult {
  sessionId: string;
  sessionStart: string;
  sessionEnd: string;
  totalEvents: number;
  timeline: TimelineEntry[];
  toolStats: ToolStats[];
  fileAccess: FileAccess[];
  toolPatterns: ToolPattern[];
  tokenTurns: TokenTurn[];
  compactionEvents: CompactionEvent[];
  skillImpacts: SkillFileImpact[];
}
