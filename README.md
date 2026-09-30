# ProfitMind Forex / Tiago Bot Forex

Local-first Forex analysis and risk-control system using TypeScript, React, OANDA market/account data and local Ollama.

## Current working scope
- Reads live OANDA account state, positions and Forex quotes.
- Dashboard refreshes balance, equity, margin, positions and EUR/USD, GBP/USD, USD/JPY quotes.
- Uses local Ollama as a secondary trade critic.
- Builds deterministic trade plans with a 0.8% protective-stop reference.
- Revalidates a real/manual fill against the 0.1% slippage ceiling and recalculates the 0.8% stop from that actual fill.
- Risks 0.25% of equity per planned trade.
- Enforces a 3% rolling-24h drawdown kill switch.
- Persists rolling equity history under `data/risk-equity.json`, so restarting the server does not reset the 24h drawdown guard.
- English + Português do Brasil UI.

## Safety boundary
This repository intentionally does **not** submit, modify or close real-money broker orders automatically. Broker write methods are not implemented. It produces validated trade plans for manual review/execution.

The Fimathe material is being incorporated as a strategy-analysis layer, but the exact automated channel construction must only use rules that are sufficiently defined and validated; undocumented rules are not guessed.

## Start
Put your OANDA credentials only in the local `.env` file (never commit it), then:

```bash
npm install
npm run verify
npm run dev
```

Or on Windows, double-click `START.bat`.

Expected local addresses:
- Dashboard: http://127.0.0.1:5173
- Server health: http://127.0.0.1:8790/health

A healthy response should report `broker: true` when OANDA is reachable and `ollama: true` when the local Ollama service is running.

## Risk rules
- Hard stop reference: 0.8%
- Maximum slippage: 0.1%
- Per-trade risk budget: 0.25% of equity
- Rolling 24h kill switch: 3%

No trading system can guarantee profit.
