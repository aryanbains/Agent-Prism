#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { Command } from 'commander';
import open from 'open';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDashboardApp } from '../server/app.js';
import { SqliteStorageAdapter } from '../storage/sqlite.js';
import { createTracer } from '../tracer.js';
import { importLogFile, type ParserSelection } from '../parsers/index.js';

const program = new Command();

program
  .name('agent-prism')
  .description('Drop-in tracing for agent pipelines')
  .version('0.1.0');

program.command('init')
  .description('Create a local Agent Prism config and initialize the SQLite database')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .action((options) => {
    const dbPath = resolve(options.db);
    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    storage.close();
    const configPath = resolve('agent-prism.config.json');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, `${JSON.stringify({ dbPath, storage: 'sqlite' }, null, 2)}\n`);
    }
    console.log(`Initialized Agent Prism at ${dbPath}`);
  });

program.command('dashboard')
  .description('Start the local Agent Prism dashboard')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .option('--port <port>', 'Preferred port', '4242')
  .option('--no-open', 'Do not open the browser')
  .action(async (options) => {
    const dbPath = resolve(options.db);
    const port = await findOpenPort(Number(options.port));
    const cliDirectory = dirname(fileURLToPath(import.meta.url));
    const { app } = createDashboardApp({ dbPath, dashboardDir: resolve(cliDirectory, '../dashboard') });
    serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
    const url = `http://127.0.0.1:${port}`;
    console.log(`Agent Prism dashboard running at ${url}`);
    if (options.open) {
      await open(url);
    }
  });

program.command('stats')
  .description('Print trace statistics')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .action((options) => {
    const storage = new SqliteStorageAdapter(resolve(options.db));
    storage.init();
    const cost = storage.getCostStats();
    const health = storage.getHealthStats();
    console.log(`Sessions: ${storage.listSessions(10_000).length}`);
    console.log(`Total cost: $${cost.totalCostUSD.toFixed(6)}`);
    console.log(`Tokens: ${cost.totalTokens.total} total (${cost.totalTokens.input} in, ${cost.totalTokens.output} out)`);
    console.log('Agents:');
    for (const agent of health.agents) {
      console.log(`- ${agent.agentName}: ${agent.runCount} runs, ${(agent.successRate * 100).toFixed(1)}% success, p95 ${agent.p95LatencyMs}ms`);
    }
    storage.close();
  });

program.command('export')
  .description('Export traces as JSON or CSV')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .option('--format <format>', 'json or csv', 'json')
  .option('--session-id <id>', 'Filter to one session')
  .action((options) => {
    const storage = new SqliteStorageAdapter(resolve(options.db));
    storage.init();
    const exported = storage.exportTraces({ sessionId: options.sessionId, format: options.format });
    if (options.format === 'csv') {
      console.log(['type,id,sessionId,name,status,latencyMs,costUSD'].join(','));
      for (const run of exported.runs) {
        console.log(['run', run.id, run.sessionId, run.agentName, run.status, run.latencyMs ?? '', run.costUSD].join(','));
      }
    } else {
      console.log(JSON.stringify(exported, null, 2));
    }
    storage.close();
  });

program.command('import')
  .alias('import-logs')
  .description('Import Hermes/OpenClaw structured logs into an Agent Prism database')
  .requiredOption('--file <path>', 'Log file to import')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .option('--parser <parser>', 'hermes, openclaw, or auto', 'auto')
  .option('--session-id <id>', 'Session id to use when the log does not include one')
  .option('--session-name <name>', 'Session name to use when the log does not include one')
  .action((options) => {
    const parser = parseParserSelection(options.parser);
    const summary = importLogFile({
      dbPath: resolve(options.db),
      filePath: options.file,
      parser,
      sessionId: options.sessionId,
      sessionName: options.sessionName
    });
    console.log(`Imported ${summary.runCount} runs, ${summary.toolCallCount} tool calls, ${summary.modelCallCount} model calls from ${summary.source}`);
    if (summary.skippedLineCount > 0) {
      console.log(`Skipped ${summary.skippedLineCount} unrecognized lines`);
    }
    console.log(`Parser import: ${summary.id}`);
    console.log(`Session: ${summary.sessionId}`);
  });

program.command('demo')
  .description('Seed a small demo trace into the database')
  .option('--db <path>', 'SQLite database path', './agent-prism.db')
  .action(async (options) => {
    const lens = createTracer({ dbPath: resolve(options.db) });
    const orchestrator = lens.startRun('orchestrator-agent', { input: { prompt: 'Draft a renewal email' }, sessionName: 'Demo session' });
    await orchestrator.toolCall('classify_intent', { text: 'renewal email' }, async () => ({ intent: 'sales' }));
    const sales = orchestrator.startChild('sales-agent', { input: { accountId: 'acct_123' } });
    await sales.toolCall('search_crm', { accountId: 'acct_123' }, async () => ({ plan: 'enterprise' }));
    sales.recordModelCall({ provider: 'anthropic', method: 'messages.create', model: 'claude-sonnet-4-6', tokens: { input: 1000, output: 500 }, output: { text: 'Draft email' } });
    sales.end({ output: { email: 'Hello from Agent Prism' } });
    orchestrator.end({ output: { status: 'ready' } });
    lens.shutdown();
    console.log(`Seeded demo trace at ${resolve(options.db)}`);
  });

program.parse(process.argv);

async function findOpenPort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No open port found near ${preferred}`);
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => server.close(() => resolvePort(true)));
    server.listen(port, '127.0.0.1');
  });
}

function parseParserSelection(value: string): ParserSelection {
  if (value === 'auto' || value === 'hermes' || value === 'openclaw') {
    return value;
  }
  throw new Error(`Unknown parser ${value}. Expected auto, hermes, or openclaw.`);
}