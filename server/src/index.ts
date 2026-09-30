import express from'express'
import cors from'cors'
import helmet from'helmet'
import{OandaReadOnly}from'./broker/OandaReadOnly.js'
import{RiskManager}from'./risk/RiskManager.js'
import{ollamaHealth,critique}from'./ollama.js'
import{env}from'./config.js'

const app=express(),broker=new OandaReadOnly(),risk=new RiskManager()

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
    mode:'READ_ONLY_TRADE_PLANNER'
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
    const ai=await critique({plan,quote:q}).catch(()=>({decision:'NEUTRAL',reason:'Ollama unavailable'}))
    res.json({plan,ai,manualExecutionRequired:true})
  }catch(e){
    res.status(400).json({error:e instanceof Error?e.message:String(e)})
  }
})

app.post('/api/validate-fill',(req,res)=>{
  try{
    const direction=req.body.direction==='short'?'short':'long'
    res.json(risk.validateFill(String(req.body.referencePrice),String(req.body.fillPrice),direction))
  }catch(e){
    res.status(400).json({error:e instanceof Error?e.message:String(e)})
  }
})

app.listen(env.PORT,'127.0.0.1',()=>console.log(`ProfitMind Forex http://127.0.0.1:${env.PORT}`))
