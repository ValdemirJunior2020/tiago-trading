import {Decimal} from 'decimal.js'
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,appendFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {env} from '../config.js'
import type {BrokerQuote,Direction} from '../types.js'
import type {Candle} from '../indicators.js'
import {featuresFromCandles,OandaOutcomeResearch} from './OandaOutcomeResearch.js'
import type {MarketFeatures} from './OandaOutcomeResearch.js'
import {scanOllamaSetups,resolveWaitObservation,questionableRsiReason} from './OllamaSignalReview.js'
import type {SetupReview,WaitObservation,WaitOutcome} from './OllamaSignalReview.js'
import type {OandaReadOnly} from '../broker/OandaReadOnly.js'

export const OLLAMA_LAB_VERSION='ollama-independent-paper-v1'
const INITIAL_BALANCE='1000'
const RISK_PCT=new Decimal('0.0025')
const MAX_DAILY_LOSS=new Decimal('0.03')
const MAX_SPREAD_PCT=new Decimal('0.0015')
const MAX_SPREAD_PIPS=3 // Independent paper only; no change to Shadow or broker orders.
const MAX_STOP_PCT=new Decimal('0.008')
const MIN_CONFIDENCE=0.75
// Conservative execution assumption on top of actual OANDA bid/ask spreads.
const PAPER_SLIPPAGE_PIPS_PER_SIDE=0.2
const PIP_USD_MAJORS='0.0001'
const PAIRS=['EUR_USD','GBP_USD']
type Action='LONG'|'SHORT'|'WAIT'|'CLOSE'
export type AiDecision={decision:Action;confidence:number;reason:string}
type Position={symbol:string;direction:Direction;entry:string;units:string;stop:string;target:string;initialRisk:string;openedAt:string;breakEven:boolean;slippagePipsPerSide?:number}
type Stats={trades:number;wins:number;losses:number;grossProfit:string;grossLoss:string;netProfit:string;peakNetProfit:string;maxDrawdown:string;lastPnl:string;lastClosedAt:string|null}
type Feed={at:string;event:string;symbol?:string;decision?:string;reason?:string;pnl?:string;confidence?:number}
type LabState={version:string;startedAt:string;startingBalance:string;balance:string;realizedPL:string;openPnl:string;equity:string;position:Position|null;lastCandle:Record<string,string>;decisions:number;signals:number;opens:number;closes:number;vetoed:number;errors:number;lastReviewedAt:string|null;lastDecision:(AiDecision&{symbol:string;at:string})|null;lastAction:Feed|null;events:Feed[];stats:Stats;day:string;dayStartingEquity:string;paused:boolean;status:'WAITING'|'SCANNING'|'READY'|'ERROR'|'PAUSED';lastMarket?:(MarketFeatures&{symbol:string;at:string;spreadPips:number})|null;lastSetup?:SetupReview|null;pendingWaitObservations?:WaitObservation[];waitOutcomes?:WaitOutcome[];waitObserved?:number;waitReviewed?:number;waitFavorable?:number}
type Market={symbol:string;quote:BrokerQuote;m5:Candle[];m10:Candle[];position:Position|null;balance:string;indicators:MarketFeatures;brokerLessons:ReturnType<OandaOutcomeResearch['lessonsFor']>;setup:SetupReview}
type ReadBroker=Pick<OandaReadOnly,'quote'|'candles'>
type Options={baseDir?:string;logDir?:string;decide?:(market:Market)=>Promise<AiDecision>;now?:()=>Date}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
const emptyStats=():Stats=>({trades:0,wins:0,losses:0,grossProfit:'0',grossLoss:'0',netProfit:'0',peakNetProfit:'0',maxDrawdown:'0',lastPnl:'0',lastClosedAt:null})
function initial(now:Date):LabState{return{version:OLLAMA_LAB_VERSION,startedAt:now.toISOString(),startingBalance:INITIAL_BALANCE,balance:INITIAL_BALANCE,realizedPL:'0',openPnl:'0',equity:INITIAL_BALANCE,position:null,lastCandle:{},decisions:0,signals:0,opens:0,closes:0,vetoed:0,errors:0,lastReviewedAt:null,lastDecision:null,lastAction:null,events:[],stats:emptyStats(),day:now.toISOString().slice(0,10),dayStartingEquity:INITIAL_BALANCE,paused:false,status:'WAITING',lastSetup:null,pendingWaitObservations:[],waitOutcomes:[],waitObserved:0,waitReviewed:0,waitFavorable:0}}
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
  const system='You are an independent OANDA FOREX PAPER research agent. Every response must consider both BUY and SELL hypotheses (including a trend continuation while Bollinger is inside) and a WAIT option. Distinguish no fully confirmed setup from a possible directional hypothesis. Calculate from supplied completed candles and objective setup checks, not imagination. RSI below 30 = OVERSOLD, above 70 = OVERBOUGHT, 30 through 70 = NEUTRAL; RSI 35 is NOT oversold. Low tick volume alone or no confirmed Shadow trade sample does NOT automatically forbid a signal. A verified Shadow outcome sample below 20 trades is observational, never a predictive rule. Answer JSON ONLY {"decision":"BUY|SELL|WAIT|CLOSE","confidence":0.0,"reason":"specific price and indicator evidence plus uncertainty"}; confidence is your assessment, not calibrated win probability. Prefer WAIT if neither direction has convincing evidence. CLOSE only if own paper position exists. No live orders, no OANDA writes, no Shadow modifications or risk rule changes.'
  const base={symbol:market.symbol,quote:market.quote,position:market.position,balance:market.balance,
   m5:market.m5.slice(-25),m10:market.m10.slice(-20),indicators:market.indicators,
   objectivePaperSetup:market.setup,verifiedShadowBrokerExamples:market.brokerLessons,
   brokerHistoryNote:'Historical broker sample is optional context; do not default to WAIT just because confirmed broker outcomes are few.'}
  for(let attempt=0;attempt<2;attempt++){
   const response=await fetch(env.OLLAMA_BASE_URL+'/api/chat',{
    method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     model:env.OLLAMA_MODEL,stream:false,think:false,format:'json',
     options:{temperature:0,num_predict:240},
     messages:[
      {role:'system',content:system},
      {role:'user',content:JSON.stringify({...base,
       ...(attempt?{criticalCorrection:'Your last explanation mislabeled RSI. Use the exact supplied rsiZone and decide again.'}:{})})}
     ]
    })
   })
   if(!response.ok)throw new Error('Ollama HTTP '+response.status)
   const body=await response.json() as {message?:{content?:string}}
   const decision=parseAiLabDecision(JSON.parse(body.message?.content||'{}'))
   if(!questionableRsiReason(decision.reason,market.setup.rsiZone))return decision
  }
  return{decision:'WAIT',confidence:0,reason:'RSI classification remained inconsistent after recheck; independent paper entry withheld.'}
 }finally{clearTimeout(timer)}
}
export class OllamaPaperEngine{
 private state:LabState
 private readonly stateFile:string
 private readonly logDir:string
 private readonly decide:(market:Market)=>Promise<AiDecision>
 private readonly now:()=>Date
 private readonly research:OandaOutcomeResearch|null
 constructor(private broker:ReadBroker,opts:Options={}){
  this.now=opts.now||(()=>new Date())
  this.stateFile=resolve(opts.baseDir||resolve(root,'data'),'ollama-paper-state.json')
  this.logDir=resolve(opts.logDir||resolve(root,'logs','ollama-paper'))
  this.decide=opts.decide||queryIndependentOllama
  this.research=typeof (broker as any).closedTrades==='function'&&typeof (broker as any).candlesBefore==='function'
    ?new OandaOutcomeResearch(broker as unknown as ConstructorParameters<typeof OandaOutcomeResearch>[0],{now:this.now}):null
  this.state=initial(this.now())
  if(existsSync(this.stateFile)){
   try{
    const saved=JSON.parse(readFileSync(this.stateFile,'utf8')) as LabState
    if(saved.version!==OLLAMA_LAB_VERSION||!saved.stats||!saved.lastCandle||!saved.balance||!Array.isArray(saved.events))throw new Error('Incompatible AI lab state')
    this.state={...this.state,...saved,status:'WAITING',lastSetup:saved.lastSetup??null,
     pendingWaitObservations:Array.isArray(saved.pendingWaitObservations)?saved.pendingWaitObservations:[],
     waitOutcomes:Array.isArray(saved.waitOutcomes)?saved.waitOutcomes:[],
     waitObserved:saved.waitObserved??0,waitReviewed:saved.waitReviewed??0,waitFavorable:saved.waitFavorable??0}
   }catch(e){
    this.state.paused=true;this.state.status='PAUSED'
    this.log('OLLAMA_LAB_STATE_ERROR',{reason:String(e),note:'Existing data preserved, lab paused'})
   }
  }
 }
 snapshot(){
  const verified=this.research?.completedSince(this.state.startedAt)||[]
  const brokerNet=verified.reduce((sum,t)=>sum+t.realizedPL,0)
  return{...this.state,brokerLearning:this.research?.snapshot()||null,
   waitResearch:{source:'COMPLETED_OANDA_M5_CANDLES',mode:'HYPOTHETICAL_PRICE_MOVEMENT_ONLY',
    observed:this.state.waitObserved??0,reviewed:this.state.waitReviewed??0,favorable:this.state.waitFavorable??0,
    pending:this.state.pendingWaitObservations?.length??0,recent:(this.state.waitOutcomes??[]).slice(0,6),
    assumptions:'3 completed M5 candles, midpoint close-to-close; spread and 0.2 pip/side simulated slippage deducted. Not executed trades, forecast or profit.'},
   executionCosts:{spread:'OANDA_BID_ASK',assumedSlippagePipsPerSide:PAPER_SLIPPAGE_PIPS_PER_SIDE,
    financing:'NOT_MODELED',commission:'NOT_MODELED',basis:'Forward paper fills only; old positions retain their original model'},
   comparison:{periodStart:this.state.startedAt,periodEnd:this.now().toISOString(),
    note:'Same calendar window, but paper and OANDA use different capital and trade sizes. Not a like-for-like return comparison.',
    brokerShadow:{source:'OANDA_CONFIRMED_SHADOW_MIRROR',trades:verified.length,wins:verified.filter(t=>t.realizedPL>0).length,losses:verified.filter(t=>t.realizedPL<0).length,netPL:Number(brokerNet.toFixed(2))},
    ollamaPaper:{source:'PAPER_ONLY',trades:this.state.stats.trades,wins:this.state.stats.wins,losses:this.state.stats.losses,netPL:Number(this.state.stats.netProfit)}
   }}
 }
 start(){this.record('OLLAMA_LAB_READY',{reason:'Independent paper experiment; broker read only'})}
 private log(event:string,fields:Record<string,unknown>={},trade=false){
  mkdirSync(this.logDir,{recursive:true})
  const at=this.now().toISOString(),path=resolve(this.logDir,trade?'trades.jsonl':at.slice(0,10)+'.jsonl')
  appendFileSync(path,JSON.stringify({at,event,version:OLLAMA_LAB_VERSION,mode:'PAPER_ONLY',...fields})+'\n','utf8')
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
  const item:Feed={at,event,symbol:typeof fields.symbol==='string'?fields.symbol:undefined,decision:typeof fields.decision==='string'?fields.decision:undefined,reason:typeof fields.reason==='string'?fields.reason:undefined,pnl:typeof fields.pnl==='string'?fields.pnl:undefined,confidence:typeof fields.confidence==='number'?fields.confidence:undefined}
  this.state.lastAction=item
  this.state.events=[item,...this.state.events].slice(0,16)
  this.log(event,fields,trade)
  this.save()
 }
 private assumedSlip(p:Position|undefined){
  return new Decimal(PIP_USD_MAJORS).mul(p?.slippagePipsPerSide??0)
 }
 private paperExit(p:Position,q:BrokerQuote){
  const mid=p.direction==='long'?new Decimal(q.bid):new Decimal(q.ask)
  return(p.direction==='long'?mid.minus(this.assumedSlip(p)):mid.plus(this.assumedSlip(p))).toString()
 }
 private pnl(p:Position,exit:string){const delta=p.direction==='long'?new Decimal(exit).minus(p.entry):new Decimal(p.entry).minus(exit);return delta.mul(p.units)}
 private close(exit:string,reason:string){
  const p=this.state.position
  if(!p)return
  const pnl=this.pnl(p,exit),s=this.state.stats
  this.state.balance=new Decimal(this.state.balance).plus(pnl).toString()
  this.state.realizedPL=new Decimal(this.state.realizedPL).plus(pnl).toString()
  this.state.position=null;this.state.closes++;this.state.openPnl='0';this.state.equity=this.state.balance
  s.trades++;s.lastPnl=pnl.toString();s.lastClosedAt=this.now().toISOString()
  if(pnl.gt(0)){s.wins++;s.grossProfit=new Decimal(s.grossProfit).plus(pnl).toString()}
  else if(pnl.lt(0)){s.losses++;s.grossLoss=new Decimal(s.grossLoss).plus(pnl.abs()).toString()}
  s.netProfit=this.state.realizedPL
  s.peakNetProfit=Decimal.max(s.peakNetProfit,s.netProfit).toString()
  s.maxDrawdown=Decimal.max(s.maxDrawdown,new Decimal(s.peakNetProfit).minus(s.netProfit)).toString()
  this.record('OLLAMA_LAB_PAPER_CLOSE',{symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),reason,balance:this.state.balance,openedAt:p.openedAt},true)
 }
 private manage(symbol:string,q:BrokerQuote){
  const p=this.state.position
  if(!p||p.symbol!==symbol)return
  const exit=this.paperExit(p,q)
  const unrealized=this.pnl(p,exit)
  this.state.openPnl=unrealized.toString()
  this.state.equity=new Decimal(this.state.balance).plus(unrealized).toString()
  if(!p.breakEven&&unrealized.gte(p.initialRisk)){
   p.stop=p.entry;p.breakEven=true
   this.record('OLLAMA_LAB_BREAK_EVEN',{symbol,reason:'Virtual stop moved to entry after +1R'})
  }
  const stopped=p.direction==='long'?new Decimal(exit).lte(p.stop):new Decimal(exit).gte(p.stop)
  const target=p.direction==='long'?new Decimal(exit).gte(p.target):new Decimal(exit).lte(p.target)
  if(stopped||target)this.close(exit,stopped?'VIRTUAL_STOP_OR_BREAK_EVEN':'VIRTUAL_TARGET_2R')
 }
 private reviewWaits(symbol:string,m5:Candle[]){
  const pending=this.state.pendingWaitObservations??[],remaining:WaitObservation[]=[]
  for(const watch of pending){
   if(watch.symbol!==symbol){remaining.push(watch);continue}
   const result=resolveWaitObservation(watch,m5,PAPER_SLIPPAGE_PIPS_PER_SIDE)
   if(result){
    this.state.waitReviewed=(this.state.waitReviewed??0)+1
    if(result.favorable)this.state.waitFavorable=(this.state.waitFavorable??0)+1
    this.state.waitOutcomes=[result,...(this.state.waitOutcomes??[])].slice(0,20)
    this.record('OLLAMA_LAB_WAIT_REVIEW',{symbol,decision:watch.direction,
     reason:'After three completed M5 candles, hypothetical net movement '+result.netMovementPips+' pips (NOT an executed trade)'})
   }else if(m5.some(c=>c.time===watch.candleTime))remaining.push(watch)
   // Expired observations cannot be evaluated without full future data; never invent a return.
  }
  this.state.pendingWaitObservations=remaining
 }
 private validQuote(symbol:string,q:BrokerQuote){
  const bid=Number(q.bid),ask=Number(q.ask),qt=Date.parse(q.timestamp)
  return q.symbol===symbol&&Number.isFinite(qt)&&Math.abs(this.now().getTime()-qt)<=120000&&Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>bid&&(ask-bid)/bid<=MAX_SPREAD_PCT.toNumber()&&(ask-bid)/0.0001<=MAX_SPREAD_PIPS
 }
 private newDay(){
  const today=this.now().toISOString().slice(0,10)
  if(today!==this.state.day){this.state.day=today;this.state.dayStartingEquity=this.state.equity}
 }
 private dailyRiskLocked(){
  const baseline=new Decimal(this.state.dayStartingEquity)
  return baseline.gt(0)&&new Decimal(this.state.equity).lte(baseline.mul(new Decimal(1).minus(MAX_DAILY_LOSS)))
 }
 private open(symbol:string,direction:Direction,q:BrokerQuote,m5:Candle[],decision:AiDecision){
  if(this.state.position||this.dailyRiskLocked()){this.record('OLLAMA_LAB_SIGNAL_SKIPPED',{symbol,reason:'Position already open or daily drawdown limit'});return}
  const base=new Decimal(direction==='long'?q.ask:q.bid)
  const slip=new Decimal(PIP_USD_MAJORS).mul(PAPER_SLIPPAGE_PIPS_PER_SIDE)
  const entry=direction==='long'?base.plus(slip):base.minus(slip)
  const bars=m5.slice(-15)
  let atr=0
  for(let i=1;i<bars.length;i++){
   const c=bars[i],prev=bars[i-1]
   atr+=Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close))
  }
  atr/=Math.max(1,bars.length-1)
  const distance=Decimal.min(entry.mul(MAX_STOP_PCT),Decimal.max(entry.mul('0.0012'),new Decimal(atr).mul('1.5')))
  const riskCash=new Decimal(this.state.equity).mul(RISK_PCT)
  const byRisk=riskCash.div(distance).floor(),byNotional=new Decimal(this.state.equity).mul(10).div(entry).floor()
  const units=Decimal.min(byRisk,byNotional)
  if(units.lt(1)){this.record('OLLAMA_LAB_SIGNAL_SKIPPED',{symbol,reason:'Insufficient virtual capital for minimum unit'});return}
  const stop=direction==='long'?entry.minus(distance):entry.plus(distance)
  const target=direction==='long'?entry.plus(distance.mul(2)):entry.minus(distance.mul(2))
  const at=this.now().toISOString()
  this.state.position={symbol,direction,entry:entry.toString(),units:units.toString(),stop:stop.toString(),target:target.toString(),initialRisk:units.mul(distance).toString(),openedAt:at,breakEven:false,slippagePipsPerSide:PAPER_SLIPPAGE_PIPS_PER_SIDE}
  this.state.opens++
  this.record('OLLAMA_LAB_PAPER_OPEN',{symbol,direction,decision:decision.decision,confidence:decision.confidence,reason:decision.reason,entry:entry.toString(),stop:stop.toString(),target:target.toString(),units:units.toString(),riskCash:units.mul(distance).toString(),spreadPips:Number(new Decimal(q.ask).minus(q.bid).div(PIP_USD_MAJORS)),assumedSlippagePipsPerSide:PAPER_SLIPPAGE_PIPS_PER_SIDE},true)
 }
 async process(symbol:string){
  if(this.state.paused||!PAIRS.includes(symbol))return
  try{
   const q=await this.broker.quote(symbol)
   if(!this.validQuote(symbol,q)){this.record('OLLAMA_LAB_SKIP',{symbol,reason:'Stale, malformed or wide-spread quote'});return}
   this.newDay()
   this.manage(symbol,q)
   // Research is isolated and read-only: failures never become Shadow decisions.
   if(this.research)void this.research.refresh().catch(()=>{})
   const [m5,m10]=await Promise.all([this.broker.candles(symbol,'M5',40),this.broker.candles(symbol,'M10',25)])
   const last=m5.at(-1)
   if(!last||m5.length<25||m10.length<20){this.record('OLLAMA_LAB_SKIP',{symbol,reason:'Insufficient completed candles'});return}
   if(this.state.lastCandle[symbol]===last.time){this.save();return}
   this.state.lastCandle[symbol]=last.time
   this.reviewWaits(symbol,m5)
   const indicators=featuresFromCandles(m5,m10)
   const spreadPips=Number(new Decimal(q.ask).minus(q.bid).div(PIP_USD_MAJORS).toFixed(2))
   const setup=scanOllamaSetups(m5,m10,spreadPips)
   this.state.lastSetup=setup
   this.state.lastMarket={...indicators,symbol,at:last.time,spreadPips}
   this.state.status='SCANNING';this.save()
   const d=parseAiLabDecision(await this.decide({symbol,quote:q,m5,m10,position:this.state.position?.symbol===symbol?this.state.position:null,balance:this.state.balance,indicators,brokerLessons:this.research?.lessonsFor(symbol)||[],setup}))
   this.state.decisions++;this.state.lastReviewedAt=this.now().toISOString()
   this.state.lastDecision={...d,symbol,at:this.state.lastReviewedAt}
   this.state.status='READY'
   this.record('OLLAMA_LAB_DECISION',{symbol,candleTime:last.time,decision:d.decision,confidence:d.confidence,
    reason:d.reason,setupDirection:setup.direction,setupScore:setup.score,rsiZone:setup.rsiZone})
   if(d.decision==='WAIT'&&setup.qualified&&!this.state.position){
    const watch:WaitObservation={symbol,direction:setup.direction as 'BUY'|'SELL',candleTime:last.time,
     entryMid:last.close,spreadPips,horizonCandles:3}
    this.state.pendingWaitObservations=[...(this.state.pendingWaitObservations??[]),watch].slice(-24)
    this.state.waitObserved=(this.state.waitObserved??0)+1
    this.record('OLLAMA_LAB_WAIT_WATCH',{symbol,decision:watch.direction,
     reason:'Objective 5/5 setup went to WAIT; evaluating next three closed M5 candles without trading'})
   }
   if(d.confidence<MIN_CONFIDENCE){if(d.decision!=='WAIT')this.record('OLLAMA_LAB_SIGNAL_SKIPPED',{symbol,reason:'Confidence below 0.75'});return}
   if(d.decision==='CLOSE'){
    const p=this.state.position
    if(p?.symbol===symbol)this.close(this.paperExit(p,q),'OLLAMA_INDEPENDENT_CLOSE')
    return
   }
   if(d.decision==='LONG'||d.decision==='SHORT'){
    this.state.signals++
    this.open(symbol,d.decision==='LONG'?'long':'short',q,m5,d)
   }
  }catch(e){
   this.state.errors++;this.state.status='ERROR'
   this.record('OLLAMA_LAB_ERROR',{symbol,reason:e instanceof Error?e.message:String(e)})
  }
 }
}
