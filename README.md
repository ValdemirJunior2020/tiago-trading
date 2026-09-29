# ProfitMind Forex

Local-first Forex analysis and risk-control system using TypeScript, React and Ollama.

## What it does
- Reads live account, positions and Forex quotes from a configured broker account.
- Calculates LONG/SHORT candidates from closed-candle strategy logic.
- Uses local Ollama as a secondary trade critic.
- Calculates a deterministic 0.8% protective-stop level.
- Enforces 0.1% slippage and 3% rolling-24h drawdown rules in the local risk engine.
- Produces position-size calculations, trade plans and risk warnings.
- English + Português do Brasil.

## Safety boundary
This repository intentionally does **not** submit, modify or close real-money broker orders automatically. Broker write methods are not implemented. It produces validated trade plans for manual review/execution.

## Start
Copy `.env.example` to `.env`, add read-only broker credentials if your broker supports them, then:

```
npm install
npm run dev
```

No trading system can guarantee profit.
