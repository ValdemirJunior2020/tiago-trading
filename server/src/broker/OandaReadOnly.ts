import Decimal from'decimal.js'
import type{AccountState,BrokerQuote}from'@profitmind/shared'
import{env}from'../config.js'
export class OandaReadOnly{
 private headers(){if(!env.OANDA_API_TOKEN||!env.OANDA_ACCOUNT_ID)throw new Error('Broker credentials not configured');return{Authorization:`Bearer ${env.OANDA_API_TOKEN}`}}
 private async get(path:string){const r=await fetch(`${env.OANDA_REST_BASE_URL}${path}`,{headers:this.headers()});const b:any=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`Broker HTTP ${r.status}`);return b}
 async account():Promise<AccountState>{const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`),a=b.account,bal=new Decimal(a.balance);return{balance:bal.toString(),equity:bal.plus(a.unrealizedPL||0).toString(),marginUsed:String(a.marginUsed||'0'),marginAvailable:String(a.marginAvailable||'0')}}
 async quote(symbol:string):Promise<BrokerQuote>{const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(symbol)}`),p=b.prices?.[0];if(!p)throw new Error('Quote unavailable');const bid=new Decimal(p.bids?.[0]?.price),ask=new Decimal(p.asks?.[0]?.price);return{symbol,bid:bid.toString(),ask:ask.toString(),mid:bid.plus(ask).div(2).toString(),timestamp:String(p.time)}}
 async positions(){const b=await this.get(`/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`);return b.trades||[]}
}
