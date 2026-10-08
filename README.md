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


## 24/7 research simulator through year end

The server now starts a **local paper research simulator** automatically when `SIMULATOR_ENABLED=true`. It does not send broker orders.

What it records on every newly closed M5 candle:
- OANDA quote and spread
- closed M5 + M10 indicator context
- 10m macro SMA20 state
- 5m Bollinger Bands (20, 2σ)
- RSI(14)
- volume and VMA20
- LONG / SHORT / WAIT decision and reasons
- Ollama review for actionable signals
- simulated balance, open paper position, marked equity and risk-lock state
- errors and restarts

Paper-trade behavior:
- one simulated position at a time
- EUR/USD and GBP/USD entries only for now, because their quote currency is USD and P/L sizing is direct
- USD/JPY is still analyzed/logged but signals are not opened until cross-currency P/L conversion is implemented
- 0.25% risk budget per simulated trade
- 0.8% hard stop
- rolling 24h 3% kill switch based on marked simulator equity
- exit on hard stop or a confirmed opposite strategy signal
- Ollama can veto a paper entry but cannot loosen risk

Fimathe concepts from the supplied training material are logged as an observation layer (Zona Neutra, Canal de Referência, 50% context, Stop Fora da Caixinha), but Fimathe entries are **not automated yet** because the exact channel-construction math is not sufficiently deterministic in the supplied transcripts. Nothing is guessed.

Persistent files:
- `logs/simulator/YYYY-MM-DD.jsonl` — every candle decision, quote, mark, skip and error
- `logs/simulator/trades.jsonl` — paper opens/closes and P/L
- `logs/simulator-runner.log` — process crashes/restarts
- `data/simulator-state.json` — position, balance, last processed candles, counters
- `data/simulator-risk.json` — rolling drawdown history

Default stop date:
`2027-01-01T00:00:00-05:00`

To run only the research engine day and night on Windows, double-click:

`RUN-SIMULATOR-24-7.bat`

The runner verifies the project first, starts Ollama if available, runs the server, and automatically restarts the server after a crash.

Simulator status:
`http://127.0.0.1:8790/api/simulator`

## Fimathe experimental paper engine (proxy v1)
The six course lessons motivate D/W macro context, M1 channel breaks, a neutral zone and stops outside the reference box. They **do not mathematically specify how to pick the channel anchors**. This isolated engine deliberately uses the 20 previous *completed* M1 candles as a channel and requires a breakout aligned with the previous *completed* daily candle's direction. The 20-bar lookback, breakeven at +1R, 2R target and 10x cap are research assumptions, **not the creator's verified Fimathe rules**. It uses bid/ask-aware virtual fills and no broker write methods. $1,000 virtual starting balance, 0.25% risk budget, structural stop no wider than 0.8%, 3% rolling-24h loss guard. Only USD-quoted EUR_USD / GBP_USD paper entries are supported; USD_JPY remains observation-only. The existing strategies and OANDA practice mirror are untouched.

Files to preserve: `data/fimathe-paper-state.json`, `data/fimathe-paper-risk.json`, `logs/fimathe-paper/YYYY-MM-DD.jsonl`, and `logs/fimathe-paper/trades.jsonl`. Never reset these silently. Rule changes require a new experiment/version. The dashboard scoreboard reads closed-trade performance separately from this experiment. Dedicated panel includes balance, open P/L, positions, and decision counts. The raw Fimathe-market logger stays unchanged.
