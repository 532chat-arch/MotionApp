import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOTION_MCP_PROMPTS,
  MOTION_MCP_TOOLS,
  MotionMcpServerCore,
} from './src/mcp/mcpServerCore.ts';
import type { McpServerEvent } from './src/mcp/mcpServerCore.ts';
import { MCP_PROTOCOL_VERSION } from './src/mcp/mcpTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const mcpCore = new MotionMcpServerCore();

  app.use(express.json({ limit: '25mb' }));

  // CORS headers for external MCP desktop/CLI clients connecting over HTTP
  app.use('/api/mcp', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Streamable HTTP MCP Endpoint (POST JSON-RPC 2.0)
  app.post('/api/mcp', (req, res) => {
    const incomingSession = req.header('Mcp-Session-Id');
    let sessionId = incomingSession && mcpCore.hasSession(incomingSession) ? incomingSession : undefined;

    const payload = req.body;
    const isBatch = Array.isArray(payload);
    const messages = isBatch ? payload : [payload];

    if (
      !sessionId &&
      messages.some((m) => m && typeof m === 'object' && m.method === 'initialize')
    ) {
      sessionId = mcpCore.createSession();
    }
    if (sessionId) {
      res.setHeader('Mcp-Session-Id', sessionId);
    }

    const responses = messages
      .map((msg) => mcpCore.handleRpcMessage(msg))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (responses.length === 0) {
      res.status(202).end();
      return;
    }

    res.status(200).json(isBatch ? responses : responses[0]);
  });

  // Streamable HTTP MCP GET Endpoint: SSE notification channel OR discovery metadata
  app.get('/api/mcp', (req, res) => {
    const accept = req.header('Accept') ?? '';
    if (accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const unsubscribe = mcpCore.subscribe((evt: McpServerEvent) => {
        if (evt.type === 'project:updated') {
          res.write(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/resources/updated',
              params: { uri: 'motion://project/current', revision: evt.revision },
            })}\n\n`
          );
        }
      });

      const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 20000);

      req.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    res.json({
      name: 'motion-studio-mcp',
      version: '1.0.0',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: '/api/mcp',
      tools: MOTION_MCP_TOOLS.map((t) => t.name),
      resources: mcpCore.listResources().map((r) => r.uri),
      prompts: MOTION_MCP_PROMPTS.map((p) => p.name),
      revision: mcpCore.getRevision(),
    });
  });

  // Terminate MCP session
  app.delete('/api/mcp', (req, res) => {
    const sessionId = req.header('Mcp-Session-Id');
    if (sessionId) {
      mcpCore.closeSession(sessionId);
    }
    res.status(204).end();
  });

  // Browser Studio <-> MCP Server Real-Time Sync Bridge (SSE)
  app.get('/api/mcp/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(
      `event: init\ndata: ${JSON.stringify({
        revision: mcpCore.getRevision(),
        activeCompositionId: mcpCore.getActiveCompositionId(),
        logs: mcpCore.getLogs(),
      })}\n\n`
    );

    const unsubscribe = mcpCore.subscribe((evt: McpServerEvent) => {
      if (evt.type === 'project:updated') {
        res.write(`event: project_updated\ndata: ${JSON.stringify(evt)}\n\n`);
      } else if (evt.type === 'mcp:log') {
        res.write(`event: mcp_log\ndata: ${JSON.stringify(evt.entry)}\n\n`);
      }
    });

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Browser Studio pushes current project snapshot so external MCP clients stay synchronized
  app.post('/api/mcp/sync', (req, res) => {
    const { project, activeCompositionId } = (req.body ?? {}) as {
      project?: unknown;
      activeCompositionId?: string;
    };
    const result = mcpCore.syncFromStudio(project, activeCompositionId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, revision: result.revision });
  });

  app.get('/api/mcp/logs', (_req, res) => {
    res.json({ logs: mcpCore.getLogs() });
  });

  app.delete('/api/mcp/logs', (_req, res) => {
    mcpCore.clearLogs();
    res.status(204).end();
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Motion Studio server listening on http://0.0.0.0:${PORT} (MCP: /api/mcp)`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Motion Studio server:', err);
  process.exit(1);
});
