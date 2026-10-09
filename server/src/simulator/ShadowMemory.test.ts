import {describe,it,expect,afterEach} from 'vitest'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {parseShadowLessons,similarShadowLosses,ShadowMemory} from './ShadowMemory.js'
import {ShadowMemoryResearch} from './ShadowMemoryResearch.js'
const dirs:string[]=[]
const rows=[
{event:'SHADOW_PAPER_OPEN',at:'2026-10-08T11:00:00Z',symbol:'GBP_USD',direction:'short',entry:'1.32'},
{event:'SHADOW_PAPER_CLOSE',at:'2026-10-08T12:00:00Z',symbol:'GBP_USD',direction:'short',entry:'1.32',exit:'1.322',pnl:'-20',reason:'OPPOSITE'},
{event:'SHADOW_PAPER_OPEN',at:'2026-10-08T13:00:00Z',symbol:'EUR_USD',direction:'long',entry:'1.1'},
{event:'SHADOW_PAPER_CLOSE',at:'2026-10-08T14:00:00Z',symbol:'EUR_USD',direction:'long',entry:'1.1',exit:'1.104',pnl:'30',reason:'TARGET'}
].map(r=>JSON.stringify(r)).join('\n')
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
describe('Shadow historical memory, read-only',()=>{
 it('parses completed trades, deduplicates, ignores malformed rows and never treats position marks as realized',()=>{
  const a=parseShadowLessons(rows+'\nnot-json\n'+rows.split('\n')[1]+'\n'+JSON.stringify({event:'SHADOW_POSITION_MARK',pnl:'-99'}))
  expect(a).toHaveLength(2);expect(a[0].pnl).toBe(-20);expect(a[1].pnl).toBe(30)
  expect(similarShadowLosses(a,'GBP_USD','SHORT',1.32)).toHaveLength(1)
  expect(similarShadowLosses(a,'EUR_USD','LONG',1.1)).toHaveLength(0)
 })
 it('reads real Shadow logs without changing them and works without OpenViking',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shadow-memory-'));dirs.push(dir)
  const file=join(dir,'trades.jsonl');writeFileSync(file,rows)
  const memory=new ShadowMemory({tradeFile:file,dataFile:join(dir,'memory.json'),logFile:join(dir,'memory-events.jsonl'),endpoint:'http://127.0.0.1:1'})
  const before=readFileSync(file,'utf8')
  const out=await memory.sync()
  expect(out.total).toBe(2);expect(out.losses).toBe(1);expect(out.wins).toBe(1)
  expect(out.openViking).toBe('OFFLINE')
  expect(readFileSync(file,'utf8')).toBe(before)
 })
 it('produces separately logged advisory decisions, never creates or changes positions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shadow-advisor-'));dirs.push(dir)
  const file=join(dir,'trades.jsonl');writeFileSync(file,rows)
  const memory=new ShadowMemory({tradeFile:file,dataFile:join(dir,'memory.json'),logFile:join(dir,'mem.jsonl'),endpoint:'http://127.0.0.1:1'})
  await memory.sync()
  const candle=(n:number)=>Array.from({length:n},(_,i)=>({time:new Date(Date.UTC(2026,9,8,0,i*5)).toISOString(),open:1.32,high:1.33,low:1.31,close:1.32,volume:10}))
  const broker={quote:async()=>({symbol:'GBP_USD',bid:'1.3199',ask:'1.3201',mid:'1.32',timestamp:new Date().toISOString()}),candles:async(_symbol:string,tf:string)=>candle(tf==='M5'?26:21)}
  const advisor=new ShadowMemoryResearch(broker as any,{memory,logFile:join(dir,'advice.jsonl'),advisor:async()=>({decision:'SHORT',confidence:0.82,reason:'Example research'})})
  await advisor.process('GBP_USD');await advisor.process('GBP_USD')
  expect(advisor.snapshot().decisions).toBe(1)
  expect(advisor.snapshot().warnings).toBe(1)
  expect(readFileSync(file,'utf8')).toBe(rows)
  expect(readFileSync(join(dir,'advice.jsonl'),'utf8')).toContain('OBSERVATION_ONLY')
 })
})
