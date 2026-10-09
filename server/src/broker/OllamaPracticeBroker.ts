import {Decimal} from 'decimal.js'
import {createHash} from 'node:crypto'
import {env} from '../config.js'
import {OandaReadOnly} from './OandaReadOnly.js'

export const OLLAMA_TRADE_TAG='TIAGO_OLLAMA'
export type TaggedTrade={id:string;instrument:string;state:string;currentUnits:string;initialUnits?:string;realizedPL?:string;price?:string;stopLossOrder?:{price?:string};clientExtensions?:{id?:string;tag?:string}}
export type OpenSpec={symbol:'EUR_USD'|'GBP_USD';direction:'long'|'short';units:string;hardStop:string;clientId:string;referencePrice:string}
const practice='https://api-fxpractice.oanda.com'
function requirePractice(){
 if(env.OANDA_REST_BASE_URL.replace(/\/$/,'')!==practice)throw Error('OLLAMA_PRACTICE_ONLY: live or nonstandard broker URL refused')
 if(!env.OANDA_ACCOUNT_ID||!env.OANDA_API_TOKEN)throw Error('OANDA Practice credentials missing')
}
export function ollamaClientId(paperKey:string,symbol:string){
 return 'TGOLL_'+createHash('sha256').update(symbol+':'+paperKey).digest('hex').slice(0,24)
}
export function isTagged(t:TaggedTrade,clientId?:string){
 return t.clientExtensions?.tag===OLLAMA_TRADE_TAG&&(!clientId||t.clientExtensions?.id===clientId)
}
export class OllamaPracticeBroker{
 constructor(private readonly readOnly:Pick<OandaReadOnly,'positions'|'trade'|'account'|'quote'|'formatPrice'|'marginMetrics'>=new OandaReadOnly()){}
 private async request(path:string,method:'GET'|'POST'|'PUT'='GET',body?:unknown){
  requirePractice()
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000)
  try{
   const r=await fetch(practice+path,{
    method,signal:controller.signal,
    headers:{Authorization:`Bearer ${env.OANDA_API_TOKEN}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
   })
   const b:any=await r.json().catch(()=>({}))
   if(!r.ok)throw Error('OANDA HTTP '+r.status+': '+String(b.errorMessage||b.errorCode||'request rejected').slice(0,250))
   return b
  }finally{clearTimeout(timer)}
 }
 async accountSafety(){
  const b=await this.request(`/v3/accounts/${encodeURIComponent(env.OANDA_ACCOUNT_ID)}/summary`)
  if(!b.account)throw Error('Broker account summary unavailable')
  if(b.account.mt4AccountID)throw Error('MT4-associated account: trade tags unsupported')
  return{marginAvailable:String(b.account.marginAvailable||'0'),
   hedgingEnabled:b.account.hedgingEnabled===true,
   accountId:String(b.account.id||'')}
 }
 async quote(symbol:string){return this.readOnly.quote(symbol)}
 async openTrades():Promise<TaggedTrade[]>{return this.readOnly.positions()}
 async trade(id:string):Promise<TaggedTrade|null>{return this.readOnly.trade(id)}
 async findTagged(clientId:string):Promise<TaggedTrade[]>{
  // Find both open and recently closed trades following an ambiguous POST.
  // Do not resend if we cannot establish whether a request filled.
  const b=await this.request(`/v3/accounts/${encodeURIComponent(env.OANDA_ACCOUNT_ID)}/trades?state=ALL&count=250`)
  if(!Array.isArray(b.trades))throw Error('OANDA trade reconciliation unavailable')
  return b.trades.filter((t:TaggedTrade)=>isTagged(t,clientId))
 }
 async validateOpen(spec:OpenSpec,shadowSymbol:string|null){
  requirePractice()
  if(!['EUR_USD','GBP_USD'].includes(spec.symbol))throw Error('Ollama mirror only supports USD-quoted EUR/GBP majors')
  if(!/^[A-Za-z0-9_-]{5,100}$/.test(spec.clientId))throw Error('Invalid Ollama ownership ID')
  if(shadowSymbol===spec.symbol)throw Error('SHADOW_PRIORITY: Shadow currently owns this instrument')
  const units=new Decimal(spec.units),stop=new Decimal(spec.hardStop)
  if(!units.isInteger()||units.lte(0))throw Error('Invalid Ollama units')
  const account=await this.accountSafety()
  const open=await this.openTrades()
  // OPEN_ONLY alone does not prove that opposing trades can coexist on every account.
  if(open.some(t=>t.instrument===spec.symbol))throw Error('INSTRUMENT_OCCUPIED: existing account trade on '+spec.symbol)
  if(open.some(t=>isTagged(t)))throw Error('OLLAMA_TRADE_ALREADY_OPEN')
  const q=await this.quote(spec.symbol)
  const price=new Decimal(spec.direction==='long'?q.ask:q.bid)
  if(q.symbol!==spec.symbol||!Number.isFinite(Date.parse(q.timestamp))||Date.now()-Date.parse(q.timestamp)>60000||
     Date.parse(q.timestamp)-Date.now()>10000)throw Error('STALE_OR_INVALID_OANDA_PRICE')
  const spread=new Decimal(q.ask).minus(q.bid).div('0.0001')
  if(spread.lte(0)||spread.gt(3))throw Error('SPREAD_TOO_WIDE_FOR_OLLAMA')
  const dist=spec.direction==='long'?price.minus(stop):stop.minus(price)
  if(dist.lte(0)||dist.div(price).gt('0.008'))throw Error('OLLAMA_STOP_INVALID_OR_TOO_WIDE')
  // Fixed isolated $1,000 lab budget: max $2.50 initial stop risk and 10x notional.
  const risk=dist.mul(units)
  if(risk.gt('2.5')||units.mul(price).gt('10000'))throw Error('OLLAMA_PRACTICE_BUDGET_EXCEEDED')
  const margin=await this.readOnly.marginMetrics(spec.symbol,price.toString(),spec.units,account.marginAvailable)
  if(new Decimal(account.marginAvailable).lt(new Decimal(margin.marginRequired).mul(1.5)))throw Error('INSUFFICIENT_SHARED_MARGIN_BUFFER')
  const reference=new Decimal(spec.referencePrice)
  if(reference.lte(0)||price.minus(reference).abs().div(reference).gt('0.001'))throw Error('QUOTE_MOVED_BEYOND_SLIPPAGE_LIMIT')
  return{price:price.toString(),stop:await this.readOnly.formatPrice(spec.symbol,stop.toString()),riskCash:risk.toString()}
 }
 async open(spec:OpenSpec){
  requirePractice()
  const normalizedStop=await this.readOnly.formatPrice(spec.symbol,spec.hardStop)
  const quantity=new Decimal(spec.units).abs()
  const sign=spec.direction==='long'?quantity:quantity.neg()
  const ref=new Decimal(spec.referencePrice),limit=ref.mul('0.001')
  const priceBound=spec.direction==='long'?ref.plus(limit):ref.minus(limit)
  const b=await this.request(`/v3/accounts/${encodeURIComponent(env.OANDA_ACCOUNT_ID)}/orders`,'POST',{
   order:{type:'MARKET',instrument:spec.symbol,units:sign.toFixed(0),timeInForce:'FOK',positionFill:'OPEN_ONLY',
    priceBound:await this.readOnly.formatPrice(spec.symbol,priceBound.toString()),
    stopLossOnFill:{price:normalizedStop,timeInForce:'GTC'},
    clientExtensions:{id:spec.clientId+'_order',tag:OLLAMA_TRADE_TAG,comment:'Tiago independent Ollama Practice only'},
    tradeClientExtensions:{id:spec.clientId,tag:OLLAMA_TRADE_TAG,comment:'Tiago Ollama AI Lab isolated mirror'}
   }
  })
  const fill=b.orderFillTransaction
  const id=fill?.tradeOpened?.tradeID||fill?.tradesOpened?.[0]?.tradeID
  if(!id)throw Error('OANDA order returned no confirmed trade-open ID')
  return{tradeId:String(id),fillPrice:String(fill.price||''),transactionId:String(fill.id||'')}
 }
 private async owned(tradeId:string,clientId:string){
  requirePractice()
  if(!/^\d+$/.test(tradeId))throw Error('Invalid broker trade ID')
  const trade=await this.trade(tradeId)
  if(!trade||!isTagged(trade,clientId))throw Error('OWNERSHIP_MISMATCH: broker trade not tagged to this Ollama intent')
  return trade
 }
 async syncStop(tradeId:string,clientId:string,symbol:string,stop:string){
  const t=await this.owned(tradeId,clientId)
  if(t.state!=='OPEN'||t.instrument!==symbol)throw Error('Tagged trade not open for requested instrument')
  const price=await this.readOnly.formatPrice(symbol,stop)
  const b=await this.request(`/v3/accounts/${encodeURIComponent(env.OANDA_ACCOUNT_ID)}/trades/${tradeId}/orders`,'PUT',{
   stopLoss:{price,timeInForce:'GTC'}
  })
  return{transactionId:String(b.lastTransactionID||''),price}
 }
 async close(tradeId:string,clientId:string,symbol:string){
  const t=await this.owned(tradeId,clientId)
  if(t.state==='CLOSED')return{tradeId,realizedPL:String(t.realizedPL||'0'),alreadyClosed:true}
  if(t.state!=='OPEN'||t.instrument!==symbol)throw Error('Tagged trade not open for requested instrument')
  const b=await this.request(`/v3/accounts/${encodeURIComponent(env.OANDA_ACCOUNT_ID)}/trades/${tradeId}/close`,'PUT',{units:'ALL'})
  const fill=b.orderFillTransaction
  if(!fill)throw Error('OANDA did not confirm trade closure')
  return{tradeId,realizedPL:String(fill.pl??fill.tradesClosed?.[0]?.realizedPL??'0'),alreadyClosed:false}
 }
}
