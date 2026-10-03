import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

export const SERVICE_NAME = 'ai-trading-http';
export const SERVICE_VERSION = '0.1.0';

export function createMcpServer(config: Config): McpServer {
  const server = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });

  server.registerTool(
    'ping',
    {
      description: 'Connectivity check for ai-trading-http. Returns service info; no market data.',
      inputSchema: { echo: z.string().max(100).optional() },
    },
    async ({ echo }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            service: SERVICE_NAME,
            symbol: config.tvSymbol,
            echo: echo ?? null,
            time: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  return server;
}

const rpcError = (code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  error: { code, message },
  id: null,
});

export function createApp(config: Config, logger: Logger) {
  const app = express();
  const startedAt = Date.now();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      symbol: config.tvSymbol,
      source: 'tradingview',
      tradingview: { status: 'not_initialized' },
    });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'mcp request failed');
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal server error'));
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Method not allowed'));
  };
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json(rpcError(-32700, 'Parse error'));
      return;
    }
    logger.error({ err }, 'unhandled error');
    if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal server error'));
  });

  return app;
}
