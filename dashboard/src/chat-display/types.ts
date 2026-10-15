/**
 * Define the minimum message contract for Workbench turn grouping and tool cards.
 * Keep only fields used by the current rendering path, without depending on another chat application.
 */

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  [key: string]: unknown;
}

export interface ChatTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface ChatMessage {
  type: string;
  content?: string;
  timestamp: string | number | Date;
  phase?: string;
  messageKey?: string;
  isThinking?: boolean;
  isTaskNotification?: boolean;
  taskKind?: string;
  taskStatus?: string;
  model?: string;
  tokenUsage?: ChatTokenUsage;
  isStreaming?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  source?: string;
  unmatched?: boolean;
  [key: string]: unknown;
}
