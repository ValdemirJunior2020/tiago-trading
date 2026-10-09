import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Decimal} from 'decimal.js'
import {env} from '../config.js'
import {OllamaPracticeBroker,ollamaClientId,isTagged,OLLAMA_TRADE_TAG} from '../broker/OllamaPracticeBroker.js'
import type{OpenSpec}from '../broker/OllamaPracticeBroker.js'
import type{BrokerSignal}from './OllamaPaperEngine.js'
import{oandaForexSession,isOandaForexSessionOpen}from '../broker/OandaMarketHours.js'

export type PaperView={lastBrokerSignal?:BrokerSignal|null}
type ShadowView={position?:{symbol:string}|null;pendingMirrorCloseTradeId?:string|null}
type Intent={paperKey:string;clientId:string;symbol:'EUR_USD'|'GBP_USD';direction:'long'|'short';units:string;stop:string;
 status:'OPENING'|'ACTIVE'|'CLOSE_PENDING'|'REVIEW_REQUIRED';tradeId:string|null;fillPrice:string|null;startedAt:string}
type Closed={tradeId:string;symbol:string;direction:'long'|'short';realizedPL:string;closedAt:string;source:'OANDA_API';clientId:string}
type State={version:1;initialized:boolean;startedAt:string;lastSeenPaperKey:string|null;signalModeInitialized?:boolean;lastSeenSignalKey?:string|null;brokerOpenPL?:string|null;brokerOpenPLAt?:string|null;active:Intent|null;
 closed:Closed[];status:string;lastError:string|null;lastUpdate:string|null;events:Array<{at:string;event:string;detail:string}>}
type Broker=Pick<OllamaPracticeBroker,'validateOpen'|'open'|'trade'|'findTagged'|'syncStop'|'close'|'openTrades'>
type Opts={baseDir?:string;logDir?:string;broker?:Broker;now?:()=>Date}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
const fresh=():State=>({version:1,initialized:false,startedAt:new Date().toISOString(),lastSeenPaperKey:null,
 active:null,closed:[],status:'INITIALIZING',lastError:null,lastUpdate:null,events:[]})
