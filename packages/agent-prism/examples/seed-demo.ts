import { createTracer } from '../src/index.js';
import { resolve } from 'node:path';

const baseDirectory = process.env.INIT_CWD ?? process.cwd();
const dbPath = resolve(baseDirectory, process.env.AGENT_PRISM_DB_PATH ?? './agent-prism.db');
const lens = createTracer({ dbPath });
const orchestrator = lens.startRun('orchestrator-agent', { input: { task: 'renewal email' }, sessionName: 'Seeded demo' });

await orchestrator.toolCall('classify_intent', { text: 'renewal email' }, async () => ({ intent: 'sales' }));
const sales = orchestrator.startChild('sales-agent', { input: { accountId: 'acct_123' } });
await sales.toolCall('search_crm', { accountId: 'acct_123' }, async () => ({ tier: 'enterprise', renewalDate: '2026-06-01' }));
sales.recordModelCall({ provider: 'anthropic', method: 'messages.create', model: 'claude-sonnet-4-6', tokens: { input: 1000, output: 500 }, output: { text: 'Drafted renewal email' } });
sales.end({ output: { email: 'Drafted renewal email' } });
const memory = orchestrator.startChild('memory-agent', { input: { accountId: 'acct_123' } });
await memory.toolCall('store_context', { accountId: 'acct_123' }, async () => ({ stored: true }));
memory.end({ output: { stored: true } });
orchestrator.end({ output: { ready: true } });
lens.shutdown();
console.log(`Seeded ${dbPath}`);