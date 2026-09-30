import{Decimal}from'decimal.js'
import{existsSync,mkdirSync,readFileSync,renameSync,writeFileSync}from'node:fs'
import{dirname,resolve}from'node:path'
import{fileURLToPath}from'node:url'
import type{Direction,TradePlan}from'@profitmind/shared'
import{LIMITS}from'../config.js'

type EquityPoint={t:number;e:string}
const here=dirname(fileURLToPath(import.meta.url))
const DEFAULT_STORE=resolve(here,'../../../data/risk-equity.json')

export class RiskManager{
 private eq:{t:number;e:Decimal}[]=[]
 constructor(private storePath:string|null=DEFAULT_STORE){this.load()}

 private load(){
  if(!this.storePath||!existsSync(this.storePath))return
  try{
   const raw=JSON.parse(readFileSync(this.storePath,'utf8')) as EquityPoint[]
   const cutoff=Date.now()-86400000
   this.eq=raw.filter(x=>Number.isFinite(x.t)&&x.t>=cutoff).map(x=>({t:x.t,e:new Decimal(x.e)}))
  }catch{this.eq=[]}
 }

 private persist(){
  if(!this.storePath)return
  mkdirSync(dirname(this.storePath),{recursive:true})
  const tmp=`${this.storePath}.tmp`
  writeFileSync(tmp,JSON.stringify(this.eq.map(x=>({t:x.t,e:x.e.toString()})),null,2),'utf8')
  renameSync(tmp,this.storePath)
 }

 hardStop(fill:string,d:Direction){
  const f=new Decimal(fill)
  return(d==='long'?f.mul(new Decimal(1).minus(LIMITS.hardStop)):f.mul(new Decimal(1).plus(LIMITS.hardStop))).toString()
 }

 spreadPct(bid:string,ask:string){
  const b=new Decimal(bid),a=new Decimal(ask)
  return a.minus(b).div(a.plus(b).div(2))
 }

 slippagePct(reference:string,fill:string){
  const r=new Decimal(reference),f=new Decimal(fill)
  if(r.lte(0))throw new Error('Reference price must be greater than zero')
  return f.minus(r).abs().div(r)
 }

 validateFill(reference:string,fill:string,direction:Direction){
  const slippage=this.slippagePct(reference,fill)
  if(slippage.gt(LIMITS.maxSlippage))throw new Error(`Slippage ${slippage.mul(100).toFixed(4)}% exceeds 0.1% hard ceiling`)
  return{fill,hardStop:this.hardStop(fill,direction),slippagePct:slippage.toString()}
 }

 recordEquity(equity:string,t=Date.now()){
  this.eq.push({t,e:new Decimal(equity)})
  this.eq=this.eq.filter(x=>x.t>=t-86400000).sort((a,b)=>a.t-b.t)
  this.persist()
 }

 drawdown24h(){
  if(!this.eq.length)return new Decimal(0)
  const cur=this.eq.at(-1)!.e,peak=Decimal.max(...this.eq.map(x=>x.e))
  return peak.eq(0)?new Decimal(0):Decimal.max(0,peak.minus(cur).div(peak))
 }

 locked(){return this.drawdown24h().gte(LIMITS.kill24h)}

 plan(symbol:string,direction:Direction,price:string,equity:string,reasons:string[]):TradePlan{
  if(this.locked())throw new Error('24h drawdown kill switch active')
  const stop=this.hardStop(price,direction)
  const riskCash=new Decimal(equity).mul(LIMITS.riskPerTrade)
  const distance=new Decimal(price).minus(stop).abs()
  if(distance.lte(0)||riskCash.lte(0))return{symbol,direction,referencePrice:price,hardStop:stop,riskCash:riskCash.toString(),units:'0',reasons:[...reasons,'No capital/risk budget available']}
  const units=riskCash.div(distance).floor()
  return{symbol,direction,referencePrice:price,hardStop:stop,riskCash:riskCash.toString(),units:Decimal.max(0,units).toString(),reasons}
 }
}
