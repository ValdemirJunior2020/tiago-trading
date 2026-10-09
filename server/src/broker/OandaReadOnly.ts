import{Decimal}from'decimal.js'
import type{AccountState,BrokerQuote}from'../types.js'
import{env}from'../config.js'
export class OandaReadOnly{
 private headers(){if(!env.OANDA_API_TOKEN||!env.OANDA_ACCOUNT_ID)throw new Error('Broker credentials not configured');return{Authorization:`Bearer ${env.OANDA_API_TOKEN}`}}
 private assertPracticeWrite(){
  if(!env.OANDA_REST_BASE_URL.includes('api-fxpractice.oanda.com'))
   throw new Error('Demo order blocked: OANDA practice endpoint is required')
 }
 private async write(path:string,method:'POST'|'PUT',body:unknown){
  this.assertPracticeWrite()
  const r=await fetch(`${env.OANDA_REST_BASE_URL}${path}`,{
   method,
   headers:{...this.headers(),'Content-Type':'application/json'},
   body:JSON.stringify(body)
  })
  const b:any=await r.json().catch(()=>({}))
  if(!r.ok){
   const detail=b?.errorMessage||b?.errorCode||`Broker HTTP ${r.status}`
   throw new Error(String(detail))
  }
  return b
 }
 private async get(path:string){
  const retryable=new Set([503,504])
  const maxAttempts=4
  let lastError:unknown=null
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   try{
    const r=await fetch(`${env.OANDA_REST_BASE_URL}${path}`,{headers:this.headers()})
    const b:any=await r.json().catch(()=>({}))
    if(r.ok)return b
    if(!retryable.has(r.status)||attempt===maxAttempts)throw new Error(`Broker HTTP ${r.status}`)
    lastError=new Error(`Broker HTTP ${r.status}`)
   }catch(e){
    lastError=e
    const msg=e instanceof Error?e.message:String(e)
    const transientFetchFailure=msg==='fetch failed'||msg.includes('ECONNRESET')||msg.includes('ETIMEDOUT')
    if((!transientFetchFailure&&!msg.includes('Broker HTTP 503')&&!msg.includes('Broker HTTP 504'))||attempt===maxAttempts)throw e
   }
   await new Promise(resolve=>setTimeout(resolve,500*Math.pow(2,attempt-1)))
  }
  throw lastError instanceof Error?lastError:new Error('Broker request failed')
 }
 async account():Promise<AccountState>{const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`),a=b.account,bal=new Decimal(a.balance);return{balance:bal.toString(),equity:bal.plus(a.unrealizedPL||0).toString(),marginUsed:String(a.marginUsed||'0'),marginAvailable:String(a.marginAvailable||'0')}}
 async quote(symbol:string):Promise<BrokerQuote>{const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(symbol)}`),p=b.prices?.[0];if(!p)throw new Error('Quote unavailable');const bid=new Decimal(p.bids?.[0]?.price),ask=new Decimal(p.asks?.[0]?.price);return{symbol,bid:bid.toString(),ask:ask.toString(),mid:bid.plus(ask).div(2).toString(),timestamp:String(p.time)}}
 async positions(){const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`);return b.trades||[]}
 async trade(tradeId:string){const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${encodeURIComponent(tradeId)}`);return b.trade||null}
 async pricePrecision(symbol:string){
  const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/instruments?instruments=${encodeURIComponent(symbol)}`)
  const i=b.instruments?.[0]
  const p=Number(i?.displayPrecision)
  if(!Number.isInteger(p)||p<0||p>10)throw new Error('Instrument display precision unavailable')
  return p
 }
 async formatPrice(symbol:string,price:string){
  const precision=await this.pricePrecision(symbol)
  return new Decimal(price).toFixed(precision)
 }
 async marginRate(symbol:string){
  const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/instruments?instruments=${encodeURIComponent(symbol)}`)
  const i=b.instruments?.[0]
  if(!i?.marginRate)throw new Error('Margin rate unavailable')
  return String(i.marginRate)
 }
 async marginMetrics(symbol:string,price:string,units:string,marginAvailable:string){
  const u=new Decimal(units).abs(),p=new Decimal(price),available=new Decimal(marginAvailable)
  const rate=new Decimal(await this.marginRate(symbol))
  let notionalUsd:Decimal
  if(symbol.endsWith('_USD'))notionalUsd=u.mul(p)
  else if(symbol.startsWith('USD_'))notionalUsd=u
  else throw new Error('USD margin conversion is not implemented for this cross pair')
  const required=notionalUsd.mul(rate)
  return{
   marginRequired:required.toFixed(2),
   marginAvailable:available.toFixed(2),
   marginAfterTrade:Decimal.max(0,available.minus(required)).toFixed(2),
   effectiveLeverage:rate.gt(0)?new Decimal(1).div(rate).toDecimalPlaces(2).toString():'0',
   lotSize:u.div(100000).toDecimalPlaces(5).toString(),
   marginRate:rate.toString(),
   notionalUsd:notionalUsd.toFixed(2)
  }
 }
 async openPracticeTrade(symbol:string,direction:'long'|'short',units:string,hardStop:string){
  const qty=new Decimal(units).abs()
  if(qty.lte(0))throw new Error('Demo order blocked: units must be positive')
  const signedUnits=(direction==='long'?qty:qty.neg()).toFixed(0)
  const normalizedStop=await this.formatPrice(symbol,hardStop)
  const b=await this.write(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/orders`,'POST',{
   order:{
    type:'MARKET',
    instrument:symbol,
    units:signedUnits,
    timeInForce:'FOK',
    positionFill:'OPEN_ONLY',
    stopLossOnFill:{price:normalizedStop,timeInForce:'GTC'}
   }
  })
  const fill=b?.orderFillTransaction
  const tradeId=fill?.tradeOpened?.tradeID||fill?.tradesOpened?.[0]?.tradeID
  if(!tradeId)throw new Error('Demo order was not confirmed as an opened trade')
  return{
   tradeId:String(tradeId),
   fillPrice:String(fill?.price||''),
   stopPrice:normalizedStop,
   transactionId:String(fill?.id||b?.lastTransactionID||'')
  }
 }
 async updatePracticeStopLoss(tradeId:string,symbol:string,price:string){
  const normalizedStop=await this.formatPrice(symbol,price)
  const b=await this.write(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${encodeURIComponent(tradeId)}/orders`,'PUT',{
   stopLoss:{price:normalizedStop,timeInForce:'GTC'}
  })
  return{tradeId,price:normalizedStop,lastTransactionID:String(b?.lastTransactionID||'')}
 }
 async closePracticeTrade(tradeId:string){
  const b=await this.write(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${encodeURIComponent(tradeId)}/close`,'PUT',{units:'ALL'})
  const fill=b?.orderFillTransaction
  return{
   tradeId,
   fillPrice:String(fill?.price||''),
   realizedPL:String(fill?.pl||fill?.tradesClosed?.[0]?.realizedPL||'0'),
   transactionId:String(fill?.id||b?.lastTransactionID||'')
  }
 }

 // Broker-authoritative, read-only snapshot. Never substitutes simulated P/L.
 async authoritativeSnapshot(){
  const [summary,trades]=await Promise.all([
   this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`),
   this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`)
  ])
  const a=summary.account
  if(!a)throw new Error('OANDA account summary unavailable')
  return{
   source:'OANDA_API' as const,
   retrievedAt:new Date().toISOString(),
   accountId:String(a.id||env.OANDA_ACCOUNT_ID),
   balance:String(a.balance),
   equity:new Decimal(a.balance).plus(a.unrealizedPL||0).toString(),
   unrealizedPL:String(a.unrealizedPL||'0'),
   accountRealizedPL:String(a.pl||'0'),
   marginUsed:String(a.marginUsed||'0'),
   marginAvailable:String(a.marginAvailable||'0'),
   openTrades:Array.isArray(trades.trades)?trades.trades:[]
  }
 }
 // Confirmed closed-trade data comes only from OANDA, never from local paper P/L.
 async closedTrades(count=100){
  const limit=Math.max(1,Math.min(250,Math.floor(count)))
  const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades?state=CLOSED&count=${limit}`)
  if(!Array.isArray(b.trades))throw new Error('OANDA closed trades payload unavailable')
  return b.trades as Array<{id:string;instrument:string;state:string;initialUnits:string;openTime:string;closeTime:string;realizedPL:string}>
 }
 // Completed midpoint candles ending no later than the broker-confirmed entry time.
 async candlesBefore(symbol:string,granularity:'M5'|'M10',before:string,count=40){
  if(!/^[A-Z]{3}_[A-Z]{3}$/.test(symbol))throw new Error('Invalid historical instrument')
  const ts=Date.parse(before)
  if(!Number.isFinite(ts)||ts>Date.now()+60000)throw new Error('Invalid historical candle time')
  const n=Math.max(25,Math.min(100,Math.floor(count)))
  const path=`/v3/instruments/${symbol}/candles?price=M&granularity=${granularity}&count=${n}&to=${encodeURIComponent(new Date(ts).toISOString())}`
  const b=await this.get(path)
  if(!Array.isArray(b.candles))throw new Error('OANDA historical candles unavailable')
  return b.candles.filter((c:any)=>c.complete&&c.mid&&Date.parse(String(c.time))<ts).map((c:any)=>({
   time:String(c.time),open:Number(c.mid.o),high:Number(c.mid.h),low:Number(c.mid.l),close:Number(c.mid.c),volume:Number(c.volume||0)
  }))
 }
 async candles(symbol:string,granularity:'M1'|'M5'|'M10'|'M15'|'D'|'W',count=60){
  const b=await this.get(`/v3/instruments/${encodeURIComponent(symbol)}/candles?price=M&granularity=${granularity}&count=${count}`)
  return (b.candles||[]).filter((c:any)=>c.complete&&c.mid).map((c:any)=>({
   time:String(c.time),open:Number(c.mid.o),high:Number(c.mid.h),low:Number(c.mid.l),close:Number(c.mid.c),volume:Number(c.volume||0)
  }))
 }
}
