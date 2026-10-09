# TIAGO — automatic old + new research log history

The **original** files in `logs/shadow-paper/`, `logs/simulator/`, `logs/no-macro-paper/`, `logs/ollama-paper/`, etc. remain unchanged. The history system is **read-only** toward all trading engines and OANDA. It cannot place orders or change risk settings.

## One-time historical import

1. On the Windows PC running Tiago, make the folder `logs/history-inbox/` in the local `tiago-trading` project.
2. Copy earlier log ZIPs into that folder (e.g. `Log-forex-old.zip`, `shadow-paper.zip`). No need to extract them. Nested ZIPs are supported. **Keep the originals as backups.**
3. Run the normal `RUN-SIMULATOR-24-7.bat`. The first sync imports the old history and then scans new logs **every 60 seconds** while the server runs.

The importer reads JSONL files inside the archives, including ZIPs inside ZIPs. Identical original event records are deduplicated by SHA-256, so overlapping backups do not inflate profits. Raw trade mark-to-market events are never counted as completed wins. `SHADOW_PAPER_CLOSE` is counted in Shadow and `SHADOW_DEMO_MIRROR_CLOSED` in OANDA Practice **separately**.

## Outputs — generated locally, never committed

- `logs/history/events.jsonl` — append-only unified audit feed with source, timestamp, event ID, archive/live origin and original payload.
- `logs/history/shadow-paper-trades.jsonl` — combined old + new Shadow history for **observation-only** memory research.
- `logs/history/summary.json` — cumulative closed trades, wins, losses, realized net P/L, and OANDA mirror errors by strategy.
- `logs/history/cursors.json` — per-file/ZIP checkpoints so only newly appended live data is processed.
- `http://127.0.0.1:8790/api/log-history` — latest summary, including any import errors.

**Important:** The API is only accessible on the local server. Historical internal profits are evidence for analysis; they are **not transferred into OANDA**. This feature doesn't retroactively open old trades.

If the server was already running when the code changed, restart the local runner once after `git pull` so the new history sync starts. Do not delete or reset `logs/` or `data/`.

### Limits

ZIP64, encrypted archives, unsupported compression methods and oversized members are not imported. Any ZIP import failure is reported in `summary.json` and the endpoint; originals are preserved. Only recognized strategy JSONL folders are catalogued, not arbitrary files or plaintext system logs.
