import {Decimal} from 'decimal.js'
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,appendFileSync,unlinkSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {env} from '../config.js'
import type {BrokerQuote,Direction} from '../types.js'
import type {Candle} from '../indicators.js'
import {featuresFromCandles,OandaOutcomeResearch} from './OandaOutcomeResearch.js'
import type {MarketFeatures} from './OandaOutcomeResearch.js'
import {scanOllamaSetups,questionableRsiReason} from './OllamaSignalReview.js'
import type {SetupReview} from './OllamaSignalReview.js'
import type {OandaReadOnly} from '../broker/OandaReadOnly.js'
import {isOandaForexSessionOpen} from '../broker/OandaMarketHours.js'

export const OLLAMA_LAB_VERSION='ollama-oanda-signal-v2'
const MAX_SPREAD_PCT=new Decimal('0.0015')
const MAX_SPREAD_PIPS=3 // Order signal guard; broker revalidates the price.
const MAX_STOP_PCT=new Decimal('0.008')
const MIN_CONFIDENCE=0.75
const PIP_USD_MAJORS='0.0001'
const PAIRS=['EUR_USD','GBP_USD']
type Action='LONG'|'SHORT'|'WAIT'|'CLOSE'
export type BrokerSignal={key:string;action:'OPEN';symbol:'EUR_USD'|'GBP_USD';direction:Direction;
 entry:string;stop:string;target:string;units:string;at:string;candleTime:string;confidence:number}
export type AiDecision={decision:Action;confidence:number;reason:string}
type Feed={at:string;event:string;symbol?:string;decision?:string;reason?:string;confidence?:number}
type LabState={
 version:string;startedAt:string;lastBrokerSignal:BrokerSignal|null;lastCandle:Record<string,string>;
 decisions:number;signals:number;errors:number;lastReviewedAt:string|null;
 lastDecision:(AiDecision&{symbol:string;at:string})|null;lastAction:Feed|null;events:Feed[];
 paused:boolean;status:'WAITING'|'SCANNING'|'READY'|'ERROR'|'PAUSED'|'MARKET_CLOSED';
 lastMarket?:(MarketFeatures&{symbol:string;at:string;spreadPips:number})|null;lastSetup?:SetupReview|null
}
type Market={symbol:string;quote:BrokerQuote;m5:Candle[];m10:Candle[];indicators:MarketFeatures;brokerLessons:ReturnType<OandaOutcomeResearch['lessonsFor']>;setup:SetupReview}
type ReadBroker=Pick<OandaReadOnly,'quote'|'candles'>
type Options={baseDir?:string;logDir?:string;decide?:(market:Market)=>Promise<AiDecision>;now?:()=>Date}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
const initial=(now:Date):LabState=>({version:OLLAMA_LAB_VERSION,startedAt:now.toISOString(),lastBrokerSignal:null,
 lastCandle:{},decisions:0,signals:0,errors:0,lastReviewedAt:null,lastDecision:null,lastAction:null,events:[],
 paused:false,status:'WAITING',lastSetup:null,lastMarket:null})
