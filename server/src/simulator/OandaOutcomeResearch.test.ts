import {describe,it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {OandaOutcomeResearch,verifiedMirrorIds,featuresFromCandles,journeyGranularity,chartCoverage} from './OandaOutcomeResearch.js'

const dirs:string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
const bars=(n:number,timeStep:number)=>Array.from({length:n},(_,i)=>{
 const close=1.3+i*.0001
 return{time:new Date(Date.UTC(2026,9,8,8,i*timeStep)).toISOString(),
  open:close-.0001,high:close+.00025,low:close-.00025,close,volume:100+i}
})
const trade=(id:string,pl:string)=>({
 id,instrument:'GBP_USD',state:'CLOSED',initialUnits:'1200',realizedPL:pl,
 openTime:'2026-10-08T12:00:00.000Z',closeTime:'2026-10-09T12:00:00.000Z'
})
describe('OANDA read-only outcome attribution',()=>{
 it('recognizes confirmed mirror IDs but ignores arbitrary local paper results',()=>{
  const ids=verifiedMirrorIds([
   JSON.stringify({event:'SHADOW_PAPER_CLOSE',demoMirrorTradeId:'6',pnl:'900000'}),
   JSON.stringify({event:'SHADOW_DEMO_MIRROR_OPENED',tradeId:'15'}),
   JSON.stringify({event:'SHADOW_POSITION_MARK',tradeId:'16'}),
   '{bad json}'
  ].join('\n'))
  expect([...ids].sort()).toEqual(['15','6'])
 })
 it('uses broker-reported realized P/L, excludes manual trades, and observes pre-entry candles',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'oanda-outcome-test-'));dirs.push(dir)
  const log=join(dir,'trades.jsonl')
  writeFileSync(log,JSON.stringify({event:'SHADOW_DEMO_MIRROR_OPENED',tradeId:'6',realizedPL:'9999'})+'\n')
  let calls=0;const candleTimes:string[]=[];const timeframes:string[]=[]
  const fake={closedTrades:async()=>{calls++;return[trade('6','-43.34'),trade('700','240')]},
   candlesBefore:async(_symbol:string,tf:string,time:string)=>{candleTimes.push(time);timeframes.push(tf);return bars(50,5)},
   candlesDuring:async(_symbol:string,tf:string,from:string,to:string)=>{
    timeframes.push('FULL:'+tf);expect(from).toBe('2026-10-08T12:00:00.000Z')
    expect(to).toBe('2026-10-09T12:00:00.000Z')
    return bars(85,5)
   }}
  const r=new OandaOutcomeResearch(fake as any,{mirrorLogFile:log,now:()=>new Date('2026-10-09T14:00:00Z')})
  await r.refresh();await r.refresh()
  const s=r.snapshot()
  expect(calls).toBe(1)
  expect(s.status).toBe('READY')
  expect(s.summary.trades).toBe(1)
  expect(s.summary.netPL).toBe(-43.34)
  expect(s.summary.losses).toBe(1)
  expect(s.summary.featureSamples).toBe(1)
  expect(s.unattributedBrokerTrades).toBe(1)
  expect(s.examples[0].tradeId).toBe('6')
  expect(candleTimes).toContain('2026-10-08T12:00:00.000Z')
  expect(candleTimes).toContain('2026-10-09T12:00:00.000Z')
  expect(s.chartCoverage).toBe(1)
  expect(chartCoverage(s.examples[0].charts)).toBe(6)
  expect(s.examples[0].charts?.windows.map(w=>w.timeframe)).toEqual(['M1','M5','M10','M15','H1'])
  expect(s.examples[0].charts?.windows.every(w=>w.bars.length===50)).toBe(true)
  expect(s.examples[0].charts?.journey.bars).toHaveLength(85)
  expect(s.examples[0].charts?.journey.granularity).toBe('M10')
  expect(s.examples[0].charts?.source).toBe('OANDA_COMPLETED_MID_CANDLES')
  expect(timeframes).toContain('FULL:M10')
  expect(r.lessonsFor('GBP_USD')[0].chartEvidence?.entryWindows).toHaveLength(5)
  expect(r.lessonsFor('GBP_USD')[0].chartEvidence?.intratrade?.closes.length).toBeGreaterThan(0)
  expect(r.lessonsFor('EUR_USD')).toEqual([])
  expect(r.completedSince('2026-10-09T00:00:00Z')).toHaveLength(1)
 })
 it('picks a bounded timeframe for the complete trade history rather than inventing a long M1 path',()=>{
  const at='2026-10-08T00:00:00.000Z'
  const later=(m:number)=>new Date(Date.parse(at)+m*60000).toISOString()
  expect(journeyGranularity(at,later(80))).toBe('M1')
  expect(journeyGranularity(at,later(700))).toBe('M5')
  expect(journeyGranularity(at,later(1300))).toBe('M10')
  expect(journeyGranularity(at,later(7200))).toBe('H1')
  expect(journeyGranularity(at,later(30*1440))).toBe('H4')
  expect(journeyGranularity(at,later(110*1440))).toBe('D')
  expect(()=>journeyGranularity(at,at)).toThrow()
 })
 it('labels unavailable OANDA periods as partial, does not fabricate candles or broker profit',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'oanda-six-charts-missing-'));dirs.push(dir)
  const log=join(dir,'trades.jsonl')
  writeFileSync(log,JSON.stringify({event:'SHADOW_DEMO_MIRROR_OPENED',tradeId:'6'})+'\n')
  const fake={closedTrades:async()=>[trade('6','-43.34')],
   candlesBefore:async(_symbol:string,tf:string)=>{
    if(tf==='H1')throw Error('OANDA H1 history temporarily unavailable')
    return bars(50,5)
   },
   candlesDuring:async()=>{throw Error('No historical candles over this interval')}
  }
  const r=new OandaOutcomeResearch(fake as any,{mirrorLogFile:log,now:()=>new Date('2026-10-09T14:00:00Z')})
  await r.refresh()
  const result=r.snapshot()
  expect(result.status).toBe('READY')
  expect(result.chartCoverage).toBe(0)
  expect(result.chartPartial).toBe(1)
  expect(chartCoverage(result.examples[0].charts)).toBe(4)
  expect(result.examples[0].charts?.windows.find(w=>w.timeframe==='H1')?.bars).toEqual([])
  expect(result.examples[0].charts?.journey.complete).toBe(false)
  expect(result.summary.netPL).toBe(-43.34)
 })
 it('reports missing attribution honestly and never promotes unrelated account profits to Shadow',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'oanda-no-mirror-test-'));dirs.push(dir)
  const fake={closedTrades:async()=>[trade('500','999')],
   candlesBefore:async()=>{throw Error('should never look up unrelated trades')}}
  const r=new OandaOutcomeResearch(fake as any,{mirrorLogFile:join(dir,'missing.jsonl')})
  await r.refresh()
  expect(r.snapshot().summary.trades).toBe(0)
  expect(r.snapshot().unattributedBrokerTrades).toBe(1)
 })
 it('calculates RSI, Bollinger, volume ratio and macro direction from OANDA candles',()=>{
  const f=featuresFromCandles(bars(35,5),bars(25,10))
  expect(f.rsi14).toBeGreaterThan(0)
  expect(f.volumeRatio).toBeGreaterThan(0)
  expect(['ABOVE_UPPER','INSIDE','BELOW_LOWER']).toContain(f.bbPosition)
  expect(f.macroTrend).toBe('UP')
 })
})
