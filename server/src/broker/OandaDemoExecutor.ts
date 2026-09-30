import{Decimal}from'decimal.js'
import type{Direction,TradePlan}from'@profitmind/shared'
import{BROKER_MODE,env,LIMITS}from'../config.js'
import{RiskManager}from'../risk/RiskManager.js'

type DemoExecution={
  symbol:string
  direction:Direction
  units:string
  referencePrice:string
  fillPrice:string
  hardStop:string
  slippagePct:string
  tradeId:string
  orderId:string
}

export class OandaDemoExecutor{
  constructor(private risk:RiskManager){}

  private assertDemo(){
    if(BROKER_MODE!=='DEMO')throw new Error('LIVE trading is hard-blocked. Demo execution requires OANDA fxpractice.')
    if(!env.OANDA_REST_BASE_URL.includes('api-fxpractice.oanda.com'))throw new Error('Demo execution requires the official OANDA practice endpoint.')
  }

  private headers(){
    if(!env.OANDA_API_TOKEN||!env.OANDA_ACCOUNT_ID)throw new Error('Broker credentials not configured')
    return{Authorization:`Bearer ${env.OANDA_API_TOKEN}`,'Content-Type':'application/json'}
  }

  private async request(method:string,path:string,body?:unknown){
    this.assertDemo()
    const r=await fetch(`${env.OANDA_REST_BASE_URL}${path}`,{
      method,
      headers:this.headers(),
      body:body===undefined?undefined:JSON.stringify(body)
    })
    const b:any=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(`OANDA demo HTTP ${r.status}: ${b?.errorMessage||b?.errorCode||'request failed'}`)
    return b
  }

  async market(plan:TradePlan):Promise<DemoExecution>{
    this.assertDemo()
    if(!['EUR_USD','GBP_USD'].includes(plan.symbol))throw new Error('Demo execution currently allows EUR_USD and GBP_USD only until cross-currency risk conversion is implemented.')
    if(this.risk.locked())throw new Error('24h drawdown kill switch active')

    const unitsAbs=new Decimal(plan.units)
    if(!unitsAbs.isFinite()||unitsAbs.lte(0))throw new Error('Planned units must be greater than zero')

    const ref=new Decimal(plan.referencePrice)
    const signedUnits=plan.direction==='long'?unitsAbs:unitsAbs.negated()
    const stopDistance=ref.mul(LIMITS.hardStop)
    const priceBound=plan.direction==='long'
      ?ref.mul(new Decimal(1).plus(LIMITS.maxSlippage))
      :ref.mul(new Decimal(1).minus(LIMITS.maxSlippage))

    const created=await this.request('POST',`/v3/accounts/${env.OANDA_ACCOUNT_ID}/orders`,{
      order:{
        type:'MARKET',
        instrument:plan.symbol,
        units:signedUnits.toFixed(0),
        timeInForce:'FOK',
        positionFill:'DEFAULT',
        priceBound:priceBound.toFixed(plan.symbol==='USD_JPY'?3:5),
        stopLossOnFill:{
          timeInForce:'GTC',
          distance:stopDistance.toFixed(plan.symbol==='USD_JPY'?3:5)
        }
      }
    })

    const fill=created.orderFillTransaction
    if(!fill?.price)throw new Error('OANDA demo order was not filled')
    const tradeId=String(fill.tradeOpened?.tradeID||fill.tradeReduced?.tradeID||'')
    if(!tradeId)throw new Error('Filled order did not open a trade')

    const validated=this.risk.validateFill(plan.referencePrice,String(fill.price),plan.direction)

    await this.request('PUT',`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,{
      stopLoss:{
        timeInForce:'GTC',
        price:new Decimal(validated.hardStop).toFixed(plan.symbol==='USD_JPY'?3:5)
      }
    })

    return{
      symbol:plan.symbol,
      direction:plan.direction,
      units:unitsAbs.toFixed(0),
      referencePrice:plan.referencePrice,
      fillPrice:String(fill.price),
      hardStop:new Decimal(validated.hardStop).toFixed(plan.symbol==='USD_JPY'?3:5),
      slippagePct:validated.slippagePct,
      tradeId,
      orderId:String(fill.orderID||created.orderCreateTransaction?.id||'')
    }
  }

  async closeTrade(tradeId:string){
    this.assertDemo()
    if(!/^\d+$/.test(tradeId))throw new Error('Invalid trade id')
    return this.request('PUT',`/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`,{units:'ALL'})
  }
}
