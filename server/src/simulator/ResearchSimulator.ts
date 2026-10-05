import{Decimal}from'decimal.js'
import{existsSync,mkdirSync,readFileSync,renameSync,writeFileSync}from'node:fs'
import{resolve,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{OandaReadOnly}from'../broker/OandaReadOnly.js'
import{strategyContext}from'../indicators.js'
import{evaluate,analyzeCandidate}from'../strategy.js'
import{RiskManager}from'../risk/RiskManager.js'
import{critique}from'../ollama.js'
import{env,SIMULATOR_ENABLED,SIMULATOR_PAIRS}from'../config.js'
import{logSimulator,logTrade,logFimatheMarket,logShadowCandidate,logShadowTrade}from'./logger.js'
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
}

type StrategyName='STRICT_4_OF_4'|'SHADOW_3_OF_4'|'FIMATHE'
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
 balance:string
 realizedPL:string
 lastCandle:Record<string,string>
 position:Position|null
 startedAt:string
 decisions:number
 signals:number
 lastDecision:any|null
 lastSignal:any|null
 lastAction:any|null
 fimatheLastCandle:Record<string,string>
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
 }
 strategyPerformance:Record<StrategyName,StrategyStats>
}

const here=dirname(fileURLToPath(import.meta.url))
const STATE_PATH=resolve(here,'../../../data/simulator-state.json')
const RISK_PATH=resolve(here,'../../../data/simulator-risk.json')
const SHADOW_RISK_PATH=resolve(here,'../../../data/shadow-simulator-risk.json')
const SHADOW_TRADE_LOG_PATH=resolve(here,'../../../logs/shadow-paper/trades.jsonl')

export class ResearchSimulator{
 private state:State={balance:'0',realizedPL:'0',lastCandle:{},position:null,startedAt:new Date().toISOString(),decisions:0,signals:0,lastDecision:null,lastSignal:null,lastAction:null,fimatheLastCandle:{},shadowCandidates:0,lastShadowCandidate:null,shadowExperiment:{balance:'0',realizedPL:'0',position:null,opens:0,closes:0,wins:0,losses:0,lastAction:null},strategyPerformance:{STRICT_4_OF_4:blankStrategyStats(),SHADOW_3_OF_4:blankStrategyStats(),FIMATHE:blankStrategyStats()}}
 private timer:NodeJS.Timeout|null=null
 private busy=false
 private simRisk=new RiskManager(RISK_PATH)
 private shadowRisk=new RiskManager(SHADOW_RISK_PATH)
 private shadowRecoveryChecked=false

 constructor(private broker:OandaReadOnly){this.load()}