export function parseAiLabDecision(raw:unknown):AiDecision{
 if(!raw||typeof raw!=='object')throw new Error('AI returned no JSON object')
 const d=raw as Record<string,unknown>
 const action=String(d.decision||'').toUpperCase()
 const mapped=action==='BUY'?'LONG':action==='SELL'?'SHORT':action
 if(!['LONG','SHORT','WAIT','CLOSE'].includes(mapped))throw new Error('Invalid model decision')
 if(typeof d.confidence!=='number'||!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1)throw new Error('Invalid model confidence')
 if(typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>450)throw new Error('Invalid model reason')
 return{decision:mapped as Action,confidence:d.confidence,reason:d.reason.trim()}
}
export async function queryIndependentOllama(market:Market):Promise<AiDecision>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000)
 try{
  const system='You are an OANDA Practice broker-only trading signal agent. Do not simulate trades or profits. Every response must consider both BUY and SELL hypotheses (including a trend continuation while Bollinger is inside) and a WAIT option. Distinguish no fully confirmed setup from a possible directional hypothesis. Calculate from supplied completed candles and objective setup checks, not imagination. RSI below 30 = OVERSOLD, above 70 = OVERBOUGHT, 30 through 70 = NEUTRAL; RSI 35 is NOT oversold. Low tick volume alone or no confirmed Shadow trade sample does NOT automatically forbid a signal. A verified Shadow outcome sample below 20 trades is observational, never a predictive rule. Answer JSON ONLY {"decision":"BUY|SELL|WAIT|CLOSE","confidence":0.0,"reason":"specific price and indicator evidence plus uncertainty"}; confidence is your assessment, not calibrated win probability. Prefer WAIT if neither direction has convincing evidence. CLOSE is not supported; prefer WAIT. Broker orders, stops, and targets are managed separately on OANDA Practice. Never alter Shadow or risk rules.'
  const base={symbol:market.symbol,quote:market.quote,mode:'OANDA_PRACTICE_ONLY',
   m5:market.m5.slice(-25),m10:market.m10.slice(-20),indicators:market.indicators,
   objectiveSetup:market.setup,verifiedShadowBrokerExamples:market.brokerLessons,
   brokerHistoryNote:'Historical broker sample is optional context; do not default to WAIT just because confirmed broker outcomes are few.'}
  let failure='Model response invalid'
  for(let attempt=0;attempt<3;attempt++){
   try{
    const response=await fetch(env.OLLAMA_BASE_URL+'/api/chat',{
     method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
     body:JSON.stringify({
      model:env.OLLAMA_MODEL,stream:false,think:false,
      // Ollama's structured output constrains malformed or truncated JSON.
      format:{type:'object',properties:{
       decision:{type:'string',enum:['BUY','SELL','WAIT','CLOSE']},
       confidence:{type:'number',minimum:0,maximum:1},
       reason:{type:'string',minLength:1,maxLength:250}
      },required:['decision','confidence','reason'],additionalProperties:false},
      options:{temperature:0,num_predict:480},
      messages:[
       {role:'system',content:system+' Keep reason under 250 characters. Do not include markdown.'},
       {role:'user',content:JSON.stringify({...base,
        ...(attempt?{criticalCorrection:'Previous output was invalid ('+failure+'). Return complete short JSON matching the provided schema; use accurate RSI zone '+market.setup.rsiZone+'.'}:{})})}
      ]
     })
    })
    if(!response.ok)throw new Error('Ollama HTTP '+response.status)
    const body=await response.json() as {message?:{content?:string};done_reason?:string}
    if(!body.message?.content)throw new Error('Empty Ollama message')
    const decision=parseAiLabDecision(JSON.parse(body.message.content))
    if(questionableRsiReason(decision.reason,market.setup.rsiZone)){
     failure='RSI explanation inconsistent with computed RSI zone'
     continue
    }
    return decision
   }catch(error){
    failure=error instanceof Error?error.message:String(error)
    // Network failure or canceled request must not be disguised as a valid signal.
    if(controller.signal.aborted)break
   }
  }
  // Refuse broker signals on malformed AI output.
  // Caller records an explicit error so the UI reflects real reliability issues.
  throw new Error('Ollama decision rejected after retries: '+failure)

 }finally{clearTimeout(timer)}
}
export class OllamaSignalEngine{
 private state:LabState
 private readonly stateFile:string
 private readonly logDir:string
 private readonly decide:(market:Market)=>Promise<AiDecision>
 private readonly now:()=>Date
 private readonly research:OandaOutcomeResearch|null
 constructor(private broker:ReadBroker,opts:Options={}){
  this.now=opts.now||(()=>new Date())
  const dataDir=opts.baseDir||resolve(root,'data')
  this.stateFile=resolve(dataDir,'ollama-signal-state.json')
  this.logDir=opts.logDir||resolve(root,'logs/ollama-paper')
  this.decide=opts.decide||queryIndependentOllama
  this.research=typeof (broker as any).closedTrades==='function'&&typeof (broker as any).candlesBefore==='function'
   ?new OandaOutcomeResearch(broker as unknown as ConstructorParameters<typeof OandaOutcomeResearch>[0],{now:this.now}):null
  this.state=initial(this.now())
  const legacy=resolve(dataDir,'ollama-paper-state.json')
  const source=existsSync(this.stateFile)?this.stateFile:existsSync(legacy)?legacy:null
  if(source){
   try{
    const saved=JSON.parse(readFileSync(source,'utf8'))
    if(!saved||!Array.isArray(saved.events)||!saved.lastCandle)throw Error('Invalid state')
    const sig=saved.lastBrokerSignal
    this.state={...this.state,
     startedAt:String(saved.startedAt||this.state.startedAt),
     lastBrokerSignal:sig&&sig.action==='OPEN'&&typeof sig.key==='string'&&['EUR_USD','GBP_USD'].includes(sig.symbol)?sig:null,
     lastCandle:saved.lastCandle,decisions:Number(saved.decisions||0),signals:Number(saved.signals||0),
     errors:Number(saved.errors||0),lastReviewedAt:saved.lastReviewedAt??null,
     lastDecision:saved.lastDecision??null,lastAction:saved.lastAction??null,
     events:saved.events.filter((x:any)=>typeof x.event==='string'&&!/PAPER_OPEN|PAPER_CLOSE|BREAK_EVEN|WAIT_WATCH|WAIT_REVIEW/.test(x.event)).slice(0,16),
     lastSetup:saved.lastSetup??null,lastMarket:saved.lastMarket??null,
     paused:!!saved.paused,status:saved.paused?'PAUSED':'WAITING'}
    if(!this.state.paused){
     this.save()
     if(source===legacy)unlinkSync(legacy)
    }
   }catch(e){this.state.paused=true;this.state.status='PAUSED';
    this.log('OLLAMA_SIGNAL_STATE_ERROR',{reason:'Signal migration needs review; original untouched'})}
  }
 }
 snapshot(){return{...this.state,executionMode:'OANDA_PRACTICE_ONLY',
  brokerLearning:this.research?.snapshot()||null}}
 start(){this.record('OLLAMA_OANDA_SIGNAL_READY',{reason:'OANDA Practice only, no virtual fills'})}
 private log(event:string,fields:Record<string,unknown>={},trade=false){
  mkdirSync(this.logDir,{recursive:true})
  const at=this.now().toISOString(),path=resolve(this.logDir,trade?'signals.jsonl':at.slice(0,10)+'.jsonl')
  appendFileSync(path,JSON.stringify({at,event,version:OLLAMA_LAB_VERSION,mode:'OANDA_PRACTICE_SIGNAL',...fields})+'\n','utf8')
 }
 private save(){
  if(this.state.paused)return
  mkdirSync(dirname(this.stateFile),{recursive:true})
  const tmp=this.stateFile+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,this.stateFile)
 }
 private record(event:string,fields:Record<string,unknown>={},trade=false){
  const at=this.now().toISOString()
  const item:Feed={at,event,symbol:typeof fields.symbol==='string'?fields.symbol:undefined,decision:typeof fields.decision==='string'?fields.decision:undefined,reason:typeof fields.reason==='string'?fields.reason:undefined,confidence:typeof fields.confidence==='number'?fields.confidence:undefined}
  this.state.lastAction=item
  this.state.events=[item,...this.state.events].slice(0,16)
  this.log(event,fields,trade)
  this.save()
 }
 private validQuote(symbol:string,q:BrokerQuote){
  const bid=Number(q.bid),ask=Number(q.ask),qt=Date.parse(q.timestamp)
  return q.symbol===symbol&&Number.isFinite(qt)&&Math.abs(this.now().getTime()-qt)<=120000&&Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>bid&&(ask-bid)/bid<=MAX_SPREAD_PCT.toNumber()&&(ask-bid)/0.0001<=MAX_SPREAD_PIPS
 }
 private createBrokerSignal(symbol:string,direction:Direction,q:BrokerQuote,m5:Candle[],decision:AiDecision,candleTime:string):BrokerSignal{
  const entry=new Decimal(direction==='long'?q.ask:q.bid)
  const bars=m5.slice(-15)
  let atr=0
  for(let i=1;i<bars.length;i++){
   const c=bars[i],prev=bars[i-1]
   atr+=Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close))
  }
  atr/=Math.max(1,bars.length-1)
  const distance=Decimal.min(entry.mul(MAX_STOP_PCT),Decimal.max(entry.mul('0.0012'),new Decimal(atr).mul('1.5')))
  const units=Decimal.min(new Decimal('2.5').div(distance).floor(),new Decimal('10000').div(entry).floor())
  if(units.lt(1))throw Error('Ollama Practice isolated 1000 USD budget insufficient')
  const stop=direction==='long'?entry.minus(distance):entry.plus(distance)
  const target=direction==='long'?entry.plus(distance.mul(2)):entry.minus(distance.mul(2))
  const at=this.now().toISOString()
  return{key:symbol+':'+candleTime+':'+direction,action:'OPEN',symbol:symbol as BrokerSignal['symbol'],
   direction,entry:entry.toString(),stop:stop.toString(),target:target.toString(),units:units.toString(),
   at,candleTime,confidence:decision.confidence}
 }
 async process(symbol:string){
  if(this.state.paused||!PAIRS.includes(symbol))return
  try{
   if(!isOandaForexSessionOpen(this.now())){
    // A single informative event per market closure; no repeated bad-quote errors.
    if(this.state.status!=='MARKET_CLOSED'){
     this.state.status='MARKET_CLOSED'
     this.record('OLLAMA_LAB_MARKET_CLOSED',{symbol,reason:'OANDA FX weekly close or daily break in New York; no fresh broker signal is generated'})
    }
    return
   }
   const q=await this.broker.quote(symbol)
   if(!this.validQuote(symbol,q)){this.record('OLLAMA_LAB_SKIP',{symbol,reason:'Stale, malformed or wide-spread quote'});return}
   // Research is isolated and read-only: failures never become Shadow decisions.
   if(this.research)void this.research.refresh().catch(()=>{})
   const [m5,m10]=await Promise.all([this.broker.candles(symbol,'M5',40),this.broker.candles(symbol,'M10',25)])
   const last=m5.at(-1)
   if(!last||m5.length<25||m10.length<20){this.record('OLLAMA_LAB_SKIP',{symbol,reason:'Insufficient completed candles'});return}
   if(this.state.lastCandle[symbol]===last.time){this.save();return}
   this.state.lastCandle[symbol]=last.time
   const indicators=featuresFromCandles(m5,m10)
   const spreadPips=Number(new Decimal(q.ask).minus(q.bid).div(PIP_USD_MAJORS).toFixed(2))
   const setup=scanOllamaSetups(m5,m10,spreadPips)
   this.state.lastSetup=setup
   this.state.lastMarket={...indicators,symbol,at:last.time,spreadPips}
   this.state.status='SCANNING';this.save()
   const d=parseAiLabDecision(await this.decide({symbol,quote:q,m5,m10,indicators,brokerLessons:this.research?.lessonsFor(symbol)||[],setup}))
   this.state.decisions++;this.state.lastReviewedAt=this.now().toISOString()
   this.state.lastDecision={...d,symbol,at:this.state.lastReviewedAt}
   this.state.status='READY'
   this.record('OLLAMA_LAB_DECISION',{symbol,candleTime:last.time,decision:d.decision,confidence:d.confidence,
    reason:d.reason,setupDirection:setup.direction,setupScore:setup.score,rsiZone:setup.rsiZone})
   if(d.confidence<MIN_CONFIDENCE){if(d.decision!=='WAIT')this.record('OLLAMA_LAB_SIGNAL_SKIPPED',{symbol,reason:'Confidence below 0.75'});return}
   if(d.decision==='CLOSE'){
    this.record('OLLAMA_OANDA_CLOSE_NOT_SENT',{symbol,reason:'No broker-owned position supplied to the AI; OANDA attached stop and target govern exit'})
    return
   }
   if(d.decision==='LONG'||d.decision==='SHORT'){
    const signal=this.createBrokerSignal(symbol,d.decision==='LONG'?'long':'short',q,m5,d,last.time)
    this.state.lastBrokerSignal=signal
    this.state.signals++
    this.record('OLLAMA_OANDA_SIGNAL',{symbol,decision:d.decision,confidence:d.confidence,
     reason:'Practice order intent, awaiting broker validation.',signalKey:signal.key},true)
   }
  }catch(e){
   this.state.errors++;this.state.status='ERROR'
   this.record('OLLAMA_LAB_ERROR',{symbol,reason:e instanceof Error?e.message:String(e)})
  }
 }
}
