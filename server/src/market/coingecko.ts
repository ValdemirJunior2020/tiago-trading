import type { MarketDataProvider } from './types.js'
import type {
  Candle,
  MarketType,
  Quote,
  SymbolSearchResult,
} from '@tiago/shared'
import { Decimal } from 'decimal.js'

const ids: Record<string, string> = {
  'BTC-USD': 'bitcoin',
  'ETH-USD': 'ethereum',
  'SOL-USD': 'solana',
  'XRP-USD': 'ripple',
  'DOGE-USD': 'dogecoin',
  'ADA-USD': 'cardano',
}

const BASE_URL = 'https://api.coingecko.com/api/v3'

export class CoinGeckoProvider implements MarketDataProvider {
  name = 'CoinGecko'

  constructor(private readonly apiKey?: string) {}

  configured() {
    return true
  }

  supports(m: MarketType) {
    return m === 'crypto'
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) return {}

    return {
      'x-cg-demo-api-key': this.apiKey,
    }
  }

  async searchSymbols(q: string): Promise<SymbolSearchResult[]> {
    const u = q.toUpperCase()

    return Object.keys(ids)
      .filter((s) => s.includes(u))
      .map((symbol) => ({
        symbol,
        name: ids[symbol],
        market: 'crypto' as const,
        provider: this.name,
      }))
  }

  async getQuote(symbol: string): Promise<Quote> {
    const normalized = symbol.toUpperCase()
    const id = ids[normalized]

    if (!id) {
      throw new Error('Unsupported crypto symbol')
    }

    const url =
      `${BASE_URL}/simple/price` +
      `?ids=${encodeURIComponent(id)}` +
      `&vs_currencies=usd` +
      `&include_24hr_change=true` +
      `&include_last_updated_at=true`

    const r = await fetch(url, {
      headers: this.headers(),
    })

    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(
        `CoinGecko ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      )
    }

    const j: any = await r.json()

    const p = j[id]?.usd

    if (typeof p !== 'number') {
      throw new Error('Price unavailable')
    }

    const pct = new Decimal(j[id]?.usd_24h_change ?? 0)
    const change = new Decimal(p)
      .mul(pct)
      .div(100)

    const lastUpdatedUnix = j[id]?.last_updated_at

    return {
      symbol: normalized,
      price: String(p),
      change: change.toFixed(8),
      changePercent: pct.toFixed(4),
      updatedAt:
        typeof lastUpdatedUnix === 'number'
          ? new Date(lastUpdatedUnix * 1000).toISOString()
          : new Date().toISOString(),
      freshness: 'REAL-TIME',
    }
  }

  async getCandles(
    symbol: string,
    _m: MarketType,
    timeframe: string,
    limit: number,
  ): Promise<Candle[]> {
    const normalized = symbol.toUpperCase()
    const id = ids[normalized]

    if (!id) {
      throw new Error('Unsupported crypto symbol')
    }

    const days =
      timeframe === '1W'
        ? 90
        : timeframe === '1D'
          ? 30
          : timeframe === '4H'
            ? 7
            : 1

    const url =
      `${BASE_URL}/coins/${encodeURIComponent(id)}/ohlc` +
      `?vs_currency=usd` +
      `&days=${days}`

    const r = await fetch(url, {
      headers: this.headers(),
    })

    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(
        `CoinGecko ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      )
    }

    const rows: any[] = await r.json()

    return rows
      .slice(-limit)
      .map((x) => ({
        time: Math.floor(x[0] / 1000),
        open: String(x[1]),
        high: String(x[2]),
        low: String(x[3]),
        close: String(x[4]),
      }))
  }

  async getMarketStatus() {
    return {
      open: true,
      message: 'Crypto trades 24/7',
    }
  }
}