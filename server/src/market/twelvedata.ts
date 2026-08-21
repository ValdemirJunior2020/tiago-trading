import type { MarketDataProvider } from './types.js'
import type {
  Candle,
  MarketType,
  Quote,
  SymbolSearchResult,
} from '@tiago/shared'
import { Decimal } from 'decimal.js'

export class TwelveDataProvider implements MarketDataProvider {
  constructor(private key?: string) {}

  name = 'Twelve Data'

  configured() {
    return !!this.key
  }

  supports(market: MarketType) {
    return market === 'stock' || market === 'forex'
  }

  private sym(symbol: string, market: MarketType) {
    return market === 'forex' ? symbol.replace('-', '/') : symbol
  }

  async searchSymbols(
    q: string,
    market?: MarketType,
  ): Promise<SymbolSearchResult[]> {
    if (!this.key) {
      throw new Error('Provider not configured')
    }

    const url =
      `https://api.twelvedata.com/symbol_search` +
      `?symbol=${encodeURIComponent(q)}` +
      `&apikey=${encodeURIComponent(this.key)}`

    const response = await fetch(url)
    const json: any = await response.json()

    if (!response.ok || json.status === 'error') {
      throw new Error(json.message || `Twelve Data ${response.status}`)
    }

    return (json.data || [])
      .slice(0, 15)
      .map((item: any) => ({
        symbol: String(item.symbol).replace('/', '-'),
        name: item.instrument_name || item.symbol,
        market: (
          market ||
          ((item.instrument_type || '')
            .toLowerCase()
            .includes('forex')
            ? 'forex'
            : 'stock')
        ) as MarketType,
        provider: this.name,
      }))
  }

  async getQuote(
    symbol: string,
    market: MarketType,
  ): Promise<Quote> {
    if (!this.key) {
      throw new Error('Provider not configured')
    }

    const url =
      `https://api.twelvedata.com/quote` +
      `?symbol=${encodeURIComponent(this.sym(symbol, market))}` +
      `&apikey=${encodeURIComponent(this.key)}`

    const response = await fetch(url)
    const json: any = await response.json()

    if (!response.ok || json.status === 'error') {
      throw new Error(json.message || `Twelve Data ${response.status}`)
    }

    if (json.close == null) {
      throw new Error('Quote unavailable')
    }

    const price = new Decimal(json.close)
    const previous = new Decimal(json.previous_close || json.close)
    const change = price.minus(previous)

    return {
      symbol,
      price: price.toString(),
      change: change.toString(),
      changePercent: previous.eq(0)
        ? '0'
        : change.div(previous).mul(100).toFixed(4),
      updatedAt: new Date().toISOString(),
      freshness: 'DELAYED',
      marketOpen: json.is_market_open !== false,
    }
  }

  async getCandles(
    symbol: string,
    market: MarketType,
    timeframe: string,
    limit: number,
  ): Promise<Candle[]> {
    if (!this.key) {
      throw new Error('Provider not configured')
    }

    const intervals: Record<string, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1H': '1h',
      '4H': '4h',
      '1D': '1day',
      '1W': '1week',
    }

    const interval = intervals[timeframe] || '1day'
    const safeLimit = Math.max(1, Math.min(Number(limit) || 120, 5000))

    const url =
      `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(this.sym(symbol, market))}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&outputsize=${safeLimit}` +
      `&order=ASC` +
      `&apikey=${encodeURIComponent(this.key)}`

    const response = await fetch(url)
    const json: any = await response.json()

    if (!response.ok || !Array.isArray(json.values)) {
      throw new Error(
        json.message || `Twelve Data ${response.status}: candles unavailable`,
      )
    }

    return json.values.map((item: any) => ({
      time: Math.floor(
        new Date(`${item.datetime}Z`).getTime() / 1000,
      ),
      open: String(item.open),
      high: String(item.high),
      low: String(item.low),
      close: String(item.close),
      volume:
        item.volume == null
          ? undefined
          : String(item.volume),
    }))
  }

  async getMarketStatus(
    symbol: string,
    market: MarketType,
  ) {
    const quote = await this.getQuote(symbol, market)

    return {
      open: quote.marketOpen !== false,
      message:
        quote.marketOpen === false
          ? 'Market closed'
          : 'Market open',
    }
  }
}
