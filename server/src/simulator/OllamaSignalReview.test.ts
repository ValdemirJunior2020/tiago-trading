import {describe,it,expect} from 'vitest'
import {classifyRsi,questionableRsiReason,scanOllamaSetups,resolveWaitObservation} from './OllamaSignalReview.js'

const bars=(side:1|-1,count:number,minutes:number)=>{
 return Array.from({length:count},(_,i)=>{
  const close=1.10+side*i*.00004+(i%2?.00012:-.00012)
  return{time:new Date(Date.UTC(2026,9,9,10)+i*minutes*60000).toISOString(),
   open:close-.00002,high:close+.00025,low:close-.00025,close,volume:120+i}
 })
}
describe('isolated Ollama opportunity scanner',()=>{
 it('uses standard RSI zones: 35 and 36 are neutral, not oversold',()=>{
  expect(classifyRsi(29.99)).toBe('OVERSOLD')
  expect(classifyRsi(30)).toBe('NEUTRAL')
  expect(classifyRsi(35.5)).toBe('NEUTRAL')
  expect(classifyRsi(70)).toBe('NEUTRAL')
  expect(classifyRsi(70.1)).toBe('OVERBOUGHT')
 })
 it('detects affirmative hallucinated RSI explanations and accepts correct qualifiers',()=>{
  expect(questionableRsiReason('RSI is oversold', 'NEUTRAL')).toBe(true)
  expect(questionableRsiReason('RSI is neutral, not oversold', 'NEUTRAL')).toBe(false)
  expect(questionableRsiReason('RSI indicates overbought conditions', 'NEUTRAL')).toBe(true)
  expect(questionableRsiReason('RSI is oversold', 'OVERSOLD')).toBe(false)
  expect(questionableRsiReason('RSI14 is low (35.5) suggesting oversold', 'NEUTRAL')).toBe(true)
 })
 it('recognizes completed-candle uptrend, momentum and volume alignment',()=>{
  const s=scanOllamaSetups(bars(1,35,5),bars(1,25,10),1.5)
  expect(s.rsiZone).toBe('NEUTRAL')
  expect(s.score).toBe(5)
  expect(s.direction).toBe('BUY')
  expect(s.qualified).toBe(true)
 })
 it('rejects unconfirmed market signals rather than forcing a trade',()=>{
  const s=scanOllamaSetups(bars(1,35,5),bars(-1,25,10),1.5)
  expect(s.qualified).toBe(false)
  expect(s.direction).toBe('NONE')
  expect(s.score).toBeLessThan(5)
 })
 it('reviews a WAIT only after three future completed candles and deducts spread and both slippage sides',()=>{
  const m5=bars(1,30,5),w={
   symbol:'EUR_USD',direction:'BUY' as const,candleTime:m5[23].time,
   entryMid:m5[23].close,spreadPips:1.5,horizonCandles:3 as const
  }
  expect(resolveWaitObservation(w,m5.slice(0,26),.2)).toBeNull()
  const r=resolveWaitObservation(w,m5,.2)
  expect(r?.estimatedCostsPips).toBe(1.9)
  expect(r?.grossPips).toBeCloseTo((m5[26].close-m5[23].close)*10000,2)
  expect(r?.netMovementPips).toBeCloseTo(r!.grossPips-1.9,2)
 })
})
