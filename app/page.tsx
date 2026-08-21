"use client";

import { useCallback, useEffect, useState } from "react";
import type { CycleState, JournalEntry, LogEntry, PaperPortfolio } from "@/lib/types";

interface StateResponse {
  state: CycleState | null;
  portfolio: PaperPortfolio;
  journal: JournalEntry[];
  logs: LogEntry[];
  env: { hasAnthropicKey: boolean; hasOpenAIKey: boolean; persistentStore: boolean };
}

const STATUS_TONE: Record<string, string> = {
  WAITING: "neutral", RUNNING: "good", REQUESTING_DATA: "info", REVIEWING: "info",
  APPROVED: "good", REJECTED: "critical", BLOCKED: "warn", EXECUTING: "good", ERROR: "critical",
};

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="pill-dot" />
      {label}
    </span>
  );
}

function fmtUSD(n: number, showPlus = false) {
  const sign = n < 0 ? "-" : showPlus ? "+" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Page() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/cycle", { method: "POST" });
      if (!res.ok) throw new Error(`/api/cycle returned ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  const state = data?.state ?? null;
  const portfolio = data?.portfolio;
  const equity = portfolio ? portfolio.cash + portfolio.realizedPnl : null;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">OBSIDIAN DESK</span>
          <span className="brand-tag">Live — Gold Desk, paper trading only</span>
        </div>
        <div className="status-note">
          {data && !data.env.hasAnthropicKey && <Pill label="No Anthropic key" tone="critical" />}
          {data && !data.env.hasOpenAIKey && <Pill label="No OpenAI key (News/Bear fall back to Claude)" tone="warn" />}
          {data && !data.env.persistentStore && <Pill label="No persistent store — using in-memory state" tone="warn" />}
          <button className="btn btn-accent" onClick={runNow} disabled={running}>
            {running ? "Running cycle…" : "Run cycle now"}
          </button>
        </div>
      </div>

      {error && <div className="banner critical">Couldn&rsquo;t load state: {error}</div>}
      {state?.error && <div className="banner critical">{state.error}</div>}
      {!state && !error && <div className="banner">No cycle has run yet. Click &ldquo;Run cycle now&rdquo;, or wait for the scheduled cron.</div>}

      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <div className="kpi-tile">
          <div className="kpi-label">Paper Equity</div>
          <div className="kpi-value">{equity != null ? fmtUSD(equity) : "—"}</div>
          <div className="kpi-sub">Starting {portfolio ? fmtUSD(portfolio.startingEquity) : "—"}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Realized P&amp;L</div>
          <div className={`kpi-value ${portfolio && portfolio.realizedPnl >= 0 ? "up" : "down"}`}>
            {portfolio ? fmtUSD(portfolio.realizedPnl, true) : "—"}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Open Position</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>
            {portfolio?.position
              ? <Pill label={`${portfolio.position.side} ${portfolio.position.size.toFixed(3)} oz`} tone={portfolio.position.side === "LONG" ? "good" : "critical"} />
              : <Pill label="Flat" tone="neutral" />}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Gold Spot</div>
          <div className="kpi-value">{state?.gold ? state.gold.price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}</div>
          <div className="kpi-sub">{state?.gold ? `as of ${new Date(state.gold.updatedAt).toLocaleTimeString()}` : "—"}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Last Cycle</div>
          <div className="kpi-value" style={{ fontSize: 15 }}>{state ? new Date(state.ranAt).toLocaleTimeString() : "—"}</div>
          <div className="kpi-sub">{state?.cycleId ?? "—"}</div>
        </div>
      </div>

      <div className="grid g-12" style={{ marginBottom: 14 }}>
        <div className="card" style={{ gridColumn: "span 7" }}>
          <div className="card-head"><span className="card-title">Agent Network — this cycle</span></div>
          {state?.agents?.length ? (
            <div className="node-grid">
              {state.agents.map((a) => (
                <div className="node" key={a.id}>
                  <div className="node-name">{a.name}</div>
                  <div className="node-model">{a.model}{a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)}%` : ""}</div>
                  <div style={{ marginBottom: 6 }}><Pill label={a.status.replace(/_/g, " ")} tone={STATUS_TONE[a.status] || "neutral"} /></div>
                  <div className="node-output">{a.error ?? a.output}</div>
                </div>
              ))}
            </div>
          ) : <div className="card-meta">No agents have run yet.</div>}
        </div>

        <div className="card" style={{ gridColumn: "span 5" }}>
          <div className="card-head"><span className="card-title">Judge &amp; Risk</span></div>
          {state?.judge ? (
            <>
              <div style={{ marginBottom: 10 }}>
                <Pill label={state.judge.call.replace("_", " ")} tone={state.judge.call === "NO_TRADE" ? "neutral" : "warn"} />
              </div>
              <dl className="kv" style={{ marginBottom: 12 }}>
                <dt>Confidence</dt><dd>{(state.judge.confidence * 100).toFixed(0)}%</dd>
                {state.judge.entry != null && <><dt>Entry</dt><dd>{state.judge.entry}</dd></>}
                {state.judge.stop != null && <><dt>Stop</dt><dd>{state.judge.stop}</dd></>}
                {state.judge.target != null && <><dt>Target</dt><dd>{state.judge.target}</dd></>}
              </dl>
              <div className="card-meta" style={{ marginBottom: 10 }}>{state.judge.reasoning}</div>
              {state.risk && (
                <>
                  <div className="hairline" />
                  <div style={{ marginBottom: 6 }}><Pill label={state.risk.outcome} tone={state.risk.outcome === "BLOCKED" ? "critical" : state.risk.outcome === "REDUCED" ? "warn" : "good"} /></div>
                  <div className="card-meta">{state.risk.reason}</div>
                </>
              )}
            </>
          ) : <div className="card-meta">No decision yet this cycle.</div>}
        </div>
      </div>

      <div className="grid g-12" style={{ marginBottom: 14 }}>
        <div className="card" style={{ gridColumn: "span 7" }}>
          <div className="card-head"><span className="card-title">Trade Journal (paper)</span><span className="card-meta">{data?.journal.length ?? 0} entries</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Status</th></tr></thead>
              <tbody>
                {(data?.journal ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{new Date(t.t).toLocaleString()}</td>
                    <td>{t.side}</td>
                    <td className="mono">{t.entry?.toFixed(2) ?? "—"}</td>
                    <td className="mono">{t.exit?.toFixed(2) ?? "—"}</td>
                    <td className={`mono ${t.pnl >= 0 ? "up" : "down"}`}>{fmtUSD(t.pnl, true)}</td>
                    <td><Pill label={t.status} tone={t.status === "OPEN" ? "good" : t.status === "CLOSED" ? "info" : "critical"} /></td>
                  </tr>
                ))}
                {(!data || data.journal.length === 0) && <tr><td colSpan={6} className="card-meta">No trades yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ gridColumn: "span 5" }}>
          <div className="card-head"><span className="card-title">Agent Logs</span></div>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Time</th><th>Agent</th><th>Message</th></tr></thead>
              <tbody>
                {(data?.logs ?? []).map((l, i) => (
                  <tr key={i}>
                    <td className="mono">{new Date(l.t).toLocaleTimeString()}</td>
                    <td>{l.agent}</td>
                    <td>{l.msg}</td>
                  </tr>
                ))}
                {(!data || data.logs.length === 0) && <tr><td colSpan={3} className="card-meta">No log entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card-meta" style={{ textAlign: "center", marginTop: 8 }}>
        Paper trading only — no broker or exchange account is connected. Auto-refreshes every 30s.
      </div>
    </div>
  );
}
