import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { Services } from './services.js';
import { registerMarketTools } from './mcp/tools/market.js';
import { registerAnalysisTools } from './mcp/tools/analysis.js';
import { registerLevelTools } from './mcp/tools/levels.js';
import { registerDecisionTools } from './mcp/tools/decision.js';
import { registerContextTools } from './mcp/tools/context.js';

export const SERVICE_NAME = 'ai-trading-http';
export const SERVICE_VERSION = '0.6.0';

export function createMcpServer(config: Config, services: Services, logger: Logger): McpServer {
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

  registerMarketTools(server, services, logger);
  registerAnalysisTools(server, services, logger);
  registerLevelTools(server, services, logger);
  registerDecisionTools(server, services, logger);
  registerContextTools(server, services, logger);
  return server;
}

const rpcError = (code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  error: { code, message },
  id: null,
});

function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createApp(config: Config, logger: Logger, services: Services) {
  const app = express();
  const startedAt = Date.now();
  app.disable('x-powered-by');

  // /mcp access control: Bearer header on /mcp, or a secret path segment on /mcp/<secret>
  // for clients that cannot send headers. /health and /ready stay public.
  const authToken = config.mcpAuthToken;
  const pathSecret = config.mcpPathSecret;
  if (authToken || pathSecret) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path !== '/mcp' && !req.path.startsWith('/mcp/')) {
        next();
        return;
      }
      const reject = (reason: string) => {
        logger.warn({ reason, userAgent: req.headers['user-agent'] }, 'mcp auth rejected');
        res.status(401).json(rpcError(-32001, 'Unauthorized'));
      };
      const segment = req.path.slice('/mcp'.length).replace(/^\/+|\/+$/g, '');
      if (segment) {
        if (!pathSecret) {
          next();
          return;
        }
        if (!tokenMatches(segment, pathSecret)) {
          reject('path_secret_mismatch');
          return;
        }
        const q = req.url.indexOf('?');
        req.url = q === -1 ? '/mcp' : `/mcp${req.url.slice(q)}`;
        next();
        return;
      }
      const qt = req.query.token;
      if (qt !== undefined) {
        if (pathSecret && typeof qt === 'string' && tokenMatches(qt, pathSecret)) {
          next();
          return;
        }
        reject('query_token_mismatch');
        return;
      }
      if (!authToken) {
        reject('bare_mcp_requires_path_secret');
        return;
      }
      const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
      const provided = match?.[1]?.trim();
      if (!provided) {
        reject(req.headers.authorization ? 'not_bearer_scheme' : 'missing_authorization');
        return;
      }
      if (!tokenMatches(provided, authToken)) {
        reject('token_mismatch');
        return;
      }
      next();
    });
  } else {
    logger.warn('MCP_AUTH_TOKEN and MCP_PATH_SECRET are not set: /mcp is open without authentication');
  }
  app.use(express.json({ limit: '1mb' }));

  // Always 200 so the platform keeps the service up; TradingView state is reported inside.
  app.get('/health', (_req: Request, res: Response) => {
    const tv = services.connectionStatus();
    res.status(200).json({
      status: tv.state === 'connected' ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      symbol: services.symbol,
      source: 'tradingview',
      tradingview: tv,
    });
  });

  app.get('/ready', (_req: Request, res: Response) => {
    const tv = services.connectionStatus();
    const ready = tv.state === 'connected';
    res.status(ready ? 200 : 503).json({ ready, tradingview: tv.state });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer(config, services, logger);
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
