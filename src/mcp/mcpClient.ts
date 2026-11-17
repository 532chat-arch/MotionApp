import type {
  JsonRpcResponse,
  McpCallToolResult,
  McpPromptDefinition,
  McpResourceContent,
  McpResourceDefinition,
  McpServerInfo,
  McpToolDefinition,
} from './mcpTypes.ts';
import { MCP_PROTOCOL_VERSION } from './mcpTypes.ts';

let rpcSeq = 1;

export interface McpEndpointHandshake {
  sessionId?: string;
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
}

function parseSseJsonRpcResponses(sseText: string): JsonRpcResponse[] {
  const results: JsonRpcResponse[] = [];
  const blocks = sseText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed as JsonRpcResponse);
      }
    } catch {
      // Ignore non-JSON SSE event lines
    }
  }
  return results;
}

export async function callMcpJsonRpc<T = unknown>(
  endpointUrl: string,
  method: string,
  params?: Record<string, unknown>,
  options?: {
    sessionId?: string;
    bearerToken?: string;
    isNotification?: boolean;
  }
): Promise<{ result: T; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (options?.sessionId) {
    headers['Mcp-Session-Id'] = options.sessionId;
  }
  if (options?.bearerToken?.trim()) {
    headers['Authorization'] = `Bearer ${options.bearerToken.trim()}`;
  }

  const body = options?.isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: rpcSeq++, method, params };

  const resp = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const nextSessionId = resp.headers.get('Mcp-Session-Id') ?? options?.sessionId;

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${errText || resp.statusText}`);
  }

  if (options?.isNotification || resp.status === 202 || resp.status === 204) {
    return { result: undefined as T, sessionId: nextSessionId };
  }

  const contentType = resp.headers.get('content-type') ?? '';
  let rpcPayload: JsonRpcResponse | undefined;

  if (contentType.includes('text/event-stream')) {
    const sseText = await resp.text();
    const responses = parseSseJsonRpcResponses(sseText);
    rpcPayload = responses[responses.length - 1];
  } else {
    const json = await resp.json();
    rpcPayload = Array.isArray(json) ? json[0] : json;
  }

  if (!rpcPayload) {
    throw new Error('Empty JSON-RPC response from MCP server');
  }
  if (rpcPayload.error) {
    throw new Error(`${rpcPayload.error.message} (code ${rpcPayload.error.code})`);
  }

  return {
    result: rpcPayload.result as T,
    sessionId: nextSessionId,
  };
}

export async function connectMcpServer(
  endpointUrl: string,
  bearerToken?: string
): Promise<McpEndpointHandshake> {
  const initRes = await callMcpJsonRpc<{
    protocolVersion?: string;
    serverInfo?: McpServerInfo;
    capabilities?: {
      tools?: unknown;
      resources?: unknown;
      prompts?: unknown;
    };
  }>(
    endpointUrl,
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'motion-studio-client', version: '1.0.0' },
    },
    { bearerToken }
  );

  const sessionId = initRes.sessionId;

  await callMcpJsonRpc(
    endpointUrl,
    'notifications/initialized',
    {},
    { sessionId, bearerToken, isNotification: true }
  ).catch(() => undefined);

  const [toolsRes, resourcesRes, promptsRes] = await Promise.all([
    callMcpJsonRpc<{ tools?: McpToolDefinition[] }>(
      endpointUrl,
      'tools/list',
      {},
      { sessionId, bearerToken }
    ).catch(() => ({ result: { tools: [] } })),
    callMcpJsonRpc<{ resources?: McpResourceDefinition[] }>(
      endpointUrl,
      'resources/list',
      {},
      { sessionId, bearerToken }
    ).catch(() => ({ result: { resources: [] } })),
    callMcpJsonRpc<{ prompts?: McpPromptDefinition[] }>(
      endpointUrl,
      'prompts/list',
      {},
      { sessionId, bearerToken }
    ).catch(() => ({ result: { prompts: [] } })),
  ]);

  return {
    sessionId,
    serverInfo: initRes.result.serverInfo,
    protocolVersion: initRes.result.protocolVersion,
    tools: toolsRes.result.tools ?? [],
    resources: resourcesRes.result.resources ?? [],
    prompts: promptsRes.result.prompts ?? [],
  };
}

export async function invokeMcpTool(
  endpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { sessionId?: string; bearerToken?: string }
): Promise<McpCallToolResult> {
  const { result } = await callMcpJsonRpc<McpCallToolResult>(
    endpointUrl,
    'tools/call',
    { name: toolName, arguments: args },
    options
  );
  return result;
}

export async function readMcpResource(
  endpointUrl: string,
  uri: string,
  options?: { sessionId?: string; bearerToken?: string }
): Promise<McpResourceContent[]> {
  const { result } = await callMcpJsonRpc<{ contents?: McpResourceContent[] }>(
    endpointUrl,
    'resources/read',
    { uri },
    options
  );
  return result.contents ?? [];
}
