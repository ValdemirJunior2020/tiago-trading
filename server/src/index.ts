import express from'express'
import cors from'cors'
import helmet from'helmet'
import{OandaReadOnly}from'./broker/OandaReadOnly.js'
import{RiskManager}from'./risk/RiskManager.js'
import{ollamaHealth,critique}from'./ollama.js'
import{env,BROKER_MODE,SIMULATOR_ENABLED,OANDA_DEMO_MIRROR_ENABLED}from'./config.js'
import{ResearchSimulator}from'./simulator/ResearchSimulator.js'
import{HistorySync}from'./simulator/HistorySync.js'

const app=express(),broker=new OandaReadOnly(),risk=new RiskManager(),simulator=new ResearchSimulator(broker),history=new HistorySync()

app.use(helmet())
app.use(cors({origin:env.CLIENT_ORIGIN}))
app.use(express.json({limit:'32kb'}))

app.get('/health',async(_q,res)=>{
  const [ollama,account]=await Promise.all([
    ollamaHealth(),
    broker.account().then(()=>true).catch(()=>false)
  ])

  res.json({
    status:account?'ok':'degraded',
    broker:account,
    ollama,
    safety:{hardStop:'0.8%',maxSlippage:'0.1%',kill24h:'3.0%',riskPerTrade:'0.25%',drawdownPersistence:true},
    mode:OANDA_DEMO_MIRROR_ENABLED?'OANDA_PRACTICE_MIRROR':'READ_ONLY_TRADE_PLANNER',
    brokerMode:BROKER_MODE,
    demoMirror:{enabled:OANDA_DEMO_MIRROR_ENABLED,strategy:'SHADOW_3_OF_4',practiceOnly:true},
    simulator:{enabled:SIMULATOR_ENABLED,state:simulator.snapshot()}
  })
})

app.get('/api/account',async(_q,res)=>{
  try{
    const a=await broker.account()
    risk.recordEquity(a.equity)
    res.json({...a,drawdown24h:risk.drawdown24h().toString(),locked:risk.locked()})
  }catch(e){
    res.status(503).json({error:e instanceof Error?e.message:String(e)})
  }
})

app.get('/api/positions',async(_q,res)=>{
  try{res.json(await broker.positions())}
  catch(e){res.status(503).json({error:e instanceof Error?e.message:String(e)})}
})

// Broker numbers only; local Shadow state is used solely to flag divergence.
app.get('/api/oanda-audit',async(_q,res)=>{
 try{
  const brokerState=await broker.authoritativeSnapshot()
  const simState:any=simulator.snapshot()
  const shadow=simState?.shadowExperiment?.position
  const id=shadow?.brokerMirrorTradeId?String(shadow.brokerMirrorTradeId):null
  const brokerTrade=id?brokerState.openTrades.find((t:any)=>String(t.id)===id):null
  const issues:string[]=[]
  if(OANDA_DEMO_MIRROR_ENABLED){
   if(shadow&&!id)issues.push('SHADOW_OPEN_WITHOUT_OANDA_TRADE_ID')
   if(id&&!brokerTrade)issues.push('SHADOW_MIRROR_TRADE_NOT_OPEN_AT_OANDA')
   if(!shadow&&brokerState.openTrades.length>0)issues.push('OANDA_HAS_OPEN_TRADES_WITHOUT_SHADOW_POSITION')
   if(shadow&&brokerTrade){
    if(String(brokerTrade.instrument)!==String(shadow.symbol))issues.push('INSTRUMENT_MISMATCH')
    const brokerUnits=Number(brokerTrade.currentUnits)
    const localUnits=Number(shadow.units)*(shadow.direction==='short'?-1:1)
    if(!Number.isFinite(brokerUnits)||brokerUnits!==localUnits)issues.push('DIRECTION_OR_UNITS_MISMATCH')
    const stop=Number(brokerTrade.stopLossOrder?.price)
    if(!Number.isFinite(stop))issues.push('BROKER_STOP_UNAVAILABLE')
    else if(Math.abs(stop-Number(shadow.hardStop))>0.000011)issues.push('STOP_MISMATCH')
   }
   if(simState?.shadowExperiment?.pendingMirrorCloseTradeId)issues.push('PENDING_BROKER_CLOSE')
  }
  res.json({...brokerState,mirrorEnabled:OANDA_DEMO_MIRROR_ENABLED,
   mirrorTradeId:id,mirrorTrade:brokerTrade||null,
   syncStatus:!OANDA_DEMO_MIRROR_ENABLED?'MIRROR_DISABLED':issues.length?'MISMATCH':'MATCHED',
   issues})
 }catch(e){res.status(503).json({source:'OANDA_API',syncStatus:'UNAVAILABLE',error:e instanceof Error?e.message:String(e)})}
})

app.get('/api/quote/:symbol',async(req,res)=>{
  try{res.json(await broker.quote(req.params.symbol))}
  catch(e){res.status(503).json({error:e instanceof Error?e.message:String(e)})}
})

app.post('/api/plan',async(req,res)=>{
  try{
    const a=await broker.account()
    const q=await broker.quote(req.body.symbol)
    const direction=req.body.direction==='short'?'short':'long'
    const price=direction==='long'?q.ask:q.bid
    const plan=risk.plan(req.body.symbol,direction,price,a.equity,req.body.reasons||[])
    const margin=await broker.marginMetrics(req.body.symbol,price,plan.units,a.marginAvailable)
    const ai=await critique({plan,margin,quote:q}).catch(()=>({decision:'NEUTRAL',reason:'Ollama unavailable'}))
    res.json({plan:{...plan,...margin},ai,manualExecutionRequired:true})
  }catch(e){
    res.status(400).json({error:e instanceof Error?e.message:String(e)})
  }
})

app.get('/api/simulator',(_q,res)=>res.json({enabled:SIMULATOR_ENABLED,state:simulator.snapshot()}))

// Read-only consolidated audit history; never submits or changes trades.
app.get('/api/log-history',(_q,res)=>res.json(history.getSummary()))

app.post('/api/validate-fill',(req,res)=>{
  try{
    const direction=req.body.direction==='short'?'short':'long'
    res.json(risk.validateFill(String(req.body.referencePrice),String(req.body.fillPrice),direction))
  }catch(e){
    res.status(400).json({error:e instanceof Error?e.message:String(e)})
  }
})

app.listen(env.PORT,'127.0.0.1',()=>{
 console.log(`ProfitMind Forex http://127.0.0.1:${env.PORT}`)
 history.start()
 simulator.start()
})
