import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileJson,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Terminal,
} from 'lucide-react';
import { uid } from '../commands/projectCommands';
import { invokeMcpTool, readMcpResource } from '../mcp/mcpClient';
import { MOTION_MCP_PROMPTS, MOTION_MCP_TOOLS } from '../mcp/mcpServerCore';
import type { McpToolDefinition } from '../mcp/mcpTypes';
import { validateProject } from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';

type InspectTab = 'tools' | 'resources' | 'prompts';

export const McpWorkspace: React.FC = () => {
  const {
    project,
    activeCompositionId,
    mcpBridgeStatus,
    mcpLogs,
    externalMcpServers,
    clearMcpLogs,
    appendMcpLog,
    applyRemoteMcpProject,
    addExternalMcpServer,
    connectExternalMcpServer,
    removeExternalMcpServer,
    showFeedback,
  } = useStudioStore();

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const localEndpoint = `${origin}/api/mcp`;

  const [activeTargetId, setActiveTargetId] = useState<'local' | string>('local');
  const [inspectTab, setInspectTab] = useState<InspectTab>('tools');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<'url' | 'config' | null>(null);

  const [selectedToolName, setSelectedToolName] = useState<string>(MOTION_MCP_TOOLS[0].name);
  const [argsText, setArgsText] = useState<string>('{}');
  const [selectedResourceUri, setSelectedResourceUri] = useState<string>('motion://project/current');
  const [selectedPromptName, setSelectedPromptName] = useState<string>(MOTION_MCP_PROMPTS[0].name);

  const [running, setRunning] = useState(false);
  const [outputText, setOutputText] = useState<string>('');
  const [outputError, setOutputError] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

  // Add External MCP Server form state
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerToken, setNewServerToken] = useState('');
  const [addingServer, setAddingServer] = useState(false);

  const selectedExternalServer = useMemo(
    () => (activeTargetId === 'local' ? null : externalMcpServers.find((s) => s.id === activeTargetId) ?? null),
    [activeTargetId, externalMcpServers]
  );

  const availableTools: McpToolDefinition[] = useMemo(
    () => (selectedExternalServer ? selectedExternalServer.tools : MOTION_MCP_TOOLS),
    [selectedExternalServer]
  );

  const availableResources = useMemo(() => {
    if (selectedExternalServer) return selectedExternalServer.resources;
    return [
      {
        uri: 'motion://project/current',
        name: 'Current MotionProject JSON',
        description: `Full project state for "${project.name}"`,
        mimeType: 'application/json',
      },
      {
        uri: 'motion://project/schema',
        name: 'Motion Studio Schema Guide',
        description: 'Layer kinds, shapes, easing curves, and weather presets',
        mimeType: 'application/json',
      },
      ...project.compositions.map((c) => ({
        uri: `motion://composition/${c.id}`,
        name: `Composition: ${c.name}`,
        description: `${c.settings.width}x${c.settings.height}, ${c.settings.durationFrames}f, ${c.layers.length} layers`,
        mimeType: 'application/json',
      })),
    ];
  }, [selectedExternalServer, project]);

  const availablePrompts = useMemo(
    () => (selectedExternalServer ? selectedExternalServer.prompts : MOTION_MCP_PROMPTS),
    [selectedExternalServer]
  );

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableTools;
    return availableTools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [availableTools, searchQuery]);

  const activeTool = useMemo(
    () => availableTools.find((t) => t.name === selectedToolName) ?? availableTools[0] ?? null,
    [availableTools, selectedToolName]
  );

  const claudeConfigSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            'motion-studio': {
              type: 'http',
              url: localEndpoint,
            },
          },
        },
        null,
        2
      ),
    [localEndpoint]
  );

  const handleCopy = async (kind: 'url' | 'config', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(kind);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      showFeedback('error', 'Clipboard access denied');
    }
  };

  const handleSyncToServer = async () => {
    setSyncingNow(true);
    try {
      const resp = await fetch('/api/mcp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, activeCompositionId }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      showFeedback('info', 'Project snapshot synced to MCP server');
    } catch (err) {
      showFeedback('error', `Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSelectTool = (tool: McpToolDefinition) => {
    setSelectedToolName(tool.name);
    setInspectTab('tools');
    setOutputError(null);
    if (tool.sampleArgs) {
      setArgsText(JSON.stringify(tool.sampleArgs, null, 2));
    } else {
      setArgsText('{}');
    }
  };

  const handleRunTool = async () => {
    if (!activeTool) return;
    setRunning(true);
    setOutputError(null);
    const start = performance.now();

    let parsedArgs: Record<string, unknown> = {};
    try {
      const trimmed = argsText.trim();
      parsedArgs = trimmed ? JSON.parse(trimmed) : {};
      if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
        throw new Error('Arguments must be a JSON object');
      }
    } catch (err) {
      setOutputError(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`);
      setRunning(false);
      return;
    }

    const endpoint = selectedExternalServer ? selectedExternalServer.url : localEndpoint;
    const serverLabel = selectedExternalServer ? selectedExternalServer.name : 'motion-studio-mcp';

    try {
      const result = await invokeMcpTool(endpoint, activeTool.name, parsedArgs, {
        sessionId: selectedExternalServer?.sessionId,
        bearerToken: selectedExternalServer?.bearerToken,
      });
      const textOut =
        result.content?.map((c) => c.text).join('\n') || JSON.stringify(result, null, 2);
      setOutputText(textOut);
      if (result.isError) {
        setOutputError(textOut);
      }

      if (selectedExternalServer) {
        appendMcpLog({
          id: uid('mcplog'),
          timestamp: new Date().toISOString(),
          direction: 'client',
          serverName: serverLabel,
          method: `tools/call:${activeTool.name}`,
          detail: result.isError ? 'Returned tool error' : 'Success',
          status: result.isError ? 'error' : 'ok',
          durationMs: Math.round(performance.now() - start),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutputError(msg);
      appendMcpLog({
        id: uid('mcplog'),
        timestamp: new Date().toISOString(),
        direction: 'client',
        serverName: serverLabel,
        method: `tools/call:${activeTool.name}`,
        detail: msg,
        status: 'error',
        durationMs: Math.round(performance.now() - start),
      });
    } finally {
      setRunning(false);
    }
  };

  const handleReadResource = async (uri: string) => {
    setSelectedResourceUri(uri);
    setRunning(true);
    setOutputError(null);
    const endpoint = selectedExternalServer ? selectedExternalServer.url : localEndpoint;
    try {
      const contents = await readMcpResource(endpoint, uri, {
        sessionId: selectedExternalServer?.sessionId,
        bearerToken: selectedExternalServer?.bearerToken,
      });
      setOutputText(contents.map((c) => c.text).join('\n\n'));
    } catch (err) {
      setOutputError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleApplyOutputAsProject = () => {
    if (!outputText.trim()) return;
    try {
      const parsed = JSON.parse(outputText);
      const validation = validateProject(parsed);
      if (!validation.success) {
        showFeedback('error', `Output is not a valid MotionProject: ${validation.error}`);
        return;
      }
      applyRemoteMcpProject(validation.data, `Imported from MCP response`, Date.now());
    } catch {
      showFeedback('error', 'Response is not valid JSON');
    }
  };

  const handleAddExternalServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerUrl.trim()) return;
    setAddingServer(true);
    try {
      await addExternalMcpServer(newServerName, newServerUrl, newServerToken);
      setNewServerName('');
      setNewServerUrl('');
      setNewServerToken('');
    } finally {
      setAddingServer(false);
    }
  };

  const handleClearLogs = async () => {
    clearMcpLogs();
    await fetch('/api/mcp/logs', { method: 'DELETE' }).catch(() => undefined);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-[#111317] text-[#F1F3F6] overflow-hidden">
      {/* Left Sidebar: Server Endpoint, External Connections & Capability Browser */}
      <aside className="w-full lg:w-88 shrink-0 border-b lg:border-b-0 lg:border-r border-white/8 bg-[#181B20] flex flex-col min-h-0 overflow-y-auto">
        {/* Built-in Motion Studio MCP Server */}
        <section className="p-4 border-b border-white/8 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-4 h-4 text-sky-400 shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
                Motion Studio MCP Server
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTargetId('local')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeTargetId === 'local'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#20242B] text-slate-300 hover:bg-white/10'
              }`}
            >
              Inspect
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className={
                mcpBridgeStatus === 'connected'
                  ? 'text-emerald-400 font-medium'
                  : mcpBridgeStatus === 'connecting'
                    ? 'text-amber-400 font-medium'
                    : 'text-red-400 font-medium'
              }
            >
              {mcpBridgeStatus === 'connected'
                ? 'Live SSE Bridge Connected'
                : mcpBridgeStatus === 'connecting'
                  ? 'Connecting Bridge'
                  : 'Bridge Offline'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Streamable HTTP</span>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              readOnly
              value={localEndpoint}
              aria-label="Motion Studio MCP endpoint URL"
              className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs font-mono text-slate-200 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCopy('url', localEndpoint)}
              className="h-8 px-2.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              {copiedKey === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              Copy
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy('config', claudeConfigSnippet)}
              className="flex-1 h-8 px-2.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {copiedKey === 'config' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <FileJson className="w-3.5 h-3.5 text-sky-400" />
              )}
              {copiedKey === 'config' ? 'Copied Config' : 'Copy Client JSON'}
            </button>
            <button
              type="button"
              onClick={() => void handleSyncToServer()}
              disabled={syncingNow}
              className="h-8 px-2.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
              Sync Now
            </button>
          </div>
        </section>

        {/* External MCP Servers (Client Mode) */}
        <section className="p-4 border-b border-white/8 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-amber-400 shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-100">
                External MCP Servers
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {externalMcpServers.length}
            </span>
          </div>

          <form onSubmit={handleAddExternalServer} className="space-y-2">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                placeholder="Label (e.g. Scene Agent)"
                className="w-28 h-8 px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="url"
                required
                value={newServerUrl}
                onChange={(e) => setNewServerUrl(e.target.value)}
                placeholder="https://.../mcp"
                className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={newServerToken}
                onChange={(e) => setNewServerToken(e.target.value)}
                placeholder="Optional Bearer token"
                className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={addingServer}
                className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect
              </button>
            </div>
          </form>

          {externalMcpServers.length === 0 ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              Connect any Streamable HTTP MCP server to discover and invoke remote tools directly from Motion Studio.
            </p>
          ) : (
            <div className="space-y-1.5">
              {externalMcpServers.map((srv) => {
                const isSelected = activeTargetId === srv.id;
                return (
                  <div
                    key={srv.id}
                    className={`p-2.5 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-blue-600/12 border-blue-500/40'
                        : 'bg-[#111317] border-white/8'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTargetId(srv.id)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {srv.name}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate">
                          {srv.url}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void connectExternalMcpServer(srv.id)}
                          title="Reconnect & refresh capabilities"
                          aria-label={`Refresh ${srv.name}`}
                          className="h-7 w-7 rounded-md hover:bg-white/10 flex items-center justify-center text-slate-300"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${srv.status === 'connecting' ? 'animate-spin text-blue-400' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (activeTargetId === srv.id) setActiveTargetId('local');
                            removeExternalMcpServer(srv.id);
                          }}
                          title="Remove server"
                          aria-label={`Remove ${srv.name}`}
                          className="h-7 w-7 rounded-md hover:bg-red-500/15 flex items-center justify-center text-slate-400 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                      <span
                        className={
                          srv.status === 'connected'
                            ? 'text-emerald-400'
                            : srv.status === 'error'
                              ? 'text-red-400'
                              : 'text-slate-400'
                        }
                      >
                        {srv.status}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{srv.tools.length} tools</span>
                      <span aria-hidden="true">·</span>
                      <span>{srv.resources.length} resources</span>
                    </div>
                    {srv.errorMessage && (
                      <div className="mt-1 text-[11px] text-red-400 break-words">
                        {srv.errorMessage}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Capability Browser: Tools / Resources / Prompts */}
        <section className="p-4 flex-1 min-h-[240px] flex flex-col gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#111317] border border-white/8">
            {(['tools', 'resources', 'prompts'] as InspectTab[]).map((tab) => {
              const count =
                tab === 'tools'
                  ? availableTools.length
                  : tab === 'resources'
                    ? availableResources.length
                    : availablePrompts.length;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setInspectTab(tab)}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap tabular-nums ${
                    inspectTab === tab
                      ? 'bg-[#20242B] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab} ({count})
                </button>
              );
            })}
          </div>

          {inspectTab === 'tools' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter MCP tools..."
                  className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                {filteredTools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => handleSelectTool(tool)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      activeTool?.name === tool.name
                        ? 'bg-blue-600/15 border-blue-500/40 text-white'
                        : 'bg-transparent border-transparent hover:bg-white/5 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-mono font-medium truncate">{tool.name}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                      {tool.description}
                    </div>
                  </button>
                ))}
                {filteredTools.length === 0 && (
                  <div className="text-xs text-slate-500 py-4 text-center">
                    No matching MCP tools
                  </div>
                )}
              </div>
            </>
          )}

          {inspectTab === 'resources' && (
            <div className="space-y-1.5">
              {availableResources.map((res) => (
                <button
                  key={res.uri}
                  type="button"
                  onClick={() => void handleReadResource(res.uri)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                    selectedResourceUri === res.uri
                      ? 'bg-blue-600/15 border-blue-500/40 text-white'
                      : 'bg-[#111317] border-white/8 hover:border-white/20 text-slate-300'
                  }`}
                >
                  <div className="text-xs font-medium truncate">{res.name}</div>
                  <div className="text-[11px] font-mono text-sky-400 truncate mt-0.5">{res.uri}</div>
                </button>
              ))}
              {availableResources.length === 0 && (
                <div className="text-xs text-slate-500 py-4 text-center">No resources exposed</div>
              )}
            </div>
          )}

          {inspectTab === 'prompts' && (
            <div className="space-y-1.5">
              {availablePrompts.map((pr) => (
                <button
                  key={pr.name}
                  type="button"
                  onClick={() => {
                    setSelectedPromptName(pr.name);
                    setOutputError(null);
                    setOutputText(JSON.stringify(pr, null, 2));
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                    selectedPromptName === pr.name
                      ? 'bg-blue-600/15 border-blue-500/40 text-white'
                      : 'bg-[#111317] border-white/8 hover:border-white/20 text-slate-300'
                  }`}
                >
                  <div className="text-xs font-mono font-medium truncate">{pr.name}</div>
                  {pr.description && (
                    <div className="text-[11px] text-slate-400 mt-0.5">{pr.description}</div>
                  )}
                </button>
              ))}
              {availablePrompts.length === 0 && (
                <div className="text-xs text-slate-500 py-4 text-center">No prompts exposed</div>
              )}
            </div>
          )}
        </section>
      </aside>

      {/* Main Column: Interactive Tool Runner & Live MCP Activity Log */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto p-4 lg:p-6 gap-6">
        {/* Tool / Resource Runner */}
        <section className="rounded-xl bg-[#181B20] border border-white/8 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>
                  {selectedExternalServer ? selectedExternalServer.name : 'motion-studio-mcp'}
                </span>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-sky-400">
                  {inspectTab === 'resources'
                    ? selectedResourceUri
                    : activeTool?.name ?? 'Select a tool'}
                </span>
              </div>
              <h1 className="font-display text-base font-semibold text-slate-100 mt-0.5">
                {inspectTab === 'resources'
                  ? 'MCP Resource Inspector'
                  : activeTool?.title || activeTool?.name || 'MCP Tool Playground'}
              </h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {outputText.trim().startsWith('{') && (
                <button
                  type="button"
                  onClick={handleApplyOutputAsProject}
                  className="h-9 px-3 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-200 whitespace-nowrap"
                >
                  Apply JSON to Stage
                </button>
              )}
              {inspectTab === 'resources' ? (
                <button
                  type="button"
                  onClick={() => void handleReadResource(selectedResourceUri)}
                  disabled={running}
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {running ? 'Reading...' : 'Read Resource'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleRunTool()}
                  disabled={running || !activeTool}
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {running ? 'Running...' : 'Execute tools/call'}
                </button>
              )}
            </div>
          </div>

          {activeTool && inspectTab === 'tools' && (
            <p className="text-xs text-slate-300 leading-relaxed">{activeTool.description}</p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* JSON Arguments Input */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Request Arguments (JSON)</span>
                {activeTool?.sampleArgs && (
                  <button
                    type="button"
                    onClick={() => setArgsText(JSON.stringify(activeTool.sampleArgs, null, 2))}
                    className="text-blue-400 hover:text-blue-300 font-medium"
                  >
                    Reset Sample
                  </button>
                )}
              </div>
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={11}
                spellCheck={false}
                className="w-full p-3 rounded-lg bg-[#111317] border border-white/10 font-mono text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-blue-500 resize-y"
              />
            </div>

            {/* JSON-RPC Response Viewer */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>MCP Response Payload</span>
                {outputError ? (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Error
                  </span>
                ) : outputText ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    OK
                  </span>
                ) : null}
              </div>
              <pre className="w-full min-h-[234px] max-h-[340px] p-3 rounded-lg bg-[#111317] border border-white/10 font-mono text-xs text-slate-200 overflow-auto whitespace-pre-wrap break-words">
                {outputError
                  ? outputError
                  : outputText || 'Select an MCP tool or resource and run it to inspect the live response.'}
              </pre>
            </div>
          </div>
        </section>

        {/* Live MCP Activity Table */}
        <section className="rounded-xl bg-[#181B20] border border-white/8 flex flex-col min-h-[200px]">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-300" />
              <h2 className="font-display text-sm font-semibold text-slate-100">
                MCP Protocol Activity
              </h2>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {mcpLogs.length} events
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleClearLogs()}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/5"
            >
              Clear
            </button>
          </div>

          {mcpLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No MCP requests recorded yet. Connect an external client to{' '}
              <span className="font-mono text-slate-200">{localEndpoint}</span> or run a tool above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/8 text-[11px] font-medium text-slate-400">
                    <th className="py-2.5 px-4">Time</th>
                    <th className="py-2.5 px-4">Direction</th>
                    <th className="py-2.5 px-4">Method</th>
                    <th className="py-2.5 px-4">Detail</th>
                    <th className="py-2.5 px-4 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 text-xs">
                  {mcpLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-4 text-slate-300 whitespace-nowrap">
                        {entry.direction === 'server' ? 'Inbound Server' : `Client (${entry.serverName})`}
                      </td>
                      <td className="py-2 px-4 font-mono text-sky-400 whitespace-nowrap">
                        {entry.method}
                      </td>
                      <td
                        className={`py-2 px-4 max-w-md truncate ${
                          entry.status === 'error' ? 'text-red-400' : 'text-slate-300'
                        }`}
                      >
                        {entry.detail}
                      </td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right text-slate-400 whitespace-nowrap">
                        {entry.durationMs} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
