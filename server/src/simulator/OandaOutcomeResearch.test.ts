import {describe,it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {OandaOutcomeResearch,verifiedMirrorIds,featuresFromCandles} from './OandaOutcomeResearch.js'

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
  let calls=0;const candleTimes:string[]=[]
  const fake={closedTrades:async()=>{calls++;return[trade('6','-43.34'),trade('700','240')]},
   candlesBefore:async(_symbol:string,tf:'M5'|'M10',time:string)=>{candleTimes.push(time);return bars(tf==='M5'?35:25,tf==='M5'?5:10)}}
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
  expect(s.examples[0].charts?.beforeEntry).toHaveLength(35)
  expect(s.examples[0].charts?.beforeExit).toHaveLength(35)
  expect(r.lessonsFor('GBP_USD')[0].chartEvidence?.beforeExitCloses).toHaveLength(12)
  expect(r.lessonsFor('EUR_USD')).toEqual([])
  expect(r.completedSince('2026-10-09T00:00:00Z')).toHaveLength(1)
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