export function isIndependentPracticeEnabled(){
 return env.OLLAMA_OANDA_PRACTICE_MIRROR_ENABLED.toLowerCase()==='true'&&
  env.OANDA_REST_BASE_URL.replace(/\/$/,'')==='https://api-fxpractice.oanda.com'
}
export class OllamaPracticeMirror{
 private state:State
 private readonly file:string
 private readonly logDir:string
 private readonly broker:Broker
 private readonly now:()=>Date
 private timer:ReturnType<typeof setInterval>|null=null
 private busy=false
 constructor(private readonly getPaper:()=>PaperView,private readonly getShadow:()=>ShadowView,opts:Opts={}){
  this.now=opts.now||(()=>new Date())
  this.broker=opts.broker||new OllamaPracticeBroker()
  this.file=resolve(opts.baseDir||resolve(root,'data'),'ollama-oanda-mirror-state.json')
  this.logDir=resolve(opts.logDir||resolve(root,'logs/ollama-paper'))
  this.state=fresh()
  if(existsSync(this.file)){
   try{
    const loaded=JSON.parse(readFileSync(this.file,'utf8')) as State
    if(loaded.version!==1||!Array.isArray(loaded.closed)||!Array.isArray(loaded.events)||typeof loaded.initialized!=='boolean')
     throw Error('Incompatible existing Ollama mirror state')
    this.state={...loaded,status:loaded.active
     ?(loaded.active.status==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':'RECONCILING')
     :'WAITING_NEW_OLLAMA_SIGNAL'}
   }catch(e){this.state.status='REVIEW_REQUIRED';this.state.lastError='Mirror state unreadable; original preserved: '+String(e)}
  }
 }
 snapshot(){
  const totals=this.state.closed.reduce((sum,t)=>sum.plus(t.realizedPL),new Decimal(0))
  const active=this.state.active
  const session=oandaForexSession(this.now())
  const status=!active&&session!=='OPEN'&&this.state.status!=='REVIEW_REQUIRED'&&this.state.status!=='DISABLED_OR_NOT_PRACTICE'?'MARKET_CLOSED':this.state.status
  return{
   source:'OANDA_API',mode:'PRACTICE_ONLY',execution:'BROKER_ONLY',tag:OLLAMA_TRADE_TAG,enabled:isIndependentPracticeEnabled(),
   status,marketSession:session,latestError:this.state.lastError,updatedAt:this.state.lastUpdate,
   tradeId:active?.tradeId??null,activeSymbol:active?.symbol??null,activeDirection:active?.direction??null,
   activeStatus:active?.status??null,brokerFillPrice:active?.fillPrice??null,
   mirroredStop:active?.stop??null,closedTrades:this.state.closed.length,
   brokerOpenPL:active?.tradeId?this.state.brokerOpenPL??null:null,
   brokerOpenPLAt:active?.tradeId?this.state.brokerOpenPLAt??null:null,
   realizedPL:totals.toFixed(2),history:this.state.closed.slice(-8).reverse(),
   events:this.state.events.slice(0,8),isolatedBudgetUsd:1000,
   warning:'OANDA Practice only. Shared account equity/margin. Confirmed Ollama trades only; historical paper positions are NOT submitted.'
  }
 }
 private save(){
  mkdirSync(dirname(this.file),{recursive:true})
  const tmp=this.file+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,this.file)
 }
 private note(event:string,detail:string){
  const at=this.now().toISOString()
  this.state.lastUpdate=at
  this.state.events=[{at,event,detail},...this.state.events].slice(0,16)
  mkdirSync(this.logDir,{recursive:true})
  appendFileSync(resolve(this.logDir,'oanda-mirror.jsonl'),JSON.stringify({at,event,detail,source:'OANDA_API',strategy:'OLLAMA',mode:'PRACTICE_ONLY',
   clientId:this.state.active?.clientId||null,tradeId:this.state.active?.tradeId||null})+'\n')
  this.save()
 }
 private blocked(reason:string,status='BLOCKED'){
  this.state.status=status;this.state.lastError=reason
  this.note('OLLAMA_OANDA_BLOCKED',reason)
 }
 private async confirmedClosed(intent:Intent,realizedPL:string){
  if(!this.state.closed.some(x=>x.tradeId===intent.tradeId)){
   if(!intent.tradeId||!Number.isFinite(Number(realizedPL)))throw Error('No valid broker-confirmed P/L for Ollama closure')
   this.state.closed.push({tradeId:intent.tradeId,clientId:intent.clientId,symbol:intent.symbol,direction:intent.direction,
    realizedPL:String(realizedPL),closedAt:this.now().toISOString(),source:'OANDA_API'})
  }
  this.state.active=null
  this.state.brokerOpenPL=null;this.state.brokerOpenPLAt=null
  this.state.status='WAITING_NEW_OLLAMA_SIGNAL';this.state.lastError=null
  this.note('OLLAMA_OANDA_TRADE_CLOSED','Broker confirmed closure, official realized P/L '+realizedPL)
 }
 private async reconcileIntent(){
  const a=this.state.active
  if(!a)return
  if(!a.tradeId){
   const matches=await this.broker.findTagged(a.clientId)
   if(matches.length!==1){this.blocked('Ambiguous opening request: '+matches.length+' matching broker trades. Manual review required','REVIEW_REQUIRED');return}
   a.tradeId=String(matches[0].id)
   a.fillPrice=String(matches[0].price||'')
   this.save()
  }
  const t=await this.broker.trade(a.tradeId)
  if(!t||!isTagged(t,a.clientId)||t.instrument!==a.symbol){
   this.blocked('Trade ID does not match Ollama tag/ownership. No trade can be modified.','REVIEW_REQUIRED');return
  }
  if(t.state==='CLOSED'){await this.confirmedClosed(a,String(t.realizedPL??'NaN'));return}
  if(t.state!=='OPEN'){this.blocked('Broker trade status is '+t.state,'REVIEW_REQUIRED');return}
  if(!t.stopLossOrder?.price){
   this.blocked('Tagged OANDA trade has no visible stop loss; manual review required','REVIEW_REQUIRED');return
  }
  a.status='ACTIVE';this.state.status='BROKER_OPEN';this.state.lastError=null;this.save()
 }
 // Direct signal mode: the old paper position is NEVER used for broker entry or closure.
 // Persist intent before POST and never retry an ambiguous OANDA execution.
 private async brokerSignalTick(view:PaperView){
  const signal=view.lastBrokerSignal??null
  const k=signal?.key??null
  if(!this.state.signalModeInitialized){
   this.state.signalModeInitialized=true
   this.state.lastSeenSignalKey=k
   if(!this.state.active)this.state.status='WAITING_NEW_OLLAMA_SIGNAL'
   this.note('OLLAMA_BROKER_ONLY_READY','No virtual order execution. Awaiting next new qualified AI signal; old signals skipped.')
   if(this.state.active)await this.manageBrokerActive()
   return
  }
  if(this.state.active){
   // A new signal received while a trade is open is consumed, not queued for late entry.
   if(k&&k!==this.state.lastSeenSignalKey){this.state.lastSeenSignalKey=k;this.save()}
   await this.manageBrokerActive()
   return
  }
  if(!signal||!k||k===this.state.lastSeenSignalKey){
   if(isOandaForexSessionOpen(this.now())&&
     ['BLOCKED','MARKET_CLOSED','WAITING_SHADOW_FREE'].includes(this.state.status)){
    this.state.status='WAITING_NEW_OLLAMA_SIGNAL';this.save()
   }
   return
  }
  // The key is consumed BEFORE network requests, including preflight failures.
  this.state.lastSeenSignalKey=k;this.save()
  if(!isOandaForexSessionOpen(this.now())){
   this.state.status='MARKET_CLOSED'
   this.state.lastError='OANDA FX market is closed: fresh signals are not sent outside the trading session.'
   this.note('OLLAMA_OANDA_MARKET_CLOSED',this.state.lastError)
   return
  }
  if(signal.action!=='OPEN'||!['EUR_USD','GBP_USD'].includes(signal.symbol)||
   !['long','short'].includes(signal.direction)||!Number.isFinite(Date.parse(signal.at))||
   Math.abs(this.now().getTime()-Date.parse(signal.at))>120000){
   this.blocked('Old or invalid Ollama OANDA signal; no order submitted')
   return
  }
  const today=this.now().toISOString().slice(0,10)
  const dailyRealized=this.state.closed.filter(x=>x.closedAt.slice(0,10)===today)
   .reduce((sum,x)=>sum.plus(x.realizedPL),new Decimal(0))
  if(dailyRealized.lte(-30)){this.blocked('OLLAMA_DAILY_LOSS_LIMIT: broker-closed P/L at or below -30 USD');return}
  const clientId=ollamaClientId(k,signal.symbol)
  const spec:OpenSpec={symbol:signal.symbol,direction:signal.direction,units:signal.units,
   hardStop:signal.stop,target:signal.target,referencePrice:signal.entry,clientId}
  try{
   const existing=await this.broker.openTrades()
   if(existing.some(t=>isTagged(t))){this.blocked('Ollama-tagged OANDA trade already open','REVIEW_REQUIRED');return}
   const duplicates=await this.broker.findTagged(clientId)
   if(duplicates.length){this.blocked('Trade with same Ollama signal key already exists in OANDA','REVIEW_REQUIRED');return}
   await this.broker.validateOpen(spec,this.getShadow().position?.symbol||null)
  }catch(e){
   const reason='No order sent: '+String(e)
   if(/SHADOW_PRIORITY|INSTRUMENT_OCCUPIED/.test(reason)){
    this.state.status='WAITING_SHADOW_FREE';this.state.lastError=reason
    this.note('OLLAMA_OANDA_SIGNAL_SKIPPED_SHADOW_PRIORITY',reason)
   }else this.blocked('Broker refused Ollama signal, '+reason)
   return
  }
  const intent:Intent={paperKey:k,clientId,symbol:signal.symbol,direction:signal.direction,units:signal.units,
   stop:signal.stop,status:'OPENING',tradeId:null,fillPrice:null,startedAt:this.now().toISOString()}
  this.state.active=intent;this.state.status='OPENING';this.save()
  try{
   const result=await this.broker.open(spec)
   intent.tradeId=result.tradeId;intent.fillPrice=result.fillPrice;intent.status='ACTIVE'
   this.state.status='RECONCILING'
   this.note('OLLAMA_OANDA_OPEN_CONFIRMED','Broker accepted direct AI signal, Trade ID '+result.tradeId)
   await this.reconcileIntent()
  }catch(e){
   this.state.status='REVIEW_REQUIRED';intent.status='REVIEW_REQUIRED'
   this.state.lastError='OANDA order outcome uncertain. No automatic duplicate allowed: '+String(e)
   this.note('OLLAMA_OANDA_OPEN_REVIEW',this.state.lastError)
  }
 }
 private async manageBrokerActive(){
  const active=this.state.active
  if(!active)return
  await this.reconcileIntent()
  if(!this.state.active||this.state.status==='REVIEW_REQUIRED')return
  const t=await this.broker.trade(active.tradeId!)
  if(!t||!isTagged(t,active.clientId)||t.instrument!==active.symbol){
   this.blocked('Trade ownership mismatch during broker-only monitoring','REVIEW_REQUIRED');return
  }
  if(t.state==='CLOSED'){await this.confirmedClosed(active,String(t.realizedPL??'NaN'));return}
  if(t.state!=='OPEN'){this.blocked('Broker trade status uncertain','REVIEW_REQUIRED');return}
  if(t.unrealizedPL!==undefined&&Number.isFinite(Number(t.unrealizedPL))){
   this.state.brokerOpenPL=String(t.unrealizedPL)
   this.state.brokerOpenPLAt=this.now().toISOString()
  }else{this.state.brokerOpenPL=null;this.state.brokerOpenPLAt=null}
  this.state.status='BROKER_OPEN';this.save()
 }
 private async tick(){
  if(this.busy)return
  this.busy=true
  try{
   if(!isIndependentPracticeEnabled()){
    this.state.status='DISABLED_OR_NOT_PRACTICE';this.state.lastError='Ollama requires the OANDA Practice endpoint'
    return
   }
   if(this.state.status==='REVIEW_REQUIRED')return
   await this.brokerSignalTick(this.getPaper())
  }catch(e){
   this.state.lastError=String(e)
   this.state.status=this.state.active?'REVIEW_REQUIRED':'BLOCKED'
   this.note('OLLAMA_OANDA_ERROR',this.state.lastError)
  }finally{
   this.busy=false
   this.state.lastUpdate=this.now().toISOString()
   try{this.save()}catch{}
  }
 }
 start(){
  void this.tick()
  this.timer=setInterval(()=>void this.tick(),5000)
 }
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
 // Read-only manual recovery from an ambiguous broker response.
 // Never opens, closes or moves the stop during this action.
 async reconcileOnly(){
  if(this.busy||!isIndependentPracticeEnabled()||this.state.status!=='REVIEW_REQUIRED'||!this.state.active)return this.snapshot()
  this.busy=true
  try{
   await this.reconcileIntent()
   if(this.snapshot().status==='BROKER_OPEN')this.note('OLLAMA_OANDA_RECOVERED','OANDA ownership and attached stop confirmed; management resumes on next cycle')
  }catch(e){
   this.state.status='REVIEW_REQUIRED';this.state.lastError='Still requires review: '+String(e)
   this.note('OLLAMA_OANDA_RECHECK_FAILED',this.state.lastError)
  }finally{this.busy=false;this.save()}
  return this.snapshot()
 }
 // Test entry point; does not bypass any risk or ownership checks.
 async checkNow(){await this.tick()}
}
