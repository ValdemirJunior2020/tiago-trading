import express from'express'
import cors from'cors'
import helmet from'helmet'
import{OandaReadOnly}from'./broker/OandaReadOnly.js'
import{RiskManager}from'./risk/RiskManager.js'
import{ollamaHealth,critique}from'./ollama.js'
import{env,BROKER_MODE,SIMULATOR_ENABLED,OANDA_DEMO_MIRROR_ENABLED}from'./config.js'
import{ResearchSimulator}from'./simulator/ResearchSimulator.js'

const app=express(),broker=new OandaReadOnly(),risk=new RiskManager(),simulator=new ResearchSimulator(broker)

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
 simulator.start()
})
