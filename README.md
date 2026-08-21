# TIAGO TRADING

**Real Market. Virtual Money.**

Tiago Trading is an educational paper-trading simulator. It starts each new account with **US$10,000 in virtual money**. It does not accept deposits, withdrawals, cards, brokerage connections, or real-money orders.

> **SIMULATOR — VIRTUAL MONEY**  
> Real market data. Simulated operations. No real money is used.

Market data may be real-time, delayed or cached depending on the selected provider. Nothing in this application is financial advice.

## What is implemented

The V1 includes Firebase email/password authentication, first-account bootstrap to $10,000 virtual cash, onboarding, responsive mobile navigation, stocks/crypto/forex market architecture, symbol search, real-provider quotes, candlestick data, paper LONG/SHORT trades, fractional quantities, forex leverage, server-side buying-power checks, Stop Loss and Take Profit processing, live/latest unrealized P&L, position closing, portfolio, trade history, watchlist, server-calculated leaderboard, educational challenges, three languages, Firebase-backed theme/language preferences, Market Intelligence, a rule-based trading coach, lessons, PWA support, Netlify config, Render config, Firestore rules, Vitest tests and Playwright smoke tests.

No production code creates synthetic prices, candles, news or fake real-time labels. If a provider is unavailable, the UI shows the error instead of inventing data.

## Architecture

```text
tiago-trading-project/
  client/                 React + TypeScript + Vite + Tailwind + PWA
  server/                 Node + TypeScript + Express + Firebase Admin
  shared/                 Shared financial types/calculations
  firestore.rules
  firestore.indexes.json
  firebase.json
  netlify.toml
  render.yaml
  package.json
  .env.example
  README.md
```

The backend is authoritative for virtual wallet balances, buying power, final P&L, position settlement and leaderboard results. The client sends the current Firebase ID token in `Authorization: Bearer <token>`. Firebase Admin verifies the token on the server.

## Firebase web project

The client is already configured for the Firebase web project specified for this build:

```text
projectId: crud-happens
```

The Firebase Web API key is a client configuration value and is present in `client/src/firebase.ts`. **Firebase Admin credentials must never be added to the frontend or committed to Git.**

Enable **Email/Password** in Firebase Authentication before testing sign-up.

Deploy the included Firestore rules:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

The rules allow users to edit safe profile/preferences/watchlist/journal/education data while denying client writes to wallets, positions, trades, leaderboard and other server-authoritative collections.

## Environment variables

Copy the examples:

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

Windows PowerShell:

```powershell
Copy-Item client/.env.example client/.env
Copy-Item server/.env.example server/.env
```

### `client/.env`

```env
VITE_API_BASE_URL=http://localhost:5000
```

### `server/.env`

```env
PORT=5000

TWELVE_DATA_API_KEY=
FINNHUB_API_KEY=
COINGECKO_API_KEY=

FIREBASE_PROJECT_ID=crud-happens
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

ALLOWED_ORIGINS=http://localhost:5173
```

For `FIREBASE_PRIVATE_KEY`, an env value containing literal `\n` is converted to real line breaks by the server config.

## Market data providers

The provider interface is in `server/src/market/types.ts`. Market access is selected by the backend, not the client.

Current V1 wiring:

- **CoinGecko**: crypto quotes and OHLC candles for the supported initial crypto symbols.
- **Twelve Data**: stocks and forex quotes, search and time-series candles when `TWELVE_DATA_API_KEY` is configured.

The architecture is intentionally replaceable. Add new providers under `server/src/market/` and register them in `server/src/market/service.ts` without changing trading screens.

Quotes use a short server cache. Candles use a longer cache. A cached quote is labeled `CACHED`; provider responses are not silently presented as live.

If no compatible provider is configured, the API returns:

```text
Market data provider not configured.
```

If an upstream provider fails, the UI returns a human-readable market-data error and never manufactures a replacement price.

## Local quick start

Requirements: Node.js 20+ (Node 22 recommended) and npm.

From the repository root:

```bash
npm install
npm run dev
```

