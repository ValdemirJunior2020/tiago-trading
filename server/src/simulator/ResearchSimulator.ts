import{Decimal}from'decimal.js'
import{existsSync,mkdirSync,readFileSync,renameSync,writeFileSync}from'node:fs'
import{resolve,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{OandaReadOnly}from'../broker/OandaReadOnly.js'
import{strategyContext}from'../indicators.js'
import{evaluate}from'../strategy.js'
import{RiskManager}from'../risk/RiskManager.js'
import{critique}from'../ollama.js'
import{env,SIMULATOR_ENABLED,SIMULATOR_PAIRS}from'../config.js'
import{logSimulator,logTrade}from'./logger.js'
import type{Direction}from'@profitmind/shared'

type Position={
 symbol:string
 direction:Direction
 units:string
 entry:string
 hardStop:string
 openedAt:string
 reasons:string[]
}

type State={
 balance:string
 realizedPL:string
 lastCandle:Record<string,string>
 position:Position|null
 startedAt:string
 decisions:number
 signals:number
}

const here=dirname(fileURLToPath(import.meta.url))
const STATE_PATH=resolve(here,'../../../data/simulator-state.json')
const RISK_PATH=resolve(here,'../../../data/simulator-risk.json')

export class ResearchSimulator{
 private state:State={balance:'0',realizedPL:'0',lastCandle:{},position:null,startedAt:new Date().toISOString(),decisions:0,signals:0}
 private timer:NodeJS.Timeout|null=null
 private busy=false
 private simRisk=new RiskManager(RISK_PATH)

 constructor(private broker:OandaReadOnly){this.load()}

 private load(){
  if(!existsSync(STATE_PATH))return
  try{this.state={...this.state,...JSON.parse(readFileSync(STATE_PATH,'utf8'))}}catch{}
 }

 private save(){
  mkdirSync(dirname(STATE_PATH),{recursive:true})
  const tmp=STATE_PATH+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,STATE_PATH)
 }

 private async ensureBalance(){
  if(new Decimal(this.state.balance||0).gt(0))return
  const a=await this.broker.account()
  this.state.balance=a.equity
  this.simRisk.recordEquity(a.equity)
  this.save()
 }

 start(){
  if(!SIMULATOR_ENABLED)return
  if(Date.now()>=new Date(env.SIMULATOR_END_AT).getTime())return
  logSimulator({event:'SIMULATOR_START',endAt:env.SIMULATOR_END_AT,pairs:SIMULATOR_PAIRS})
  void this.tick()
  this.timer=setInterval(()=>void this.tick(),Math.max(10000,env.SIMULATOR_POLL_MS))
 }

 stop(){
  if(this.timer)clearInterval(this.timer)
  this.timer=null
  logSimulator({event:'SIMULATOR_STOP'})
 }

 snapshot(){return this.state}

 private pnlFor(p:Position,exit:string){
  const e=new Decimal(exit),entry=new Decimal(p.entry),units=new Decimal(p.units)
  return(p.direction==='long'?e.minus(entry):entry.minus(e)).mul(units)
 }

 private async manageOpen(){
  const p=this.state.position
  if(!p)return
  const q=await this.broker.quote(p.symbol)
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
  this.simRisk.recordEquity(this.state.balance)
  this.save()
  logTrade({event:'PAPER_CLOSE',symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),balance:this.state.balance,reason,openedAt:p.openedAt})
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
  this.state.decisions++
  if(signal.decision!=='WAIT')this.state.signals++

  const spreadPct=this.simRisk.spreadPct(q.bid,q.ask).toString()
  const baseEvent={
   event:'CANDLE_DECISION',
   symbol,
   candleTime:last.time,
   quote:q,
   indicators:context,
   signal,
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
  const ai=await critique({mode:'SIMULATOR',symbol,signal,plan,context}).catch(()=>({decision:'NEUTRAL',reason:'Ollama unavailable'})) as any
  logSimulator({event:'SIGNAL_REVIEW',symbol,signal,plan,ai})
  if(String(ai?.decision||'').toUpperCase()==='VETO'){
   logSimulator({event:'SIGNAL_SKIPPED',symbol,reason:'OLLAMA_VETO',ai})
   return
  }

  this.state.position={symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,openedAt:new Date().toISOString(),reasons:plan.reasons}
  this.simRisk.recordEquity(this.state.balance)
  this.save()
  logTrade({event:'PAPER_OPEN',symbol,direction,units:plan.units,entry:fill,hardStop:plan.hardStop,riskCash:plan.riskCash,reasons:plan.reasons,ai})
 }

 async tick(){
  if(this.busy)return
  this.busy=true
  try{
   if(Date.now()>=new Date(env.SIMULATOR_END_AT).getTime()){this.stop();return}
   await this.ensureBalance()
   await this.manageOpen()
   for(const symbol of SIMULATOR_PAIRS){
    try{await this.processSymbol(symbol)}
    catch(e){logSimulator({event:'SYMBOL_ERROR',symbol,error:e instanceof Error?e.message:String(e)})}
   }
   this.save()
  }catch(e){
   logSimulator({event:'SIMULATOR_ERROR',error:e instanceof Error?e.message:String(e)})
  }finally{this.busy=false}
 }
}
