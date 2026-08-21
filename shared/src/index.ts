import Decimal from 'decimal.js'

export type MarketType = 'stock' | 'crypto' | 'forex'
export type Direction = 'long' | 'short'
export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop'
export type DataFreshness = 'REAL-TIME' | 'DELAYED' | 'CACHED' | 'MARKET CLOSED'

export interface Quote { symbol:string; price:string; change:string; changePercent:string; updatedAt:string; freshness:DataFreshness; marketOpen?:boolean }
export interface Candle { time:number; open:string; high:string; low:string; close:string; volume?:string }
export interface SymbolSearchResult { symbol:string; name:string; market:MarketType; provider:string }
export interface Position { id:string; symbol:string; market:MarketType; direction:Direction; quantity:string; entryPrice:string; currentPrice:string; unrealizedPnL:string; stopLoss?:string|null; takeProfit?:string|null; openedAt:string; leverage:string }
export interface Wallet { virtualBalance:string; buyingPower:string; portfolioValue:string; totalPnL:string; totalReturnPercent:string; accountResets:number }

export function d(v: Decimal.Value){ return new Decimal(v) }
export function calculatePnL(direction:Direction, entry:Decimal.Value, exit:Decimal.Value, quantity:Decimal.Value){
  const delta=d(exit).minus(entry); return (direction==='long'?delta:delta.neg()).mul(quantity)
}
export function calculateExposure(price:Decimal.Value, quantity:Decimal.Value){ return d(price).mul(quantity) }
export function calculateMargin(exposure:Decimal.Value, leverage:Decimal.Value){ const l=d(leverage); if(l.lte(0)) throw new Error('Leverage must be positive'); return d(exposure).div(l) }
export function calculateRiskReward(entry:Decimal.Value, stop:Decimal.Value, target:Decimal.Value){ const risk=d(entry).minus(stop).abs(); const reward=d(target).minus(entry).abs(); return risk.eq(0)?new Decimal(0):reward.div(risk) }
export function forexPipSize(symbol:string){ return symbol.toUpperCase().includes('JPY')?new Decimal('0.01'):new Decimal('0.0001') }
export function calculateForexPips(entry:Decimal.Value, exit:Decimal.Value, symbol:string, direction:Direction){ const raw=d(exit).minus(entry).div(forexPipSize(symbol)); return direction==='long'?raw:raw.neg() }
export function applySpread(mid:Decimal.Value, spread:Decimal.Value, side:'buy'|'sell'){ const half=d(spread).div(2); return side==='buy'?d(mid).plus(half):d(mid).minus(half) }
