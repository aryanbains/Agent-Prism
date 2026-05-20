import { BarChart3, CircleDollarSign, HeartPulse, RefreshCw, Search, TerminalSquare, Wrench } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import type { CostStats, HealthStats, ModelCall, RunTree, Session, SessionTreeResponse, ToolCall } from './api.js';
import { getJson } from './api.js';

Chart.register(...registerables);

type View = 'timeline' | 'cost' | 'inspector' | 'health';
type Inspectable = { kind: 'tool'; item: ToolCall } | { kind: 'model'; item: ModelCall } | undefined;

export function App() {
  const [view, setView] = useState<View>('timeline');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [tree, setTree] = useState<SessionTreeResponse>();
  const [cost, setCost] = useState<CostStats>();
  const [health, setHealth] = useState<HealthStats>();
  const [inspecting, setInspecting] = useState<Inspectable>();
  const [query, setQuery] = useState('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      setError(undefined);
      const nextSessions = await getJson<Session[]>('/api/sessions?limit=100');
      setSessions(nextSessions);
      const nextSelected = selectedSessionId ?? nextSessions[0]?.id;
      setSelectedSessionId(nextSelected);
      const [nextCost, nextHealth] = await Promise.all([
        getJson<CostStats>('/api/stats/cost'),
        getJson<HealthStats>('/api/stats/health')
      ]);
      setCost(nextCost);
      setHealth(nextHealth);
      if (nextSelected) {
        setTree(await getJson<SessionTreeResponse>(`/api/sessions/${nextSelected}/tree`));
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    void getJson<SessionTreeResponse>(`/api/sessions/${selectedSessionId}/tree`).then(setTree).catch((loadError) => setError(loadError.message));
  }, [selectedSessionId]);

  useEffect(() => {
    const events = new EventSource('/api/stream');
    events.addEventListener('ready', () => setLive(true));
    events.addEventListener('trace-update', () => void refresh());
    events.onerror = () => setLive(false);
    return () => events.close();
  }, [selectedSessionId]);

  const filteredTree = useMemo(() => filterTree(tree?.tree ?? [], query), [tree, query]);

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <h1>Agent Prism</h1>
          <p>{tree?.session.name ?? 'Local agent trace dashboard'}</p>
        </div>
        <div class="topbar-actions">
          <span class={`live-pill ${live ? 'is-live' : ''}`}>{live ? 'Live' : 'Offline'}</span>
          <button type="button" class="icon-button" aria-label="Refresh dashboard" onClick={() => void refresh()}><RefreshCw size={18} /></button>
        </div>
      </header>

      <section class="workspace-grid">
        <aside class="sidebar">
          <label class="field-label" for="session">Session</label>
          <select id="session" value={selectedSessionId} onChange={(event) => setSelectedSessionId((event.currentTarget as HTMLSelectElement).value)}>
            {sessions.map((session) => <option value={session.id} key={session.id}>{session.name ?? session.id}</option>)}
          </select>
          <nav class="view-tabs" aria-label="Dashboard views">
            <Tab active={view === 'timeline'} label="Timeline" icon={<TerminalSquare size={17} />} onClick={() => setView('timeline')} />
            <Tab active={view === 'cost'} label="Cost" icon={<CircleDollarSign size={17} />} onClick={() => setView('cost')} />
            <Tab active={view === 'inspector'} label="Inspector" icon={<Wrench size={17} />} onClick={() => setView('inspector')} />
            <Tab active={view === 'health'} label="Health" icon={<HeartPulse size={17} />} onClick={() => setView('health')} />
          </nav>
          <div class="summary-strip">
            <Metric label="Spend" value={`$${(tree?.session.totalCostUSD ?? 0).toFixed(4)}`} />
            <Metric label="Latency" value={formatMs(tree?.session.latencyMs)} />
            <Metric label="Tokens" value={String(tree?.session.totalTokens.total ?? 0)} />
          </div>
        </aside>

        <section class="content-surface">
          {error && <div class="error-banner">{error}</div>}
          {sessions.length === 0 ? <EmptyState /> : null}
          {view === 'timeline' && <TimelineView tree={filteredTree} query={query} setQuery={setQuery} onInspect={(item) => { setInspecting(item); setView('inspector'); }} />}
          {view === 'cost' && <CostView cost={cost} />}
          {view === 'inspector' && <InspectorView inspecting={inspecting} tree={tree?.tree ?? []} onInspect={setInspecting} />}
          {view === 'health' && <HealthView health={health} />}
        </section>
      </section>
    </main>
  );
}

