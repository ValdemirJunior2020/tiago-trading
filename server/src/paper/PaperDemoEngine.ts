import{Decimal}from'decimal.js'
import{existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,appendFileSync}from'node:fs'
import{dirname,resolve}from'node:path'
import{fileURLToPath}from'node:url'
import type{Direction,TradePlan}from'@profitmind/shared'

type PaperPosition={
 id:string
 symbol:string
 direction:Direction
 units:string
 entryPrice:string
 hardStop:string
 openedAt:string
}

type PaperState={
 balance:string
 realizedPL:string
 position:PaperPosition|null
}

const here=dirname(fileURLToPath(import.meta.url))
const STATE_PATH=resolve(here,'../../../data/paper-state.json')
const JOURNAL_PATH=resolve(here,'../../../data/paper-journal.jsonl')

export class PaperDemoEngine{
 private state:PaperState={balance:'0',realizedPL:'0',position:null}

 constructor(){this.load()}

 private load(){
  if(!existsSync(STATE_PATH))return
  try{this.state=JSON.parse(readFileSync(STATE_PATH,'utf8')) as PaperState}catch{}
 }

 private save(){
  mkdirSync(dirname(STATE_PATH),{recursive:true})
  const tmp=STATE_PATH+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,STATE_PATH)
 }

 private journal(event:unknown){
  mkdirSync(dirname(JOURNAL_PATH),{recursive:true})
  appendFileSync(JOURNAL_PATH,JSON.stringify({at:new Date().toISOString(),...event as object})+'\n','utf8')
 }

 syncBalanceIfEmpty(balance:string){
  if(new Decimal(this.state.balance||0).eq(0)&&!this.state.position){
   this.state.balance=new Decimal(balance).toString()
   this.save()
  }
 }

 getState(){return this.state}

 open(plan:TradePlan){
  if(this.state.position)throw new Error('Paper demo already has one open position')
  if(!['EUR_USD','GBP_USD'].includes(plan.symbol))throw new Error('Paper demo currently allows EUR_USD and GBP_USD only')
  const units=new Decimal(plan.units)
  if(!units.isFinite()||units.lte(0))throw new Error('Invalid planned units')
  const pos:PaperPosition={
   id:String(Date.now()),
   symbol:plan.symbol,
   direction:plan.direction,
   units:units.toFixed(0),
   entryPrice:plan.referencePrice,
   hardStop:plan.hardStop,
   openedAt:new Date().toISOString()
  }
  this.state.position=pos
  this.save()
  this.journal({event:'OPEN',position:pos,riskCash:plan.riskCash,reasons:plan.reasons})
  return pos
 }

 mark(bid:string,ask:string){
  const p=this.state.position
  if(!p)return{closed:false,state:this.state}
  const exit=p.direction==='long'?new Decimal(bid):new Decimal(ask)
  const stop=new Decimal(p.hardStop)
  const hit=p.direction==='long'?exit.lte(stop):exit.gte(stop)
  if(!hit)return{closed:false,state:this.state,unrealizedPL:this.unrealized(exit.toString())}
  return{closed:true,reason:'HARD_STOP',...this.close(exit.toString(),'HARD_STOP')}
 }

 unrealized(exitPrice:string){
  const p=this.state.position
  if(!p)return'0'
  const units=new Decimal(p.units),entry=new Decimal(p.entryPrice),exit=new Decimal(exitPrice)
  return(p.direction==='long'?exit.minus(entry):entry.minus(exit)).mul(units).toString()
 }

 close(exitPrice:string,reason='MANUAL'){
  const p=this.state.position
  if(!p)throw new Error('No paper demo position is open')
  const pl=new Decimal(this.unrealized(exitPrice))
  this.state.balance=new Decimal(this.state.balance).plus(pl).toString()
  this.state.realizedPL=new Decimal(this.state.realizedPL).plus(pl).toString()
  this.state.position=null
  this.save()
  const result={position:p,exitPrice,pl:pl.toString(),balance:this.state.balance,reason}
  this.journal({event:'CLOSE',...result})
  return result
 }
}
