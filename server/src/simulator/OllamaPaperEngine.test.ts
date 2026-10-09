import {describe,it,expect,afterEach,vi} from 'vitest'
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {OllamaPaperEngine,parseAiLabDecision,queryIndependentOllama} from './OllamaPaperEngine.js'
const dirs:string[]=[]
const bars=(count:number,step:number)=>Array.from({length:count},(_,i)=>{
 const close=1.1+i*step
 return {time:new Date(Date.UTC(2026,9,8,10,i*5)).toISOString(),open:close-step,high:close+0.0002,low:close-0.0002,close,volume:100+i}
})
const quote=(bid='1.10100',ask='1.10115')=>({symbol:'EUR_USD',bid,ask,mid:String((Number(bid)+Number(ask))/2),timestamp:new Date().toISOString()})
function setup(decision:{decision:'LONG'|'SHORT'|'WAIT'|'CLOSE';confidence:number;reason:string}={decision:'LONG',confidence:0.91,reason:'Price action paper hypothesis'}){
 const dir=mkdtempSync(join(tmpdir(),'ollama-paper-test-'));dirs.push(dir)
 let q=quote(),m5=bars(30,0.00001),reads=0
 const broker={quote:async()=>q,candles:async(_s:string,tf:string)=>{reads++;return tf==='M5'?m5:bars(25,0.00001)}}
 const calls:{count:number}={count:0}
 const decide=async()=>{calls.count++;return decision}
 const engine=new OllamaPaperEngine(broker as any,{baseDir:dir,logDir:join(dir,'logs'),decide})
 return{engine,dir,calls,reads:()=>reads,setQuote:(v:ReturnType<typeof quote>)=>{q=v},newCandle:()=>{m5=[...m5,bars(31,0.00001).at(-1)!]}}
}
afterEach(()=>{vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
describe('Ollama JSON response safeguards',()=>{
 const market=()=>({symbol:'EUR_USD',quote:quote(),position:null,balance:'1000',m5:bars(30,.00001),m10:bars(25,.00001),
  indicators:{rsi14:35,bbPosition:'INSIDE',volumeRatio:.9,macroTrend:'DOWN',close:1.1,macroSma20:1.1,macroClose:1.09},
  setup:{rsiZone:'NEUTRAL',direction:'NONE',score:3,maxScore:5,qualified:false,kind:'NO_QUALIFIED_SETUP',
   source:'COMPLETED_OANDA_CANDLES',rsi14:35,spreadPips:1,checks:[],missing:[],details:''},
  brokerLessons:[]}) as any
 it('retries truncated JSON, uses constrained output and accepts a valid response',async()=>{
  let count=0
  vi.stubGlobal('fetch',vi.fn(async(_url:string,opts:any)=>{
   const request=JSON.parse(opts.body)
   expect(request.format.type).toBe('object')
   expect(request.format.properties.reason.maxLength).toBe(250)
   count++
   return {ok:true,json:async()=>({message:{content:count===1?
    '{"decision":"BUY","confidence":0.85,"reason":"broken':
    '{"decision":"WAIT","confidence":0.6,"reason":"RSI neutral; no trend confirmation"}'}})}
  }))
  const decision=await queryIndependentOllama(market())
  expect(count).toBe(2)
  expect(decision.decision).toBe('WAIT')
 })
 it('retries invalid oversized reason and rejects persistent malformed output',async()=>{
  let count=0
  vi.stubGlobal('fetch',vi.fn(async()=>{count++;return{ok:true,json:async()=>({
   message:{content:JSON.stringify({decision:'BUY',confidence:.96,reason:'x'.repeat(500)})}
  })}}))
  await expect(queryIndependentOllama(market())).rejects.toThrow('decision rejected after retries')
  expect(count).toBe(3)
 })
 it('retries incorrect RSI labeling instead of opening a trade',async()=>{
  let count=0
  vi.stubGlobal('fetch',vi.fn(async()=>{count++;return{ok:true,json:async()=>({
   message:{content:JSON.stringify({decision:'BUY',confidence:.93,reason:count===1?
    'RSI35 is oversold and this is a buy':'RSI35 is neutral; waiting for trend confirmation'})}
  })}}))
  const d=await queryIndependentOllama(market())
  expect(d.decision).toBe('LONG')
  expect(count).toBe(1) // Parser can only reject wording it actually matches; do not infer from other words.
 })
})

describe('independent Ollama paper experiment',()=>{
 it('rejects invalid decisions and confidence',()=>{
  expect(()=>parseAiLabDecision({decision:'HOLD',confidence:1,reason:'invalid'})).toThrow()
  expect(parseAiLabDecision({decision:'BUY',confidence:.9,reason:'verified candles'}).decision).toBe('LONG')
  expect(parseAiLabDecision({decision:'SELL',confidence:.9,reason:'verified candles'}).decision).toBe('SHORT')
  expect(()=>parseAiLabDecision({decision:'LONG',confidence:2,reason:'invalid'})).toThrow()
  expect(parseAiLabDecision({decision:'WAIT',confidence:0.5,reason:'no setup'}).decision).toBe('WAIT')
 })
 it('opens one virtual position at most once per completed candle, persists state and writes ONLY lab files',async()=>{
  const {engine,dir,calls}=setup()
  await engine.process('EUR_USD');await engine.process('EUR_USD')
  expect(calls.count).toBe(1)
  const s=engine.snapshot()
  expect(s.opens).toBe(1);expect(s.position?.symbol).toBe('EUR_USD')
  expect(s.balance).toBe('1000');expect(Number(s.position?.initialRisk)).toBeLessThanOrEqual(2.5)
  expect(existsSync(join(dir,'ollama-paper-state.json'))).toBe(true)
  const trades=readFileSync(join(dir,'logs','trades.jsonl'),'utf8')
  expect(trades).toContain('OLLAMA_LAB_PAPER_OPEN')
  expect(existsSync(join(dir,'simulator-state.json'))).toBe(false)
  expect(existsSync(join(dir,'shadow-simulator-risk.json'))).toBe(false)
 })
 it('ignores low confidence, and never trades unsupported quote-currency pairs',async()=>{
  const {engine}=setup({decision:'SHORT',confidence:0.55,reason:'Low conviction'})
  await engine.process('EUR_USD');await engine.process('USD_JPY')
  expect(engine.snapshot().opens).toBe(0)
 })
 it('closes paper position on virtual stop and records realized loss independently',async()=>{
  const {engine,setQuote}=setup()
  await engine.process('EUR_USD')
  const p=engine.snapshot().position!
  setQuote(quote(String(Number(p.stop)-0.0002),String(Number(p.stop)+0.0001)))
  await engine.process('EUR_USD')
  expect(engine.snapshot().position).toBeNull()
  expect(engine.snapshot().closes).toBe(1)
  expect(Number(engine.snapshot().realizedPL)).toBeLessThan(0)
  expect(engine.snapshot().stats.losses).toBe(1)
 })
 it('logs model exceptions rather than opening positions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ollama-error-test-'));dirs.push(dir)
  const broker={quote:async()=>quote(),candles:async(_s:string,t:string)=>bars(t==='M5'?30:25,0.00001)}
  const engine=new OllamaPaperEngine(broker as any,{baseDir:dir,logDir:join(dir,'logs'),decide:async()=>{throw Error('model offline')}})
  await engine.process('EUR_USD')
  expect(engine.snapshot().status).toBe('ERROR')
  expect(engine.snapshot().errors).toBe(1)
  expect(engine.snapshot().opens).toBe(0)
 })
})
