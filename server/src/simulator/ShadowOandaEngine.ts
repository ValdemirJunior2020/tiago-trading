import{OllamaSignalEngine}from'./OllamaSignalEngine.js'
import{Decimal}from'decimal.js'
import{existsSync,mkdirSync,readFileSync,renameSync,writeFileSync}from'node:fs'
import{resolve,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{OandaReadOnly}from'../broker/OandaReadOnly.js'
import{strategyContext}from'../indicators.js'
import{evaluate,analyzeCandidate}from'../strategy.js'
import{RiskManager}from'../risk/RiskManager.js'
import{env,SHADOW_OANDA_PAIRS,OANDA_DEMO_MIRROR_ENABLED}from'../config.js'
import{logShadowCandidate,logShadowTrade}from'./logger.js'
import type{Direction}from'../types.js'

type Position={
 symbol:string
 direction:Direction
 units:string
 entry:string
 hardStop:string
 openedAt:string
 reasons:string[]
 marginRequired?:string
 marginAvailable?:string
 marginAfterTrade?:string
 effectiveLeverage?:string
 lotSize?:string
 peakExit?:string
 profitLockActive?:boolean
 trailingActive?:boolean
 originalHardStop?:string
 initialRiskCash?:string
 brokerMirrorTradeId?:string
 brokerMirrorFillPrice?:string
 brokerMirrorStop?:string
 brokerMirrorStatus?:'OPEN'|'CLOSED'|'ERROR'
}

type StrategyName='SHADOW_3_OF_4'
type StrategyStats={
 trades:number
 wins:number
 losses:number
 grossProfit:string
 grossLoss:string
 netProfit:string
 peakNetProfit:string
 maxDrawdown:string
 lastPnl:string
 lastClosedAt:string|null
}
const blankStrategyStats=():StrategyStats=>({trades:0,wins:0,losses:0,grossProfit:'0',grossLoss:'0',netProfit:'0',peakNetProfit:'0',maxDrawdown:'0',lastPnl:'0',lastClosedAt:null})

type State={
 lastCandle:Record<string,string>
 shadowCandidates:number
 lastShadowCandidate:any|null
 shadowExperiment:{
  balance:string
  realizedPL:string
  position:Position|null
  opens:number
  closes:number
  wins:number
  losses:number
  lastAction:any|null
  pendingMirrorCloseTradeId:string|null
 }
 strategyPerformance:Record<StrategyName,StrategyStats>
}

const here=dirname(fileURLToPath(import.meta.url))
const STATE_PATH=resolve(here,'../../../data/simulator-state.json')
const SHADOW_RISK_PATH=resolve(here,'../../../data/shadow-simulator-risk.json')
const SHADOW_TRADE_LOG_PATH=resolve(here,'../../../logs/shadow-paper/trades.jsonl')
export class ShadowOandaEngine{
 private state:State={lastCandle:{},shadowCandidates:0,lastShadowCandidate:null,
  shadowExperiment:{balance:'0',realizedPL:'0',position:null,opens:0,closes:0,wins:0,losses:0,lastAction:null,pendingMirrorCloseTradeId:null},
  strategyPerformance:{SHADOW_3_OF_4:blankStrategyStats()}}
 private timer:NodeJS.Timeout|null=null
 private busy=false
 private shadowRisk=new RiskManager(SHADOW_RISK_PATH)
 private shadowRecoveryChecked=false
 private ollamaPaper:OllamaSignalEngine
 constructor(private broker:OandaReadOnly){
  this.load()
  this.ollamaPaper=new OllamaSignalEngine(broker)
 }

 private load(){
  if(!existsSync(STATE_PATH))return
  try{
   const saved=JSON.parse(readFileSync(STATE_PATH,'utf8'))
   // Explicitly restore ONLY Shadow state. Never restore obsolete paper strategies.
   this.state.lastCandle=saved.lastCandle&&typeof saved.lastCandle==='object'?saved.lastCandle:{}
   this.state.shadowCandidates=Number(saved.shadowCandidates||0)
   this.state.lastShadowCandidate=saved.lastShadowCandidate??null
   this.state.shadowExperiment={...this.state.shadowExperiment,...(saved.shadowExperiment||{})}
   this.state.strategyPerformance={
    SHADOW_3_OF_4:{...blankStrategyStats(),...(saved.strategyPerformance?.SHADOW_3_OF_4||{})}
   }
  }catch{}
 }

 private recoverShadowOpenFromLog(){
  if(this.shadowRecoveryChecked)return false
  this.shadowRecoveryChecked=true
  if(this.state.shadowExperiment.position||!existsSync(SHADOW_TRADE_LOG_PATH))return false

  try{
   const rows=readFileSync(SHADOW_TRADE_LOG_PATH,'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line=>{try{return JSON.parse(line)}catch{return null}})
    .filter(Boolean) as any[]

   let latestOpen:any=null
   let latestClose:any=null
   for(const row of rows){
    if(row.event==='SHADOW_PAPER_OPEN')latestOpen=row
    else if(row.event==='SHADOW_PAPER_CLOSE')latestClose=row
   }

   if(!latestOpen)return false
   const openAt=Date.parse(String(latestOpen.at||latestOpen.openedAt||''))
   const closeAt=latestClose?Date.parse(String(latestClose.at||'')):Number.NEGATIVE_INFINITY
   if(Number.isFinite(closeAt)&&closeAt>=openAt)return false

   const stateClose=this.state.shadowExperiment.lastAction
   if(stateClose?.type==='SHADOW_PAPER_CLOSE'){
    const stateCloseAt=Date.parse(String(stateClose.at||''))
    if(Number.isFinite(stateCloseAt)&&stateCloseAt>=openAt)return false
   }

   const marks=rows.filter(row=>
    row.event==='SHADOW_POSITION_MARK'&&
    row.symbol===latestOpen.symbol&&
    Date.parse(String(row.at||''))>=openAt
   )
   const lastMark=marks.at(-1)
   const direction:Direction=latestOpen.direction==='short'?'short':'long'
   const entry=new Decimal(String(latestOpen.entry))
   const units=new Decimal(String(latestOpen.units))
   let peakExit:string|undefined
   const peakPnlValue=lastMark?.peakUnrealizedPL
   if(peakPnlValue!==undefined&&units.gt(0)){
    const distance=new Decimal(String(peakPnlValue)).div(units)
    peakExit=(direction==='long'?entry.plus(distance):entry.minus(distance)).toString()
   }

   const matched=Array.isArray(latestOpen.candidate?.matchedConditions)?latestOpen.candidate.matchedConditions:[]
   const missing=Array.isArray(latestOpen.candidate?.missing)?latestOpen.candidate.missing:[]
   const reasons=[...matched,...(missing.length?[`missing: ${missing.join(', ')}`]:[])]

   this.state.shadowExperiment.position={
    symbol:String(latestOpen.symbol),
    direction,
    units:String(latestOpen.units),
    entry:String(latestOpen.entry),
    hardStop:String(lastMark?.hardStop||latestOpen.hardStop),
    openedAt:String(latestOpen.openedAt||latestOpen.at||new Date().toISOString()),
    reasons,
    marginRequired:latestOpen.marginRequired!==undefined?String(latestOpen.marginRequired):undefined,
    marginAvailable:latestOpen.marginAvailable!==undefined?String(latestOpen.marginAvailable):undefined,
    marginAfterTrade:latestOpen.marginAfterTrade!==undefined?String(latestOpen.marginAfterTrade):undefined,
    effectiveLeverage:latestOpen.effectiveLeverage!==undefined?String(latestOpen.effectiveLeverage):undefined,
    lotSize:latestOpen.lotSize!==undefined?String(latestOpen.lotSize):undefined,
    peakExit,
    profitLockActive:!!lastMark?.profitLockActive,
    trailingActive:!!lastMark?.trailingActive,
    originalHardStop:String(latestOpen.originalHardStop||latestOpen.hardStop),
    initialRiskCash:latestOpen.initialRiskCash!==undefined?String(latestOpen.initialRiskCash):latestOpen.riskCash!==undefined?String(latestOpen.riskCash):undefined,
    brokerMirrorTradeId:(rows.filter(row=>row.event==='SHADOW_DEMO_MIRROR_OPENED'&&row.symbol===latestOpen.symbol&&Date.parse(String(row.at||''))>=openAt).at(-1)?.tradeId)||undefined,
    brokerMirrorFillPrice:(rows.filter(row=>row.event==='SHADOW_DEMO_MIRROR_OPENED'&&row.symbol===latestOpen.symbol&&Date.parse(String(row.at||''))>=openAt).at(-1)?.fillPrice)||undefined,
    brokerMirrorStop:(rows.filter(row=>row.event==='SHADOW_DEMO_MIRROR_OPENED'&&row.symbol===latestOpen.symbol&&Date.parse(String(row.at||''))>=openAt).at(-1)?.hardStop)||undefined,
    brokerMirrorStatus:(rows.filter(row=>row.event==='SHADOW_DEMO_MIRROR_OPENED'&&row.symbol===latestOpen.symbol&&Date.parse(String(row.at||''))>=openAt).at(-1)?'OPEN':undefined)
   }
   this.state.shadowExperiment.opens=Math.max(this.state.shadowExperiment.opens||0,1)
   this.state.shadowExperiment.lastAction={
    at:new Date().toISOString(),
    type:'SHADOW_STATE_RECOVERED_FROM_LOG',
    symbol:latestOpen.symbol,
    direction,
    entry:latestOpen.entry,
    openedAt:latestOpen.openedAt||latestOpen.at,
    source:'logs/shadow-paper/trades.jsonl'
   }
   logShadowTrade({
    event:'SHADOW_STATE_RECOVERED_FROM_LOG',
    symbol:latestOpen.symbol,
    direction,
    entry:latestOpen.entry,
    openedAt:latestOpen.openedAt||latestOpen.at,
    hardStop:this.state.shadowExperiment.position.hardStop
   })
   return true
  }catch(e){
   logShadowTrade({event:'SHADOW_STATE_RECOVERY_ERROR',error:e instanceof Error?e.message:String(e)})
   return false
  }
 }


 private save(){
  mkdirSync(dirname(STATE_PATH),{recursive:true})
  const tmp=STATE_PATH+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,STATE_PATH)
 }

 private async ensureBalance(){
  const a=await this.broker.account()
  let changed=false
  const shadow=this.state.shadowExperiment
  const shadowBalance=new Decimal(shadow?.balance||0)
  const shadowRealized=new Decimal(shadow?.realizedPL||0)
  const referenceEquity=new Decimal(a.equity||0)
  // Preserve Shadow's existing recovery, positions, stop calculations and risk semantics.
  if(shadowBalance.lte(0)&&shadowRealized.abs().lte(referenceEquity.mul(2))){
   this.state.shadowExperiment.balance=a.equity
   changed=true
  }
  const corruptedShadow=referenceEquity.gt(0)&&shadowRealized.abs().gt(referenceEquity.mul(2))
  if(corruptedShadow){
   const previous={...shadow}
   this.state.shadowExperiment={balance:a.equity,realizedPL:'0',position:null,opens:0,closes:0,
    wins:0,losses:0,lastAction:{at:new Date().toISOString(),type:'SHADOW_STATE_REPAIRED',
    reason:'Invalid shadow P/L state detected after cross-symbol quote bug',previous},pendingMirrorCloseTradeId:null}
   this.shadowRisk.reset(a.equity)
   logShadowTrade({event:'SHADOW_STATE_REPAIRED',reason:'Invalid shadow P/L state detected after cross-symbol quote bug',previous,recoveredBalance:a.equity})
   changed=true
  }
  if(!corruptedShadow&&this.recoverShadowOpenFromLog()){
   this.shadowRisk.recordEquity(this.state.shadowExperiment.balance)
   changed=true
  }
  const staleShadowRisk=this.state.shadowExperiment.opens===0&&this.state.shadowExperiment.closes===0&&
   new Decimal(this.state.shadowExperiment.realizedPL||0).eq(0)&&this.shadowRisk.locked()
  if(staleShadowRisk){
   this.shadowRisk.reset(a.equity)
   logShadowTrade({event:'SHADOW_RISK_RESET',reason:'Stale/corrupted shadow risk history cleared',recoveredEquity:a.equity})
   changed=true
  }
  if(changed)this.save()
 }

 start(){
  logShadowTrade({event:'SHADOW_LOG_READY',status:'ready',pairs:SHADOW_OANDA_PAIRS,demoMirrorEnabled:OANDA_DEMO_MIRROR_ENABLED})
  this.ollamaPaper.start()
  void this.tick()
  this.timer=setInterval(()=>void this.tick(),Math.max(10000,env.SHADOW_OANDA_POLL_MS))
 }
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
 // Only OANDA-backed details are offered to the UI. Legacy simulated balances are never returned.
 snapshot(){const ai=this.ollamaPaper.snapshot();return{
  shadowCandidates:this.state.shadowCandidates,
  lastShadowCandidate:this.state.lastShadowCandidate?{
   symbol:this.state.lastShadowCandidate.symbol,side:this.state.lastShadowCandidate.side,
   missing:this.state.lastShadowCandidate.missing,
   at:this.state.lastShadowCandidate.at
  }:null,
  ollamaAi:{status:ai.status,decisions:ai.decisions,signals:ai.signals,errors:ai.errors,
   lastReviewedAt:ai.lastReviewedAt,lastDecision:ai.lastDecision,
   lastSetup:ai.lastSetup,lastMarket:ai.lastMarket,events:ai.events,
   lastBrokerSignal:ai.lastBrokerSignal},
  brokerLearning:ai.brokerLearning,
 }}
 // Read only for shadow/Ollama owner coordination; local values are NEVER shown as broker P/L.
 shadowSnapshot(){return{position:this.state.shadowExperiment.position,
  pendingMirrorCloseTradeId:this.state.shadowExperiment.pendingMirrorCloseTradeId}}
 ollamaSnapshot(){const ai=this.ollamaPaper.snapshot();return{lastBrokerSignal:ai.lastBrokerSignal??null}}
 private recordStrategyResult(strategy:StrategyName,pnl:Decimal){
  const v=this.state.strategyPerformance[strategy]
  v.trades++;v.lastPnl=pnl.toString();v.lastClosedAt=new Date().toISOString()
  if(pnl.gt(0)){v.wins++;v.grossProfit=new Decimal(v.grossProfit).plus(pnl).toString()}
  else if(pnl.lt(0)){v.losses++;v.grossLoss=new Decimal(v.grossLoss).plus(pnl.abs()).toString()}
  const net=new Decimal(v.netProfit).plus(pnl),peak=Decimal.max(new Decimal(v.peakNetProfit),net)
  v.netProfit=net.toString();v.peakNetProfit=peak.toString()
  const dd=peak.minus(net)
  if(dd.gt(new Decimal(v.maxDrawdown)))v.maxDrawdown=dd.toString()
 }
 private pnlFor(p:Position,exit:string){
  const e=new Decimal(exit),entry=new Decimal(p.entry),units=new Decimal(p.units)
  return(p.direction==='long'?e.minus(entry):entry.minus(e)).mul(units)
 }

 private async syncShadowDemoStop(p:Position){
  if(!OANDA_DEMO_MIRROR_ENABLED||!p.brokerMirrorTradeId||p.brokerMirrorStatus!=='OPEN')return
  if(p.brokerMirrorStop===p.hardStop)return
  try{
   const r=await this.broker.updatePracticeStopLoss(p.brokerMirrorTradeId,p.symbol,p.hardStop)
   p.brokerMirrorStop=p.hardStop
   this.save()
   logShadowTrade({event:'SHADOW_DEMO_MIRROR_STOP_SYNCED',symbol:p.symbol,tradeId:p.brokerMirrorTradeId,hardStop:p.hardStop,transactionId:r.lastTransactionID})
  }catch(e){
   logShadowTrade({event:'SHADOW_DEMO_MIRROR_STOP_ERROR',symbol:p.symbol,tradeId:p.brokerMirrorTradeId,hardStop:p.hardStop,error:e instanceof Error?e.message:String(e)})
  }
 }

 private async reconcilePendingShadowMirrorClose(){
  const tradeId=this.state.shadowExperiment.pendingMirrorCloseTradeId
  if(!OANDA_DEMO_MIRROR_ENABLED||!tradeId)return
  try{
   const r=await this.broker.closePracticeTrade(tradeId)
   this.state.shadowExperiment.pendingMirrorCloseTradeId=null
   this.save()
   logShadowTrade({event:'SHADOW_DEMO_MIRROR_CLOSE_RECONCILED',tradeId,fillPrice:r.fillPrice,realizedPL:r.realizedPL,transactionId:r.transactionId})
  }catch(e){
   try{
    const t=await this.broker.trade(tradeId)
    if(t?.state==='CLOSED'){
     this.state.shadowExperiment.pendingMirrorCloseTradeId=null
     this.save()
     logShadowTrade({event:'SHADOW_DEMO_MIRROR_ALREADY_CLOSED',tradeId})
     return
    }
   }catch{}
   logShadowTrade({event:'SHADOW_DEMO_MIRROR_CLOSE_RETRY_ERROR',tradeId,error:e instanceof Error?e.message:String(e)})
  }
 }

 private async manageShadowOpen(){
  const p=this.state.shadowExperiment.position
  if(!p)return
  const q=await this.broker.quote(p.symbol)
  if(q.symbol!==p.symbol){
   logShadowTrade({event:'SHADOW_QUOTE_REJECTED',positionSymbol:p.symbol,quoteSymbol:q.symbol,reason:'Symbol mismatch'})
   return
  }
  const exit=p.direction==='long'?q.bid:q.ask
  const exitDec=new Decimal(exit)
  const entry=new Decimal(p.entry)
  const units=new Decimal(p.units)

  // Shadow-only R-multiple profit protection. STRICT strategy remains untouched.
  // R = cash initially at risk if the ORIGINAL hard stop is hit.
  // 1) At +1R open P/L, move the stop to break-even.
  // 2) Once peak open P/L reaches +2R, trail 50% of the best profit reached.
  // This avoids fixed-dollar thresholds behaving differently as account size/risk changes.
  const originalStop=new Decimal(p.originalHardStop||p.hardStop)
  const riskCash=p.initialRiskCash
   ?new Decimal(p.initialRiskCash)
   :entry.minus(originalStop).abs().mul(units)
  const priorPeak=p.peakExit?new Decimal(p.peakExit):exitDec
  const betterPeak=p.direction==='long'?exitDec.gt(priorPeak):exitDec.lt(priorPeak)
  if(!p.peakExit||betterPeak)p.peakExit=exitDec.toString()

  const peakExit=new Decimal(p.peakExit)
  const peakPnl=(p.direction==='long'?peakExit.minus(entry):entry.minus(peakExit)).mul(units)
  const currentPnl=this.pnlFor(p,exit)

  if(riskCash.gt(0)&&currentPnl.gte(riskCash)&&!p.profitLockActive){
   const oldStop=p.hardStop
   p.hardStop=entry.toString()
   p.profitLockActive=true
   this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_BREAK_EVEN_ARMED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,unrealizedPL:currentPnl.toString(),riskCash:riskCash.toString(),rMultiple:currentPnl.div(riskCash).toString()}
   logShadowTrade({event:'SHADOW_BREAK_EVEN_ARMED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,unrealizedPL:currentPnl.toString(),riskCash:riskCash.toString(),rMultiple:currentPnl.div(riskCash).toString()})
  }

  if(riskCash.gt(0)&&peakPnl.gte(riskCash.mul(2))){
   const protectedPnl=peakPnl.mul(0.5)
   const distance=protectedPnl.div(units)
   const trailingStop=p.direction==='long'?entry.plus(distance):entry.minus(distance)
   const currentStop=new Decimal(p.hardStop)
   const improves=p.direction==='long'?trailingStop.gt(currentStop):trailingStop.lt(currentStop)
   if(improves){
    const oldStop=p.hardStop
    p.hardStop=trailingStop.toString()
    p.trailingActive=true
    this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_TRAIL_RAISED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,peakUnrealizedPL:peakPnl.toString(),protectedPL:protectedPnl.toString(),riskCash:riskCash.toString(),peakR:peakPnl.div(riskCash).toString()}
    logShadowTrade({event:'SHADOW_TRAIL_RAISED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,peakUnrealizedPL:peakPnl.toString(),protectedPL:protectedPnl.toString(),riskCash:riskCash.toString(),peakR:peakPnl.div(riskCash).toString()})
   }
  }

  await this.syncShadowDemoStop(p)
  const stop=new Decimal(p.hardStop)
  const hit=p.direction==='long'?exitDec.lte(stop):exitDec.gte(stop)
  const unrealized=currentPnl
  const markedEquity=new Decimal(this.state.shadowExperiment.balance).plus(unrealized)
  this.shadowRisk.recordEquity(markedEquity.toString())
  logShadowTrade({event:'SHADOW_POSITION_MARK',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,hardStop:p.hardStop,originalHardStop:p.originalHardStop||p.hardStop,riskCash:riskCash.toString(),rMultiple:riskCash.gt(0)?unrealized.div(riskCash).toString():null,unrealizedPL:unrealized.toString(),peakUnrealizedPL:peakPnl.toString(),profitLockActive:!!p.profitLockActive,trailingActive:!!p.trailingActive,markedEquity:markedEquity.toString(),riskLocked:this.shadowRisk.locked()})
  if(hit)await this.closeShadowPosition(exit,p.trailingActive?'TRAILING_PROFIT':p.profitLockActive?'BREAK_EVEN_PROTECT':'HARD_STOP')
 }

 private async closeShadowPosition(exit:string,reason:string){
  const p=this.state.shadowExperiment.position
  if(!p)return
  const pnl=this.pnlFor(p,exit)
  const nextBalance=new Decimal(this.state.shadowExperiment.balance).plus(pnl)
  const won=pnl.gt(0)
  this.state.shadowExperiment.balance=nextBalance.toString()
  this.state.shadowExperiment.realizedPL=new Decimal(this.state.shadowExperiment.realizedPL).plus(pnl).toString()
  this.state.shadowExperiment.position=null
  this.state.shadowExperiment.closes++
  if(won)this.state.shadowExperiment.wins++
  else if(pnl.lt(0))this.state.shadowExperiment.losses++
  this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_PAPER_CLOSE',symbol:p.symbol,direction:p.direction,exit,reason,pnl:pnl.toString(),balance:nextBalance.toString(),demoMirrorTradeId:p.brokerMirrorTradeId||null}
  this.recordStrategyResult('SHADOW_3_OF_4',pnl)
  this.shadowRisk.recordEquity(nextBalance.toString())
  if(OANDA_DEMO_MIRROR_ENABLED&&p.brokerMirrorTradeId){
   this.state.shadowExperiment.pendingMirrorCloseTradeId=p.brokerMirrorTradeId
  }
  this.save()
  logShadowTrade({event:'SHADOW_PAPER_CLOSE',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),balance:nextBalance.toString(),reason,openedAt:p.openedAt,demoMirrorTradeId:p.brokerMirrorTradeId||null})
  if(OANDA_DEMO_MIRROR_ENABLED&&p.brokerMirrorTradeId){
   try{
    const r=await this.broker.closePracticeTrade(p.brokerMirrorTradeId)
    this.state.shadowExperiment.pendingMirrorCloseTradeId=null
    this.save()
    logShadowTrade({event:'SHADOW_DEMO_MIRROR_CLOSED',symbol:p.symbol,tradeId:p.brokerMirrorTradeId,fillPrice:r.fillPrice,realizedPL:r.realizedPL,transactionId:r.transactionId,localReason:reason})
   }catch(e){
    try{
     const t=await this.broker.trade(p.brokerMirrorTradeId)
     if(t?.state==='CLOSED'){
      this.state.shadowExperiment.pendingMirrorCloseTradeId=null
      this.save()
      logShadowTrade({event:'SHADOW_DEMO_MIRROR_ALREADY_CLOSED',symbol:p.symbol,tradeId:p.brokerMirrorTradeId,localReason:reason})
      return
     }
    }catch{}
    logShadowTrade({event:'SHADOW_DEMO_MIRROR_CLOSE_ERROR',symbol:p.symbol,tradeId:p.brokerMirrorTradeId,error:e instanceof Error?e.message:String(e),localReason:reason})
   }
  }
 }

 private async maybeOpenShadow(symbol:string,candidate:ReturnType<typeof analyzeCandidate>,q:any){
  if(!candidate.side||this.state.shadowExperiment.position||this.shadowRisk.locked())return
  if(!['EUR_USD','GBP_USD'].includes(symbol)){
   logShadowTrade({event:'SHADOW_SIGNAL_SKIPPED',symbol,side:candidate.side,reason:'Cross-currency P/L conversion not yet enabled',candidate})
   return
  }
  const direction:Direction=candidate.side==='LONG'?'long':'short'
  const fill=direction==='long'?q.ask:q.bid
  const reasons=[...candidate.matchedConditions,`missing: ${candidate.missing.join(', ')}`]
  const plan=this.shadowRisk.plan(symbol,direction,fill,this.state.shadowExperiment.balance,reasons)
  const account=await this.broker.account()
  const margin=await this.broker.marginMetrics(symbol,fill,plan.units,account.marginAvailable)
  this.state.shadowExperiment.position={symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,originalHardStop:plan.hardStop,initialRiskCash:plan.riskCash,openedAt:new Date().toISOString(),reasons,...margin}
  this.state.shadowExperiment.opens++
  this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_PAPER_OPEN',symbol,direction,entry:fill,hardStop:plan.hardStop,units:plan.units,riskCash:plan.riskCash,...margin,candidate}
  this.shadowRisk.recordEquity(this.state.shadowExperiment.balance)
  this.save()
  logShadowTrade({event:'SHADOW_PAPER_OPEN',symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,originalHardStop:plan.hardStop,riskCash:plan.riskCash,initialRiskCash:plan.riskCash,...margin,candidate,simulatedOnly:true})
  if(OANDA_DEMO_MIRROR_ENABLED){
   try{
    const mirror=await this.broker.openPracticeTrade(symbol,direction,plan.units,plan.hardStop)
    const p=this.state.shadowExperiment.position
    if(p&&p.symbol===symbol&&p.direction===direction){
     p.brokerMirrorTradeId=mirror.tradeId
     p.brokerMirrorFillPrice=mirror.fillPrice
     p.brokerMirrorStop=mirror.stopPrice
     p.brokerMirrorStatus='OPEN'
     this.state.shadowExperiment.lastAction={...this.state.shadowExperiment.lastAction,demoMirrorTradeId:mirror.tradeId,demoMirrorFillPrice:mirror.fillPrice,demoMirrorStatus:'OPEN'}
     this.save()
    }
    logShadowTrade({event:'SHADOW_DEMO_MIRROR_OPENED',symbol,direction,units:plan.units,tradeId:mirror.tradeId,fillPrice:mirror.fillPrice,hardStopLocal:plan.hardStop,hardStopOanda:mirror.stopPrice,transactionId:mirror.transactionId,practiceOnly:true})
   }catch(e){
    const p=this.state.shadowExperiment.position
    if(p&&p.symbol===symbol&&p.direction===direction)p.brokerMirrorStatus='ERROR'
    this.save()
    logShadowTrade({event:'SHADOW_DEMO_MIRROR_OPEN_ERROR',symbol,direction,units:plan.units,hardStop:plan.hardStop,error:e instanceof Error?e.message:String(e),practiceOnly:true})
   }
  }
 }


 private async processSymbol(symbol:string){
  const [m5,m10,q]=await Promise.all([
   this.broker.candles(symbol,'M5',60),
   this.broker.candles(symbol,'M10',40),
   this.broker.quote(symbol)
  ])
  const last=m5.at(-1)
  if(!last||this.state.lastCandle[symbol]===last.time)return
  this.state.lastCandle[symbol]=last.time
  const context=strategyContext(m5,m10)
  // The evaluate() gate and candidate matching below are the ORIGINAL Shadow 3/4 logic.
  const signal=evaluate(context)
  const candidate=analyzeCandidate(context)
  if(signal.decision==='WAIT'&&candidate.side){
   const shadow={at:new Date().toISOString(),event:'SHADOW_CANDIDATE',symbol,candleTime:last.time,
    side:candidate.side,matched:candidate.matched,total:candidate.total,missing:candidate.missing,
    matchedConditions:candidate.matchedConditions,context,quote:q,simulatedOnly:true,executed:false}
   this.state.shadowCandidates++
   this.state.lastShadowCandidate=shadow
   logShadowCandidate(shadow)
   const currentShadow=this.state.shadowExperiment.position
   if(currentShadow&&currentShadow.symbol===symbol){
    const opposite=(currentShadow.direction==='long'&&candidate.side==='SHORT')||
     (currentShadow.direction==='short'&&candidate.side==='LONG')
    if(opposite){
     if(q.symbol!==currentShadow.symbol){
      logShadowTrade({event:'SHADOW_QUOTE_REJECTED',positionSymbol:currentShadow.symbol,quoteSymbol:q.symbol,
       reason:'Symbol mismatch on opposite candidate'})
     }else{
      const exit=currentShadow.direction==='long'?q.bid:q.ask
      await this.closeShadowPosition(exit,'OPPOSITE_3_OF_4')
     }
    }
   }
   await this.maybeOpenShadow(symbol,candidate,q)
  }
 }

 async tick(){
  if(this.busy)return
  this.busy=true
  try{
   await this.ensureBalance()
   await this.reconcilePendingShadowMirrorClose()
   await this.manageShadowOpen()
   for(const symbol of SHADOW_OANDA_PAIRS){
    try{await this.processSymbol(symbol)}
    catch(e){logShadowTrade({event:'SHADOW_SYMBOL_ERROR',symbol,error:e instanceof Error?e.message:String(e)})}
    await this.ollamaPaper.process(symbol)
   }
   this.save()
  }catch(e){
   logShadowTrade({event:'SHADOW_ENGINE_ERROR',error:e instanceof Error?e.message:String(e)})
  }finally{this.busy=false}
 }
}