function Tab({ active, label, icon, onClick }: { active: boolean; label: string; icon: preact.ComponentChildren; onClick: () => void }) {
  return <button type="button" class={`tab-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div class="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function TimelineView({ tree, query, setQuery, onInspect }: { tree: RunTree[]; query: string; setQuery: (value: string) => void; onInspect: (item: NonNullable<Inspectable>) => void }) {
  return (
    <div class="view-stack">
      <div class="view-header">
        <div><h2>Session Timeline</h2><p>Agent handoffs, tools, model calls, latency, and cost.</p></div>
        <label class="search-box"><Search size={17} /><input value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} placeholder="Filter agents or tools" /></label>
      </div>
      <div class="timeline-tree">
        {tree.map((run) => <RunNode key={run.id} run={run} depth={0} onInspect={onInspect} />)}
      </div>
    </div>
  );
}

function RunNode({ run, depth, onInspect }: { run: RunTree; depth: number; onInspect: (item: NonNullable<Inspectable>) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div class="tree-node" style={{ '--depth': depth } as any}>
      <button type="button" class="run-row" onClick={() => setOpen(!open)}>
        <span class={`status-dot ${run.status}`} />
        <strong>{run.agentName}</strong>
        <span>{formatMs(run.latencyMs)}</span>
        <span>${run.costUSD.toFixed(4)}</span>
      </button>
      {open && <div class="node-children">
        {run.toolCalls.map((tool) => <button type="button" class="call-row" key={tool.id} onClick={() => onInspect({ kind: 'tool', item: tool })}><Wrench size={15} /><span>{tool.toolName}</span><small>{formatMs(tool.latencyMs)} · ${tool.costUSD.toFixed(4)}</small></button>)}
        {run.modelCalls.map((model) => <button type="button" class="call-row model" key={model.id} onClick={() => onInspect({ kind: 'model', item: model })}><BarChart3 size={15} /><span>{model.model ?? model.method}</span><small>{model.tokens.total} tokens · ${model.costUSD.toFixed(4)}</small></button>)}
        {run.children.map((child) => <RunNode key={child.id} run={child} depth={depth + 1} onInspect={onInspect} />)}
      </div>}
    </div>
  );
}

function CostView({ cost }: { cost?: CostStats }) {
  useChart('agent-cost-chart', cost?.costByAgent.map((item) => item.agentName) ?? [], cost?.costByAgent.map((item) => item.costUSD) ?? [], 'bar');
  useChart('cost-line-chart', cost?.costOverTime.map((item) => new Date(item.startedAt).toLocaleTimeString()) ?? [], cost?.costOverTime.map((item) => item.costUSD) ?? [], 'line');
  return (
    <div class="view-stack">
      <div class="view-header"><div><h2>Cost Dashboard</h2><p>Spend, tokens, and expensive calls.</p></div><strong>${(cost?.totalCostUSD ?? 0).toFixed(6)}</strong></div>
      <div class="chart-grid"><canvas id="agent-cost-chart" /><canvas id="cost-line-chart" /></div>
      <div class="table-wrap"><table><thead><tr><th>Call</th><th>Kind</th><th>Latency</th><th>Cost</th></tr></thead><tbody>{cost?.expensiveCalls.map((call) => <tr key={call.id}><td>{call.name}</td><td>{call.kind}</td><td>{formatMs(call.latencyMs)}</td><td>${call.costUSD.toFixed(5)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function InspectorView({ inspecting, tree, onInspect }: { inspecting: Inspectable; tree: RunTree[]; onInspect: (item: Inspectable) => void }) {
  const allCalls = flattenCalls(tree);
  return (
    <div class="inspector-layout">
      <div class="call-list">
        {allCalls.map((entry) => <button type="button" class="call-list-item" key={`${entry.kind}-${entry.item.id}`} onClick={() => onInspect(entry)}>{entry.kind === 'tool' ? <Wrench size={15} /> : <BarChart3 size={15} />}<span>{entry.kind === 'tool' ? entry.item.toolName : entry.item.model ?? entry.item.method}</span></button>)}
      </div>
      <div class="json-panel">
        {!inspecting ? <p class="muted">Select a tool or model call to inspect its payload.</p> : <>
          <h2>{inspecting.kind === 'tool' ? inspecting.item.toolName : inspecting.item.model ?? inspecting.item.method}</h2>
          <div class="detail-grid"><Metric label="Latency" value={formatMs(inspecting.item.latencyMs)} /><Metric label="Cost" value={`$${inspecting.item.costUSD.toFixed(5)}`} /><Metric label="Status" value={inspecting.item.status} /></div>
          {inspecting.item.error && <div class="error-banner">{inspecting.item.error}</div>}
          <h3>Input</h3><pre>{JSON.stringify(inspecting.item.input, null, 2)}</pre>
          <h3>Output</h3><pre>{JSON.stringify(inspecting.item.output, null, 2)}</pre>
        </>}
      </div>
    </div>
  );
}

function HealthView({ health }: { health?: HealthStats }) {
  return (
    <div class="view-stack">
      <div class="view-header"><div><h2>Agent Health</h2><p>Reliability, latency, and failure patterns.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Runs</th><th>Success</th><th>Avg latency</th><th>P95</th><th>Avg cost</th></tr></thead><tbody>{health?.agents.map((agent) => <tr key={agent.agentName}><td>{agent.agentName}</td><td>{agent.runCount}</td><td>{(agent.successRate * 100).toFixed(1)}%</td><td>{formatMs(agent.averageLatencyMs)}</td><td>{formatMs(agent.p95LatencyMs)}</td><td>${agent.averageCostUSD.toFixed(5)}</td></tr>)}</tbody></table></div>
      <div class="failure-list">{health?.failures.map((failure) => <div class="failure-row" key={failure.reason}><span>{failure.reason}</span><strong>{failure.count}</strong></div>)}</div>
    </div>
  );
}

function EmptyState() {
  return <div class="empty-state"><h2>No traces yet</h2><p>Run <code>agent-prism demo</code> or <code>agentprism demo</code> to populate the dashboard.</p></div>;
}

function useChart(id: string, labels: string[], values: number[], type: 'bar' | 'line') {
  useEffect(() => {
    const element = document.getElementById(id) as HTMLCanvasElement | null;
    if (!element) return;
    const colors = chartColors(element);
    const chart = new Chart(element, {
      type,
      data: { labels, datasets: [{ label: 'USD', data: values, borderColor: colors.accent, backgroundColor: colors.accentSoft, tension: 0.35 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: colors.text,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: colors.grid }, ticks: { color: colors.muted } },
          y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.muted } }
        }
      }
    });
    return () => chart.destroy();
  }, [id, labels.join('|'), values.join('|'), type]);
}

function chartColors(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    accent: style.getPropertyValue('--accent').trim() || '#2563eb',
    accentSoft: style.getPropertyValue('--accent-soft').trim() || 'rgba(37,99,235,0.18)',
    text: style.getPropertyValue('--text').trim() || '#17202a',
    muted: style.getPropertyValue('--muted').trim() || '#64748b',
    grid: style.getPropertyValue('--line').trim() || '#d9e2ec'
  };
}

function flattenCalls(tree: RunTree[]): Array<NonNullable<Inspectable>> {
  return tree.flatMap((run) => [
    ...run.toolCalls.map((item) => ({ kind: 'tool' as const, item })),
    ...run.modelCalls.map((item) => ({ kind: 'model' as const, item })),
    ...flattenCalls(run.children)
  ]);
}

function filterTree(tree: RunTree[], query: string): RunTree[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tree;
  return tree.flatMap((run) => {
    const children = filterTree(run.children, query);
    const toolCalls = run.toolCalls.filter((call) => call.toolName.toLowerCase().includes(needle));
    const modelCalls = run.modelCalls.filter((call) => (call.model ?? call.method).toLowerCase().includes(needle));
    const matches = run.agentName.toLowerCase().includes(needle) || toolCalls.length > 0 || modelCalls.length > 0 || children.length > 0;
    return matches ? [{ ...run, children, toolCalls: toolCalls.length ? toolCalls : run.toolCalls, modelCalls: modelCalls.length ? modelCalls : run.modelCalls }] : [];
  });
}

function formatMs(value?: number): string {
  if (!value) return '0ms';
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}