 private load(){
  if(!existsSync(STATE_PATH))return
  try{
   const saved=JSON.parse(readFileSync(STATE_PATH,'utf8'))
   this.state={...this.state,...saved}
   this.state.shadowExperiment={...this.state.shadowExperiment,...(saved.shadowExperiment||{})}
   const perf=saved.strategyPerformance||{}
   this.state.strategyPerformance={
    STRICT_4_OF_4:{...blankStrategyStats(),...(perf.STRICT_4_OF_4||{})},
    SHADOW_3_OF_4:{...blankStrategyStats(),...(perf.SHADOW_3_OF_4||{})},
    FIMATHE:{...blankStrategyStats(),...(perf.FIMATHE||{})}
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
    trailingActive:!!lastMark?.trailingActive
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
  if(new Decimal(this.state.balance||0).lte(0)){
   this.state.balance=a.equity
   this.simRisk.recordEquity(a.equity)
   changed=true
  }

  const shadow=this.state.shadowExperiment
  const shadowBalance=new Decimal(shadow?.balance||0)
  const shadowRealized=new Decimal(shadow?.realizedPL||0)
  const referenceEquity=new Decimal(a.equity||0)

  // A missing/zero balance can happen after moving the repo to a new PC/drive.
  // Initialize the balance without erasing an open Shadow trade that can be
  // recovered from the append-only trade log.
  if(shadowBalance.lte(0)&&shadowRealized.abs().lte(referenceEquity.mul(2))){
   this.state.shadowExperiment.balance=a.equity
   changed=true
  }

  // Self-heal only obviously impossible/corrupted realized P/L.
  // With this simulator's capped risk, realized P/L beyond 200% of the
  // reference account is treated as data corruption, not a trading result.
  const corruptedShadow=
   referenceEquity.gt(0)&&shadowRealized.abs().gt(referenceEquity.mul(2))

  if(corruptedShadow){
   const previous={...shadow}
   this.state.shadowExperiment={
    balance:a.equity,
    realizedPL:'0',
    position:null,
    opens:0,
    closes:0,
    wins:0,
    losses:0,
    lastAction:{
     at:new Date().toISOString(),
     type:'SHADOW_STATE_REPAIRED',
     reason:'Invalid shadow P/L state detected after cross-symbol quote bug',
     previous
    }
   }
   this.shadowRisk.reset(a.equity)
   logShadowTrade({event:'SHADOW_STATE_REPAIRED',reason:'Invalid shadow P/L state detected after cross-symbol quote bug',previous,recoveredBalance:a.equity})
   changed=true
  }

  if(!corruptedShadow&&this.recoverShadowOpenFromLog()){
   this.shadowRisk.recordEquity(this.state.shadowExperiment.balance)
   changed=true
  }

  const staleShadowRisk=
   this.state.shadowExperiment.opens===0&&
   this.state.shadowExperiment.closes===0&&
   new Decimal(this.state.shadowExperiment.realizedPL||0).eq(0)&&
   this.shadowRisk.locked()

  if(staleShadowRisk){
   this.shadowRisk.reset(a.equity)
   logShadowTrade({event:'SHADOW_RISK_RESET',reason:'Stale/corrupted shadow risk history cleared',recoveredEquity:a.equity})
   changed=true
  }

  if(changed)this.save()
 }

 start(){
  if(!SIMULATOR_ENABLED)return
  if(Date.now()>=new Date(env.SIMULATOR_END_AT).getTime())return
  logSimulator({event:'SIMULATOR_START',endAt:env.SIMULATOR_END_AT,pairs:SIMULATOR_PAIRS})
  logShadowTrade({event:'SHADOW_LOG_READY',status:'ready',pairs:SIMULATOR_PAIRS})
  void this.tick()
  this.timer=setInterval(()=>void this.tick(),Math.max(10000,env.SIMULATOR_POLL_MS))
 }

 stop(){
  if(this.timer)clearInterval(this.timer)
  this.timer=null
  logSimulator({event:'SIMULATOR_STOP'})
 }

 snapshot(){return this.state}

 private recordStrategyResult(strategy:StrategyName,pnl:Decimal){
  const s=this.state.strategyPerformance[strategy]
  s.trades++
  s.lastPnl=pnl.toString()
  s.lastClosedAt=new Date().toISOString()
  if(pnl.gt(0)){
   s.wins++
   s.grossProfit=new Decimal(s.grossProfit).plus(pnl).toString()
  }else if(pnl.lt(0)){
   s.losses++
   s.grossLoss=new Decimal(s.grossLoss).plus(pnl.abs()).toString()
  }
  const net=new Decimal(s.netProfit).plus(pnl)
  s.netProfit=net.toString()
  const peak=Decimal.max(new Decimal(s.peakNetProfit),net)
  s.peakNetProfit=peak.toString()
  const dd=peak.minus(net)
  if(dd.gt(new Decimal(s.maxDrawdown)))s.maxDrawdown=dd.toString()
 }

 private pnlFor(p:Position,exit:string){
  const e=new Decimal(exit),entry=new Decimal(p.entry),units=new Decimal(p.units)
  return(p.direction==='long'?e.minus(entry):entry.minus(e)).mul(units)
 }

 private async manageOpen(){
  const p=this.state.position
  if(!p)return
  const q=await this.broker.quote(p.symbol)
  if(q.symbol!==p.symbol){
   logSimulator({event:'QUOTE_REJECTED',positionSymbol:p.symbol,quoteSymbol:q.symbol,reason:'Symbol mismatch'})
   return
  }
  const exit=p.direction==='long'?q.bid:q.ask
  const stop=new Decimal(p.hardStop)
  const hit=p.direction==='long'?new Decimal(exit).lte(stop):new Decimal(exit).gte(stop)
  const unrealized=this.pnlFor(p,exit)
  const markedEquity=new Decimal(this.state.balance).plus(unrealized)
  this.simRisk.recordEquity(markedEquity.toString())
  logSimulator({event:'POSITION_MARK',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,hardStop:p.hardStop,unrealizedPL:unrealized.toString(),markedEquity:markedEquity.toString(),riskLocked:this.simRisk.locked()})
  if(hit)this.closePosition(exit,'HARD_STOP')
 }

 private closePosition(exit:string,reason:string){
  const p=this.state.position
  if(!p)return
  const pnl=this.pnlFor(p,exit)
  this.state.balance=new Decimal(this.state.balance).plus(pnl).toString()
  this.state.realizedPL=new Decimal(this.state.realizedPL).plus(pnl).toString()
  this.state.position=null
  this.state.lastAction={at:new Date().toISOString(),type:'PAPER_CLOSE',symbol:p.symbol,direction:p.direction,exit,reason,pnl:pnl.toString(),balance:this.state.balance}
  this.recordStrategyResult('STRICT_4_OF_4',pnl)
  this.simRisk.recordEquity(this.state.balance)
  this.save()
  logTrade({event:'PAPER_CLOSE',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),balance:this.state.balance,reason,openedAt:p.openedAt})
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

  // Shadow-only profit protection. STRICT strategy remains untouched.
  // 1) At +$25 open P/L, move the stop to break-even.
  // 2) Once peak open P/L reaches +$50, trail 50% of the best profit reached.
  const priorPeak=p.peakExit?new Decimal(p.peakExit):exitDec
  const betterPeak=p.direction==='long'?exitDec.gt(priorPeak):exitDec.lt(priorPeak)
  if(!p.peakExit||betterPeak)p.peakExit=exitDec.toString()

  const peakExit=new Decimal(p.peakExit)
  const peakPnl=(p.direction==='long'?peakExit.minus(entry):entry.minus(peakExit)).mul(units)
  const currentPnl=this.pnlFor(p,exit)

  if(currentPnl.gte(25)&&!p.profitLockActive){
   const oldStop=p.hardStop
   p.hardStop=entry.toString()
   p.profitLockActive=true
   this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_BREAK_EVEN_ARMED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,unrealizedPL:currentPnl.toString()}
   logShadowTrade({event:'SHADOW_BREAK_EVEN_ARMED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,unrealizedPL:currentPnl.toString()})
  }

  if(peakPnl.gte(50)){
   const protectedPnl=peakPnl.mul(0.5)
   const distance=protectedPnl.div(units)
   const trailingStop=p.direction==='long'?entry.plus(distance):entry.minus(distance)
   const currentStop=new Decimal(p.hardStop)
   const improves=p.direction==='long'?trailingStop.gt(currentStop):trailingStop.lt(currentStop)
   if(improves){
    const oldStop=p.hardStop
    p.hardStop=trailingStop.toString()
    p.trailingActive=true
    this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_TRAIL_RAISED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,peakUnrealizedPL:peakPnl.toString(),protectedPL:protectedPnl.toString()}
    logShadowTrade({event:'SHADOW_TRAIL_RAISED',symbol:p.symbol,direction:p.direction,oldStop,newStop:p.hardStop,peakUnrealizedPL:peakPnl.toString(),protectedPL:protectedPnl.toString()})
   }
  }

  const stop=new Decimal(p.hardStop)
  const hit=p.direction==='long'?exitDec.lte(stop):exitDec.gte(stop)
  const unrealized=currentPnl
  const markedEquity=new Decimal(this.state.shadowExperiment.balance).plus(unrealized)
  this.shadowRisk.recordEquity(markedEquity.toString())
  logShadowTrade({event:'SHADOW_POSITION_MARK',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,hardStop:p.hardStop,unrealizedPL:unrealized.toString(),peakUnrealizedPL:peakPnl.toString(),profitLockActive:!!p.profitLockActive,trailingActive:!!p.trailingActive,markedEquity:markedEquity.toString(),riskLocked:this.shadowRisk.locked()})
  if(hit)this.closeShadowPosition(exit,p.trailingActive?'TRAILING_PROFIT':p.profitLockActive?'BREAK_EVEN_PROTECT':'HARD_STOP')
 }

 private closeShadowPosition(exit:string,reason:string){
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
  this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_PAPER_CLOSE',symbol:p.symbol,direction:p.direction,exit,reason,pnl:pnl.toString(),balance:nextBalance.toString()}
  this.recordStrategyResult('SHADOW_3_OF_4',pnl)
  this.shadowRisk.recordEquity(nextBalance.toString())
  this.save()
  logShadowTrade({event:'SHADOW_PAPER_CLOSE',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),balance:nextBalance.toString(),reason,openedAt:p.openedAt})
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
  this.state.shadowExperiment.position={symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,openedAt:new Date().toISOString(),reasons,...margin}
  this.state.shadowExperiment.opens++
  this.state.shadowExperiment.lastAction={at:new Date().toISOString(),type:'SHADOW_PAPER_OPEN',symbol,direction,entry:fill,hardStop:plan.hardStop,units:plan.units,riskCash:plan.riskCash,...margin,candidate}
  this.shadowRisk.recordEquity(this.state.shadowExperiment.balance)
  this.save()
  logShadowTrade({event:'SHADOW_PAPER_OPEN',symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,riskCash:plan.riskCash,...margin,candidate,simulatedOnly:true})
 }