This starts:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:5000
```

Health check:

```text
GET http://localhost:5000/health
```

returns:

```json
{"status":"ok"}
```

## Build and test

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Financial calculation tests live in `shared/src/index.test.ts` and server validation tests in `server/src/trading/engine.test.ts`.

They cover long profit/loss, short profit, margin, forex pips, spread math and buying-power validation. Playwright includes desktop and mobile auth-entry smoke tests.

## Paper-trading flow

1. Create a Firebase account with email/password.
2. The client obtains a Firebase ID token.
3. `POST /api/account/bootstrap` creates the virtual wallet only if it does not already exist.
4. The starting values are written server-side: `$10,000` virtual balance and buying power.
5. The user opens a real-provider market page.
6. The client requests the latest quote from the backend.
7. A simulated order posts to `POST /api/trade/open`.
8. The backend fetches a valid quote again, validates quantity, leverage and buying power with Decimal.js, then writes the virtual position.
9. `GET /api/trade/positions` refreshes latest prices and unrealized P&L. It also detects Stop Loss / Take Profit crossings when positions are checked.
10. Manual close or SL/TP settlement updates wallet values and permanent trade history in a Firestore transaction.

No Buy, Sell, Long or Short action calls a broker.

## Money math

Important financial calculations use `decimal.js`. Avoid adding calculations such as `0.1 + 0.2` directly into React components for wallet logic. Shared helpers live in `shared/src/index.ts`, and server order logic lives in `server/src/trading/engine.ts`.

Timestamps are saved as ISO/UTC or Firebase server timestamps and rendered in the user's local timezone.

## Mobile-first UI

The layout switches to bottom navigation below 900px and has additional styling for 560px and below. The main tested targets are intended to include 360px, 375px, 390px, 430px, tablet and desktop widths. Tables become horizontally scrollable within their own container rather than forcing the whole page to overflow.

The UI does not use red/green alone for meaning: direction labels, signs, text and freshness badges accompany color.

## PWA / offline behavior

`vite-plugin-pwa` creates the installable shell and manifest. The app shell may open offline, but market data requests still require a provider. Do not modify the UI to reuse stale market prices without a visible cached/offline label.

## Netlify

`netlify.toml` is configured at repository root. Set:

```env
VITE_API_BASE_URL=https://YOUR-RENDER-API.onrender.com
```

The SPA redirect sends application routes to `client/dist/index.html`.

## Render

`render.yaml` builds the shared package and server from the monorepo root. Add the server environment variables in Render. Set `ALLOWED_ORIGINS` to your deployed Netlify origin, for example:

```env
ALLOWED_ORIGINS=https://your-tiago-trading.netlify.app
```

Do not expose Firebase Admin credentials anywhere in the client.

## Adding a market provider

Implement the `MarketDataProvider` interface:

```ts
interface MarketDataProvider {
  name: string
  configured(): boolean
  supports(market): boolean
  searchSymbols(...): Promise<...>
  getQuote(...): Promise<...>
  getCandles(...): Promise<...>
  getMarketStatus(...): Promise<...>
}
```

Then add it to the provider list in `server/src/market/service.ts`. Keep API credentials server-side.

## Troubleshooting

**Firebase Admin is not configured** — add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` to `server/.env` or Render.

**Market data provider not configured** — configure Twelve Data for stock/forex. Crypto uses the public CoinGecko implementation in this V1, subject to CoinGecko availability/rate limits.

**CORS error** — ensure `ALLOWED_ORIGINS` contains the exact frontend origin. Multiple origins can be comma-separated.

**401 Invalid or expired token** — sign out/in again and verify frontend and Firebase Admin point to the same Firebase project.

**Charts unavailable** — the selected provider/timeframe may not offer enough candle data. Tiago Trading intentionally does not fabricate missing candles.

## Security notes

- No brokerage integration exists.
- No deposit or withdrawal endpoints exist.
- No card or Stripe integration exists.
- Wallet/trade/leaderboard writes are denied to the Firebase client.
- Firebase Admin credentials are server-only.
- Express uses Helmet, CORS allow-listing, JSON size limits and rate limiting.
- Zod validates market/trading request inputs.
- Leaderboard exposes display name and performance only; it does not expose email or UID.
- `.env` files and secrets are ignored by Git.

## Disclaimer

**English:** Tiago Trading is an educational paper-trading simulator. No real money or real brokerage orders are involved. Market data may be real-time, delayed or cached depending on the selected data provider. Nothing in this application is financial advice.

**Português:** Tiago Trading é um simulador educacional de paper trading. Nenhum dinheiro real ou ordem para corretora real está envolvido. Os dados de mercado podem ser em tempo real, atrasados ou em cache, dependendo do provedor selecionado. Nada neste aplicativo constitui aconselhamento financeiro.

**Español:** Tiago Trading es un simulador educativo de paper trading. No interviene dinero real ni órdenes para corredores reales. Los datos de mercado pueden ser en tiempo real, retrasados o almacenados en caché según el proveedor seleccionado. Nada en esta aplicación constituye asesoramiento financiero.
#   t i a g o - t r a d i n g  
 