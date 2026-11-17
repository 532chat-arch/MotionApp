export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const SUPPORTED_MCP_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: McpToolSchema;
  sampleArgs?: Record<string, unknown>;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpCallToolResult {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: McpTextContent;
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpActivityEntry {
  id: string;
  timestamp: string;
  direction: 'server' | 'client';
  serverName: string;
  method: string;
  detail: string;
  status: 'ok' | 'error';
  durationMs: number;
}

export interface ExternalMcpServer {
  id: string;
  name: string;
  url: string;
  bearerToken?: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  errorMessage?: string;
  sessionId?: string;
  serverInfo?: McpServerInfo;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  lastConnectedAt?: string;
}