 private async captureFimatheMarket(symbol:string){
  const now=new Date()
  const minute=now.getUTCMinutes()
  const hour=now.getUTCHours()
  const due:Array<'M1'|'M5'|'M15'|'D'|'W'>=['M1']
  if(minute%5<=1)due.push('M5')
  if(minute%15<=1)due.push('M15')
  if(minute===0)due.push('D')
  if(minute===0&&hour%6===0)due.push('W')

  for(const timeframe of due){
   try{
    const candles=await this.broker.candles(symbol,timeframe,4)
    const key=`${symbol}:${timeframe}`
    const lastSeen=this.state.fimatheLastCandle[key]||''
    const unseen=candles.filter((c:{time:string})=>c.time>lastSeen)
    for(const candle of unseen){
     logFimatheMarket({
      event:'FIMATHE_RAW_CANDLE',
      symbol,
      timeframe,
      candle,
      framework:{
       status:'SHADOW_RESEARCH',
       automatedEntry:false,
       sourceSupportedConcepts:['zona neutra','canal de referencia','linha de 50%','nivel 1','nivel 2','stop fora da caixinha'],
       note:'Raw OHLCV is preserved so finalized Fimathe rules can be replayed later without inventing missing channel math.'
      }
     })
     this.state.fimatheLastCandle[key]=candle.time
    }
   }catch(e){
    logFimatheMarket({event:'FIMATHE_CAPTURE_ERROR',symbol,timeframe,error:e instanceof Error?e.message:String(e)})
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
  if(!last)return
  if(this.state.lastCandle[symbol]===last.time)return

  this.state.lastCandle[symbol]=last.time
  const context=strategyContext(m5,m10)
  const signal=evaluate(context)
  const candidate=analyzeCandidate(context)
  this.state.decisions++
  this.state.lastDecision={at:new Date().toISOString(),symbol,candleTime:last.time,signal,context,quote:q}
  if(signal.decision!=='WAIT'){
   this.state.signals++
   this.state.lastSignal={at:new Date().toISOString(),symbol,candleTime:last.time,signal,context,quote:q}
  }
  if(signal.decision==='WAIT'&&candidate.side){
   const shadow={at:new Date().toISOString(),event:'SHADOW_CANDIDATE',symbol,candleTime:last.time,side:candidate.side,matched:candidate.matched,total:candidate.total,missing:candidate.missing,matchedConditions:candidate.matchedConditions,context,quote:q,simulatedOnly:true,executed:false}
   this.state.shadowCandidates++
   this.state.lastShadowCandidate=shadow
   logShadowCandidate(shadow)
   logSimulator(shadow)

   const currentShadow=this.state.shadowExperiment.position
   if(currentShadow&&currentShadow.symbol===symbol){
    const opposite=(currentShadow.direction==='long'&&candidate.side==='SHORT')||(currentShadow.direction==='short'&&candidate.side==='LONG')
    if(opposite){
     if(q.symbol!==currentShadow.symbol){
      logShadowTrade({event:'SHADOW_QUOTE_REJECTED',positionSymbol:currentShadow.symbol,quoteSymbol:q.symbol,reason:'Symbol mismatch on opposite candidate'})
     }else{
      const exit=currentShadow.direction==='long'?q.bid:q.ask
      this.closeShadowPosition(exit,'OPPOSITE_3_OF_4')
     }
    }
   }
   await this.maybeOpenShadow(symbol,candidate,q)
  }

  const spreadPct=this.simRisk.spreadPct(q.bid,q.ask).toString()
  const baseEvent={
   event:'CANDLE_DECISION',
   symbol,
   candleTime:last.time,
   quote:q,
   indicators:context,
   signal,
   candidate,
   spreadPct,
   simulatedBalance:this.state.balance,
   riskLocked:this.simRisk.locked(),
   fimathe:{
    automation:false,
    status:'OBSERVATION_ONLY',
    knownConcepts:['zona neutra','canal de referencia','linha de 50%','stop fora da caixinha'],
    note:'Exact channel construction is not automated until the source rules are sufficiently deterministic.'
   }
  }
  logSimulator(baseEvent)

  const current=this.state.position
  if(current&&current.symbol===symbol&&signal.decision!=='WAIT'){
   const opposite=(current.direction==='long'&&signal.decision==='SHORT')||(current.direction==='short'&&signal.decision==='LONG')
   if(opposite){
    const exit=current.direction==='long'?q.bid:q.ask
    this.closePosition(exit,'OPPOSITE_SIGNAL')
   }
  }

  if(this.state.position||signal.decision==='WAIT'||this.simRisk.locked())return

  // Exact USD P/L sizing is currently enabled only for USD-quoted majors.
  if(!['EUR_USD','GBP_USD'].includes(symbol)){
   logSimulator({event:'SIGNAL_SKIPPED',symbol,reason:'Cross-currency P/L conversion not yet enabled',signal})
   return
  }

  const direction:Direction=signal.decision==='LONG'?'long':'short'
  const fill=direction==='long'?q.ask:q.bid
  const plan=this.simRisk.plan(symbol,direction,fill,this.state.balance,signal.reasons)
  const account=await this.broker.account()
  const margin=await this.broker.marginMetrics(symbol,fill,plan.units,account.marginAvailable)
  const ai=await critique({mode:'SIMULATOR',symbol,signal,plan,margin,context}).catch(()=>({decision:'NEUTRAL',reason:'Ollama unavailable'})) as any
  logSimulator({event:'SIGNAL_REVIEW',symbol,signal,plan,ai})
  if(String(ai?.decision||'').toUpperCase()==='VETO'){
   logSimulator({event:'SIGNAL_SKIPPED',symbol,reason:'OLLAMA_VETO',ai})
   return
  }

  this.state.position={symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,openedAt:new Date().toISOString(),reasons:plan.reasons,...margin}
  this.state.lastAction={at:new Date().toISOString(),type:'PAPER_OPEN',symbol,direction,entry:fill,hardStop:plan.hardStop,units:plan.units,riskCash:plan.riskCash,...margin,reasons:plan.reasons,ai}
  this.simRisk.recordEquity(this.state.balance)
  this.save()
  logTrade({event:'PAPER_OPEN',symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,riskCash:plan.riskCash,...margin,reasons:plan.reasons,ai})
 }

 async tick(){
  if(this.busy)return
  this.busy=true
  try{
   if(Date.now()>=new Date(env.SIMULATOR_END_AT).getTime()){this.stop();return}
   await this.ensureBalance()
   await this.manageOpen()
   await this.manageShadowOpen()
   for(const symbol of SIMULATOR_PAIRS){
    try{await this.captureFimatheMarket(symbol);await this.processSymbol(symbol)}
    catch(e){logSimulator({event:'SYMBOL_ERROR',symbol,error:e instanceof Error?e.message:String(e)})}
   }
   this.save()
  }catch(e){
   logSimulator({event:'SIMULATOR_ERROR',error:e instanceof Error?e.message:String(e)})
  }finally{this.busy=false}
 }
}
