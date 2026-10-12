# Tiago Trading — OANDA Practice Only

Two operational engines only: **Shadow 3/4** and **Ollama**. Both use the same
**OANDA Practice** account. The app rejects a Live OANDA REST endpoint.

## Single source of truth for financial results
- **OANDA account balance/equity/margin:** broker `/api/oanda-audit`, not a locally calculated P/L.
- **Shadow 3/4 realized P/L:** confirmed closed OANDA Trade IDs **linked to existing Shadow mirror audit logs**. Incomplete history/attribution is clearly marked. Shadow stops, trailing, entries, exits and its internal state machine are unchanged.
- **Shadow open P/L/position:** OANDA `openTrades` confirmed by the current broker mirror Trade ID. Missing match is a synchronization warning, never fabricated P/L.
- **Ollama realized/open P/L:** OANDA trades explicitly tagged `TIAGO_OLLAMA` and reconciled by broker Trade ID.
- **Historical Shadow chart lab:** six OANDA OHLC charts per attributed closed trade; indicators are observations and not returns.

A broker-confirmed **Practice** trade is an actual *demo-account* execution; it
does not represent earnings deposited in a Live account. Only the user may
authorize future separate Live account development.

## Retired engines
Strict 4/4 independent paper trading, No Macro + Early Exit, Fimathe, simulated
scoreboard and virtual P/L were removed. The former legacy `ResearchSimulator`,
virtual Ollama paper engine and virtual-memory research are not started.

## Start — Windows
Keep your existing local `.env` secret. Required keys:

```ini
OANDA_REST_BASE_URL=https://api-fxpractice.oanda.com
OANDA_ACCOUNT_ID=YOUR_PRACTICE_ACCOUNT_ID
OANDA_API_TOKEN=YOUR_PRACTICE_API_TOKEN
OANDA_DEMO_MIRROR_ENABLED=true
OLLAMA_OANDA_PRACTICE_MIRROR_ENABLED=true
```

Double-click **`RUN-TIAGO-OANDA.bat`** or `START.bat`; the previous
`RUN-SIMULATOR-24-7.bat` is a compatibility shortcut to the new runner.

Dashboard: http://127.0.0.1:5173  
Broker audit: http://127.0.0.1:8790/api/oanda-audit  
Broker-only engines: http://127.0.0.1:8790/api/engine  
Ollama broker reconciliation: http://127.0.0.1:8790/api/ollama-mirror

`npm run verify` runs TypeScript build and tests before any merge.

## Data retirement on the first restart after this update
The server performs a **one-time permanent purge** of known exclusive virtual
history: Strict, No Macro, Fimathe and virtual Ollama fills. The purge writes
`logs/maintenance/cleanup.jsonl` and `data/broker-only-cleanup-v1.json`.
If it cannot delete a locked file, it reports an error and retries on next start.

**Always preserved:** `.env`, `data/simulator-state.json` (legacy-named but still
contains the Shadow open position and broker Trade ID), `data/shadow-simulator-risk.json`,
`logs/shadow-paper/`, `logs/shadow-candidates/`, `data/ollama-oanda-mirror-state.json`,
`logs/ollama-paper/oanda-mirror.jsonl`, `data/ollama-signal-state.json`,
`logs/history/shadow-paper-trades.jsonl`, and original mixed historical ZIP
archives in `logs/history-inbox/`.

The Ollama legacy paper state is migrated to broker-only signal state **before**
its original virtual file is removed. Remaining shared Shadow data may contain
historically named `SHADOW_PAPER_*` events required for OANDA attribution and
recovery; these events are **never displayed as financial P/L**.

## No automatic Live trading
OANDA Practice orders have broker-side hard stops, validated margin and quote
checks. Ollama additionally uses tagged, idempotent Trade IDs, account-instrument
collision avoidance and a separate $1,000 research risk budget; it cannot
modify Shadow orders. No strategy guarantees profit.
