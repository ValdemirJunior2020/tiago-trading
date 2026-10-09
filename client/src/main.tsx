import React,{useEffect,useMemo,useState}from'react'
import{createRoot}from'react-dom/client'
import{
  Activity,BrainCircuit,ChartNoAxesCombined,ChevronRight,CircleDollarSign,
  Gauge,Globe2,LayoutDashboard,LineChart,RefreshCw,ShieldCheck,
  Sparkles,Target,WalletCards,Wifi,WifiOff
}from'lucide-react'
import'./styles.css'

type Lang='en'|'pt'
type Quote={symbol:string;bid:string;ask:string;mid:string;timestamp:string}

const copy={
  en:{
    subtitle:'Local AI forex intelligence • broker risk control',
    overview:'Overview',market:'Market',positions:'Positions',risk:'Risk Engine',ai:'AI Desk',
    balance:'Balance',equity:'Equity',margin:'Available Margin',open:'Open Positions',
    system:'System Status',broker:'Broker',ollama:'Ollama',riskState:'Risk Guard',
    protected:'Protected',offline:'Offline',online:'Online',locked:'Locked',
    watch:'Live Market Watch',watchSub:'Read-only broker quotes refresh automatically',
    security:'Capital Protection',securitySub:'Deterministic limits the AI cannot loosen',
    hardStop:'Hard Stop',slippage:'Max Slippage',kill:'24h Drawdown Kill',
    exposure:'Per-trade risk',manual:'Manual execution required',
    openTitle:'Open Positions',none:'No open positions right now.',
    noData:'Waiting for broker data',updated:'Auto refresh every 5 seconds',
    assistant:'Tiago AI Desk',assistantSub:'Local Ollama trade critic and market context',
    waiting:'Waiting for Ollama',safe:'Risk rules remain active without AI.',
    profit:'Profit mindset',profitSub:'Protect downside. Measure edge. Compound only what works.'
  },
  pt:{
    subtitle:'Inteligência Forex com IA local • controle de risco da corretora',
    overview:'Visão geral',market:'Mercado',positions:'Posições',risk:'Motor de Risco',ai:'Mesa de IA',
    balance:'Saldo',equity:'Patrimônio',margin:'Margem Disponível',open:'Posições Abertas',
    system:'Status do Sistema',broker:'Corretora',ollama:'Ollama',riskState:'Proteção de Risco',
    protected:'Protegido',offline:'Offline',online:'Online',locked:'Bloqueado',
    watch:'Radar do Mercado',watchSub:'Cotações read-only da corretora atualizadas automaticamente',
    security:'Proteção de Capital',securitySub:'Limites determinísticos que a IA não pode afrouxar',
    hardStop:'Hard Stop',slippage:'Slippage Máximo',kill:'Drawdown 24h',
    exposure:'Risco por trade',manual:'Execução manual obrigatória',
    openTitle:'Posições Abertas',none:'Nenhuma posição aberta agora.',
    noData:'Aguardando dados da corretora',updated:'Atualiza automaticamente a cada 5 segundos',
    assistant:'Mesa de IA do Tiago',assistantSub:'Ollama local como crítico de trades e contexto de mercado',
    waiting:'Aguardando Ollama',safe:'As regras de risco continuam ativas sem IA.',
    profit:'Mentalidade de lucro',profitSub:'Proteja o downside. Meça a vantagem. Só escale o que funciona.'
  }
}

const PAIRS=['EUR_USD','GBP_USD','USD_JPY']

function App(){
  const[lang,setLang]=useState<Lang>('pt')
  const[health,setHealth]=useState<any>(null)
  const[account,setAccount]=useState<any>(null)
  const[positions,setPositions]=useState<any[]>([])
  const[quotes,setQuotes]=useState<Record<string,Quote>>({})
  const[loading,setLoading]=useState(false)
  const[sim,setSim]=useState<any>(null)
  const[notify,setNotify]=useState(false)
  const[activityIndex,setActivityIndex]=useState(0)
  const x=copy[lang]

  const load=async()=>{
    setLoading(true)
    try{
      const[h,a,p,sm,...qs]=await Promise.all([
        fetch('http://127.0.0.1:8790/health').then(r=>r.json()).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/account').then(r=>r.ok?r.json():null).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/positions').then(r=>r.ok?r.json():[]).catch(()=>[]),
        fetch('http://127.0.0.1:8790/api/simulator').then(r=>r.ok?r.json():null).catch(()=>null),
        ...PAIRS.map(pair=>fetch(`http://127.0.0.1:8790/api/quote/${pair}`).then(r=>r.ok?r.json():null).catch(()=>null))
      ])
      setHealth(h);setAccount(a);setPositions(Array.isArray(p)?p:[]);setSim(sm?.state||null)
      const next:Record<string,Quote>={}
      qs.forEach((q:any)=>{if(q?.symbol)next[q.symbol]=q})
      setQuotes(next)
    }finally{setLoading(false)}
  }

  useEffect(()=>{load();const id=setInterval(load,5000);return()=>clearInterval(id)},[])
  useEffect(()=>{const id=setInterval(()=>setActivityIndex(v=>(v+1)%5),1800);return()=>clearInterval(id)},[])
  useEffect(()=>{
    if(!notify||!sim?.lastSignal||typeof Notification==='undefined'||Notification.permission!=='granted')return
    const key='tiago-last-notified-signal'
    const id=String(sim.lastSignal.at||'')
    if(!id||localStorage.getItem(key)===id)return
    localStorage.setItem(key,id)
    const d=sim.lastSignal
    new Notification(`Tiago ${d.signal?.decision||'SIGNAL'} • ${String(d.symbol||'').replace('_','/')}`,{
      body:(d.signal?.reasons||[]).join(' • ')||'Novo sinal do simulador'
    })
  },[sim?.lastSignal?.at,notify])

  const activityFeed=[
    lang==='pt'?'Lendo cotacoes da OANDA...':'Reading OANDA quotes...',
    lang==='pt'?'Calculando Bollinger, RSI e volume...':'Calculating Bollinger, RSI and volume...',
    lang==='pt'?'Comparando macro M10 com SMA20...':'Comparing M10 macro with SMA20...',
    lang==='pt'?'Verificando risco e drawdown...':'Checking risk and drawdown...',
    lang==='pt'?'Aguardando o proximo candle fechado...':'Waiting for the next closed candle...'
  ]

  const drawdown=useMemo(()=>{
    const n=Number(account?.drawdown24h||0)*100
    return Number.isFinite(n)?n:0
  },[account])

  const simProfit=useMemo(()=>{
    const realized=Number(sim?.realizedPL||0)
    const p=sim?.position
    let unrealized=0
    if(p){
      const q=quotes[p.symbol]
      const entry=Number(p.entry),units=Number(p.units)
      const exit=p.direction==='long'?Number(q?.bid):Number(q?.ask)
      if(Number.isFinite(entry)&&Number.isFinite(units)&&Number.isFinite(exit)){
        unrealized=(p.direction==='long'?exit-entry:entry-exit)*units
      }
    }
    const total=realized+unrealized
    const currentBalance=Number(sim?.balance||0)
    const initial=currentBalance-realized
    const roi=initial>0?(total/initial)*100:0
    return{realized,unrealized,total,roi}
  },[sim,quotes])

  const shadowProfit=useMemo(()=>{
    const sh=sim?.shadowExperiment
    const realized=Number(sh?.realizedPL||0)
    const p=sh?.position
    let unrealized=0
    if(p){
      const q=quotes[p.symbol]
      const entry=Number(p.entry),units=Number(p.units)
      const exit=p.direction==='long'?Number(q?.bid):Number(q?.ask)
      if(Number.isFinite(entry)&&Number.isFinite(units)&&Number.isFinite(exit)){
        unrealized=(p.direction==='long'?exit-entry:entry-exit)*units
      }
    }
    const total=realized+unrealized
    const currentBalance=Number(sh?.balance||0)
    const initial=currentBalance-realized
    const roi=initial>0?(total/initial)*100:0
    return{realized,unrealized,total,roi}
  },[sim,quotes])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-mini">
        <img src="/logo.png" alt="Tiago Bot" onError={e=>{e.currentTarget.style.display='none'}}/>
        <div><strong>Tiago Bot</strong><span>FOREX</span></div>
      </div>

      <nav>
        <Nav icon={<LayoutDashboard size={18}/>} label={x.overview} active/>
        <Nav icon={<ChartNoAxesCombined size={18}/>} label={x.market}/>
        <Nav icon={<Target size={18}/>} label={x.positions}/>
        <Nav icon={<ShieldCheck size={18}/>} label={x.risk}/>
        <Nav icon={<BrainCircuit size={18}/>} label={x.ai}/>
      </nav>

      <div className="sidebar-profit">
        <div className="sidebar-profit-head">
          <CircleDollarSign size={18}/>
          <div><small>{lang==='pt'?'LUCRO SIMULADO':'SIMULATED PROFIT'}</small><span>{sim?.shadowExperiment?.position?lang==='pt'?'posição shadow aberta':'shadow position open':lang==='pt'?'shadow paper trading':'shadow paper trading'}</span></div>
        </div>
        <strong className={shadowProfit.total>0?'profit-up':shadowProfit.total<0?'profit-down':''}>{signedMoney(shadowProfit.total)}</strong>
        <div className="profit-roi"><span>{lang==='pt'?'Retorno total':'Total return'}</span><b>{signedPct(shadowProfit.roi)}</b></div>
        <div className="profit-split">
          <div><small>{lang==='pt'?'REALIZADO':'REALIZED'}</small><b>{signedMoney(shadowProfit.realized)}</b></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small><b>{signedMoney(shadowProfit.unrealized)}</b></div>
        </div>
        {sim?.shadowExperiment?.position&&<>
          <div className="profit-position">
            <span className="pulse-dot"/>
            <div><small>{String(sim.shadowExperiment.position.symbol).replace('_','/')} • {String(sim.shadowExperiment.position.direction).toUpperCase()}</small><b>{lang==='pt'?'Entrada':'Entry'} {fmt(sim.shadowExperiment.position.entry)}</b></div>
          </div>
          <div className="margin-mini">
            <div><small>LOT SIZE</small><b>{sim.shadowExperiment.position.lotSize??'—'}</b></div>
            <div><small>{lang==='pt'?'MARGEM EXIGIDA':'MARGIN REQUIRED'}</small><b>{money(sim.shadowExperiment.position.marginRequired)}</b></div>
            <div><small>{lang==='pt'?'MARGEM DISPONÍVEL':'MARGIN AVAILABLE'}</small><b>{money(sim.shadowExperiment.position.marginAvailable)}</b></div>
            <div><small>{lang==='pt'?'MARGEM DEPOIS':'MARGIN AFTER'}</small><b>{money(sim.shadowExperiment.position.marginAfterTrade)}</b></div>
            <div><small>{lang==='pt'?'ALAVANCAGEM EFETIVA':'EFFECTIVE LEVERAGE'}</small><b>{sim.shadowExperiment.position.effectiveLeverage?sim.shadowExperiment.position.effectiveLeverage+':1':'—'}</b></div>
          </div>
        </>}
      </div>

      <div className="sidebar-bottom">
        <div className="mini-status"><span className={health?.broker?'dot on':'dot'}/><div><small>{x.broker}</small><b>{health?.broker?x.online:x.offline}</b></div></div>
        <div className="mini-status"><span className={health?.ollama?'dot on':'dot'}/><div><small>{x.ollama}</small><b>{health?.ollama?x.online:x.offline}</b></div></div>
      </div>
    </aside>

    <main className="content">
      <header className="topbar">
        <div className="hero-brand">
          <div className="logo-frame"><img src="/logo.png" alt="Tiago Bot Forex" onError={e=>{e.currentTarget.style.display='none'}}/></div>
          <div>
            <div className="eyebrow"><Sparkles size={14}/> PROFITMIND ENGINE</div>
            <h1>Tiago <span>Bot</span></h1>
            <p>{x.subtitle}</p>
          </div>
        </div>

        <div className="top-actions">
          <span style={{padding:'8px 12px',borderRadius:999,fontWeight:800,fontSize:12,letterSpacing:'.08em',border:'1px solid rgba(255,255,255,.12)',background:health?.brokerMode==='DEMO'?'rgba(250,204,21,.12)':'rgba(239,68,68,.12)',color:health?.brokerMode==='DEMO'?'#fde68a':'#fecaca'}}>{health?.brokerMode==='DEMO'?'🟡 DEMO • VIRTUAL MONEY':'🔴 LIVE • REAL MONEY'}</span>
          <button className="refresh" onClick={load} aria-label="Refresh"><RefreshCw size={17} className={loading?'spin':''}/></button>
          <button className="lang" onClick={()=>setLang(lang==='en'?'pt':'en')}><Globe2 size={16}/>{lang==='en'?'PT-BR':'EN'}</button>
        </div>
      </header>

      <section className="status-strip">
        <div><span className={health?.broker?'signal good':'signal bad'}>{health?.broker?<Wifi size={15}/>:<WifiOff size={15}/>}</span><small>{x.broker}</small><b>{health?.broker?x.online:x.offline}</b></div>
        <div><span className={health?.ollama?'signal good':'signal bad'}><BrainCircuit size={15}/></span><small>{x.ollama}</small><b>{health?.ollama?x.online:x.offline}</b></div>
        <div><span className={account?.locked?'signal bad':'signal good'}><ShieldCheck size={15}/></span><small>{x.riskState}</small><b>{account?.locked?x.locked:x.protected}</b></div>
        <div className="strip-note">{x.updated}</div>
      </section>

      <section className="metrics">
        <Metric icon={<WalletCards/>} label={x.balance} value={money(account?.balance)} meta="Broker balance"/>
        <Metric icon={<Activity/>} label={x.equity} value={money(account?.equity)} meta={`24h DD ${drawdown.toFixed(2)}%`}/>
        <Metric icon={<Gauge/>} label={x.margin} value={money(account?.marginAvailable)} meta="Real-time"/>
        <Metric icon={<Target/>} label={x.open} value={String(positions.length)} meta={health?.brokerMode==='DEMO'?'Demo account':'Live account'}/>
      </section>

      <section className="main-grid">
        <div className="panel market-panel">
          <div className="panel-head">
            <div><span className="kicker"><LineChart size={15}/>{x.market}</span><h2>{x.watch}</h2><p>{x.watchSub}</p></div>
            <span className="live-pill"><i/> LIVE</span>
          </div>
          <div className="quotes">
            {PAIRS.map(pair=>{
              const q=quotes[pair]
              const spread=q?Math.abs(Number(q.ask)-Number(q.bid)):null
              return <div className="quote-row" key={pair}>
                <div className="pair"><span>{pair.slice(0,3)}</span><i>/</i><span>{pair.slice(4)}</span></div>
                <div className="quote-price"><small>MID</small><strong>{q?fmt(q.mid):'—'}</strong></div>
                <div className="quote-side"><small>BID</small><b>{q?fmt(q.bid):'—'}</b></div>
                <div className="quote-side"><small>ASK</small><b>{q?fmt(q.ask):'—'}</b></div>
                <div className="spread"><small>SPREAD</small><b>{spread==null?'—':spread.toFixed(pair==='USD_JPY'?3:5)}</b></div>
              </div>
            })}
          </div>
        </div>

        <div className="panel ai-panel">
          <div className="orb"><BrainCircuit size={30}/></div>
          <span className="kicker">{x.ai}</span>
          <h2>{x.assistant}</h2>
          <p>{x.assistantSub}</p>
          <div className={health?.ollama?'ai-state online':'ai-state'}>
            <span className="pulse"/><div><small>{health?.ollama?x.online:x.waiting}</small><b>{health?.ollama?'LOCAL MODEL READY':'OLLAMA OFFLINE'}</b></div>
          </div>
          <div className="ai-note">{x.safe}</div>
        </div>
      </section>

      <section className="panel simulator-panel">
        <div className="tiago-live">
          <div className="tiago-live-left">
            <div className="scanner-orb"><BrainCircuit size={20}/><span className="scanner-ring"/></div>
            <div><small>{lang==='pt'?'TIAGO TRABALHANDO AGORA':'TIAGO WORKING NOW'}</small><b>{activityFeed[activityIndex]}</b></div>
          </div>
          <div className="work-bars" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/></div>
          <span className="heartbeat"><i/>{lang==='pt'?'ATIVO':'ACTIVE'}</span>
        </div>
        <div className="panel-head">
          <div><span className="kicker"><Activity size={15}/> SIMULADOR</span><h2>{lang==='pt'?'O que o Tiago está fazendo':'What Tiago is doing'}</h2><p>{lang==='pt'?'Você acompanha cada decisão e cada trade simulado aqui.':'Track every decision and simulated trade here.'}</p></div>
          <button className="lang" onClick={async()=>{
            if(typeof Notification==='undefined')return
            const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission()
            setNotify(permission==='granted')
          }}>{notify?'🔔 ON':'🔕 '+(lang==='pt'?'Avisos':'Alerts')}</button>
        </div>
        <div className="sim-grid">
          <div className="sim-card"><small>{lang==='pt'?'DECISÕES':'DECISIONS'}</small><strong>{sim?.decisions??0}</strong><span>{lang==='pt'?'candles avaliados':'candles evaluated'}</span></div>
          <div className="sim-card"><small>{lang==='pt'?'SINAIS':'SIGNALS'}</small><strong>{sim?.signals??0}</strong><span>{lang==='pt'?'LONG/SHORT estritos':'strict LONG/SHORT'}</span></div>
          <div className="sim-card"><small>{lang==='pt'?'SALDO SIMULADO':'SIM BALANCE'}</small><strong>{money(sim?.balance)}</strong><span>P/L: {money(sim?.realizedPL)}</span></div>
          <div className="sim-card"><small>{lang==='pt'?'POSIÇÃO':'POSITION'}</small><strong>{sim?.position?String(sim.position.direction).toUpperCase():'WAIT'}</strong><span>{sim?.position?String(sim.position.symbol).replace('_','/'):(lang==='pt'?'nenhuma aberta':'none open')}</span></div>
        </div>
        <div className="sim-detail">
          <div><small>{lang==='pt'?'ÚLTIMA DECISÃO':'LAST DECISION'}</small><b>{sim?.lastDecision?String(sim.lastDecision.symbol).replace('_','/')+' • '+String(sim.lastDecision.signal?.decision||'WAIT'):'—'}</b><span>{sim?.lastDecision?.signal?.reasons?.join(' • ')||'—'}</span></div>
          <div><small>{lang==='pt'?'ÚLTIMA AÇÃO':'LAST ACTION'}</small><b>{sim?.lastAction?.type||'—'}</b><span>{sim?.lastAction?JSON.stringify(sim.lastAction):lang==='pt'?'Nenhum trade simulado ainda':'No simulated trade yet'}</span></div>
          <div><small>{lang==='pt'?'CANDIDATOS 3/4':'3/4 CANDIDATES'}</small><b>{sim?.shadowCandidates??0}</b><span>{sim?.lastShadowCandidate?String(sim.lastShadowCandidate.symbol).replace('_','/')+' • '+String(sim.lastShadowCandidate.side)+' • '+(lang==='pt'?'faltou ':'missing ')+(sim.lastShadowCandidate.missing?.join(', ')||'—'):(lang==='pt'?'Nenhum candidato ainda':'No candidate yet')}</span></div>
        </div>
        <div className="risk-footer"><ShieldCheck size={16}/><span>{lang==='pt'?'O simulador escolhe os trades pela estratégia matemática; Ollama só pode vetar.':'The simulator chooses trades from the deterministic strategy; Ollama can only veto.'}</span><b>{lang==='pt'?'DEMO/PAPER':'DEMO/PAPER'}</b></div>
      </section>

      <section className="panel shadow-lab">
        <div className="panel-head">
          <div>
            <span className="kicker"><Target size={15}/> SHADOW 3/4</span>
            <h2>{lang==='pt'?'Laboratório de trades 3/4':'3/4 trade lab'}</h2>
            <p>{lang==='pt'?'Paper engine separado. Não altera a estratégia STRICT e não envia ordens reais.':'Separate paper engine. It does not change STRICT and never sends real orders.'}</p>
          </div>
          <span className="locked-pill">RESEARCH ONLY</span>
        </div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'SALDO SHADOW':'SHADOW BALANCE'}</small><strong>{money(sim?.shadowExperiment?.balance)}</strong></div>
          <div><small>{lang==='pt'?'P/L TOTAL':'TOTAL P/L'}</small><strong className={shadowProfit.total>0?'profit-up':shadowProfit.total<0?'profit-down':''}>{signedMoney(shadowProfit.total)}</strong></div>
          <div><small>{lang==='pt'?'REALIZADO':'REALIZED'}</small><strong>{signedMoney(shadowProfit.realized)}</strong></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small><strong>{signedMoney(shadowProfit.unrealized)}</strong></div>
          <div><small>{lang==='pt'?'ABERTOS':'OPENS'}</small><strong>{sim?.shadowExperiment?.opens??0}</strong></div>
          <div><small>{lang==='pt'?'FECHADOS':'CLOSES'}</small><strong>{sim?.shadowExperiment?.closes??0}</strong></div>
          <div><small>W / L</small><strong>{sim?.shadowExperiment?.wins??0} / {sim?.shadowExperiment?.losses??0}</strong></div>
          <div><small>ROI</small><strong>{signedPct(shadowProfit.roi)}</strong></div>
        </div>
        <div className="shadow-position">
          <small>{lang==='pt'?'POSIÇÃO SHADOW':'SHADOW POSITION'}</small>
          <b>{sim?.shadowExperiment?.position?String(sim.shadowExperiment.position.symbol).replace('_','/')+' • '+String(sim.shadowExperiment.position.direction).toUpperCase():(lang==='pt'?'Nenhuma aberta':'None open')}</b>
          <span>{sim?.shadowExperiment?.lastAction?JSON.stringify(sim.shadowExperiment.lastAction):(lang==='pt'?'Aguardando candidato 3/4':'Waiting for 3/4 candidate')}</span>
        </div>
      </section>

      <section className="panel performance-board">
        <div className="panel-head">
          <div>
            <span className="kicker"><ChartNoAxesCombined size={15}/> STRATEGY SCOREBOARD</span>
            <h2>{lang==='pt'?'Qual estratégia está fazendo dinheiro?':'Which strategy is making money?'}</h2>
            <p>{lang==='pt'?'Resultados separados. O novo NO MACRO + EARLY EXIT é um A/B test: após 3h, se nunca passou +0.10R e caiu a -0.25R, sai cedo. Não altera Strict, Shadow ou NO MACRO original.':'Separated results. The new NO MACRO + EARLY EXIT is an A/B test: after 3h, if it never reached +0.10R and falls to -0.25R, it exits early. It does not alter Strict, Shadow, or the original NO MACRO.'}</p>
          </div>
          <span className="live-pill"><i/> PAPER DATA</span>
        </div>
        <div className="strategy-score-grid">
          <StrategyPerformanceCard
            name="STRICT 4/4"
            status={lang==='pt'?'ATIVO • raro':'ACTIVE • selective'}
            stats={sim?.strategyPerformance?.STRICT_4_OF_4}
            lang={lang}
          />
          <StrategyPerformanceCard
            name="SHADOW 3/4"
            status={sim?.shadowExperiment?.position?(lang==='pt'?'ATIVO • trade aberto':'ACTIVE • trade open'):(lang==='pt'?'ATIVO':'ACTIVE')}
            stats={sim?.strategyPerformance?.SHADOW_3_OF_4}
            lang={lang}
          />
          <StrategyPerformanceCard
            name="NO MACRO 3/3"
            status={sim?.noMacroExperiment?.position?(lang==='pt'?'TESTE • trade aberto':'TEST • trade open'):(lang==='pt'?'TESTE NOVO • forward':'NEW TEST • forward')}
            stats={sim?.strategyPerformance?.NO_MACRO_3_OF_3}
            lang={lang}
            researchOnly
          />
          <StrategyPerformanceCard
            name="NO MACRO + EARLY EXIT"
            status={sim?.noMacroEarlyExitExperiment?.position?(lang==='pt'?'TESTE • trade aberto':'TEST • trade open'):(lang==='pt'?'TESTE • 3h fraco sai cedo':'TEST • weak 3h exits early')}
            stats={sim?.strategyPerformance?.NO_MACRO_EARLY_EXIT_3H}
            lang={lang}
            researchOnly
          />
          <StrategyPerformanceCard
            name="FIMATHE"
            status={sim?.fimathePaperExperiment?.position?(lang==='pt'?'PAPER • posição aberta':'PAPER • position open'):(lang==='pt'?'PAPER • PROXY EXPERIMENTAL':'PAPER • EXPERIMENTAL PROXY')}
            stats={sim?.strategyPerformance?.FIMATHE}
            lang={lang}
            researchOnly
          />
          <StrategyPerformanceCard
            name="OLLAMA AI LAB"
            status={sim?.ollamaPaperExperiment?.position?(lang==='pt'?'PAPER • posição aberta':'PAPER • position open'):(lang==='pt'?'IA INDEPENDENTE':'INDEPENDENT AI')}
            stats={sim?.strategyPerformance?.OLLAMA_AI_LAB}
            lang={lang}
            researchOnly
          />
        </div>
      </section>




      <section className="panel shadow-lab ollama-lab">
        <div className="panel-head"><div>
          <span className="kicker"><BrainCircuit size={15}/> SHADOW MEMORY • OLLAMA</span>
          <h2>{lang==='pt'?'Memória dos erros do Shadow':'Shadow loss memory'}</h2>
          <p>{lang==='pt'?'Ollama consulta operações fechadas do Shadow e registra alertas experimentais. Não altera nenhuma operação. OpenViking é opcional e roda localmente.':'Ollama consults completed Shadow results and logs experimental warnings. It never changes trades. OpenViking is optional and local.'}</p>
        </div><span className="locked-pill">OBSERVATION ONLY</span></div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'TRADES NA MEMÓRIA':'TRADES IN MEMORY'}</small><strong>{sim?.ollamaShadowMemory?.memory?.total??0}</strong></div>
          <div><small>{lang==='pt'?'PERDAS HISTÓRICAS':'PAST LOSSES'}</small><strong>{sim?.ollamaShadowMemory?.memory?.losses??0}</strong></div>
          <div><small>{lang==='pt'?'AVALIAÇÕES DA IA':'AI REVIEWS'}</small><strong>{sim?.ollamaShadowMemory?.decisions??0}</strong></div>
          <div><small>{lang==='pt'?'ALERTAS DE SIMILARIDADE':'SIMILARITY WARNINGS'}</small><strong>{sim?.ollamaShadowMemory?.warnings??0}</strong></div>
        </div>
        <div className="shadow-position">
          <small>OPENVIKING • {sim?.ollamaShadowMemory?.openViking??'OFFLINE'} | {lang==='pt'?'Falhas':'Errors'}: {sim?.ollamaShadowMemory?.errors??0}</small>
          <b>{sim?.ollamaShadowMemory?.lastDecision?(String(sim.ollamaShadowMemory.lastDecision.symbol).replace('_','/')+' • '+sim.ollamaShadowMemory.lastDecision.decision):(lang==='pt'?'Aguardando primeira análise com memória':'Waiting for first memory review')}</b>
          <span>{sim?.ollamaShadowMemory?.lastDecision?.reason??(lang==='pt'?'Os resultados antigos do Shadow serão consultados sem alterar os trades.':'Shadow history will be read without changing trades.')}</span>
        </div>
        <div className="ollama-lab-feed">
          <div className="ollama-lab-feed-title"><Activity size={15}/> {lang==='pt'?'HISTÓRICO DAS AVALIAÇÕES COM MEMÓRIA':'MEMORY REVIEW HISTORY'}</div>
          {(sim?.ollamaShadowMemory?.recent??[]).slice(0,6).map((e:any,i:number)=><div className="ollama-lab-event" key={e.at+String(i)}>
            <time>{new Date(e.at).toLocaleTimeString(lang==='pt'?'pt-BR':'en-US')}</time>
            <b>{e.decision} • {String(e.symbol).replace('_','/')}</b>
            <span>{e.compare==='SIMILAR_SHADOW_LOSS_EXISTS'?(lang==='pt'?'Atenção: perdas parecidas no histórico. ':'Similar Shadow loss. '):''}{e.reason}</span>
          </div>)}
        </div>
      </section>

      <section className="panel shadow-lab ollama-lab">
        <div className="panel-head">
          <div>
            <span className="kicker"><BrainCircuit size={15}/> OLLAMA AI LAB • V1</span>
            <h2>{lang==='pt'?'IA independente trabalhando':'Independent AI at work'}</h2>
            <p>{lang==='pt'?'Experimento separado com US$1.000 virtuais. Ollama decide LONG / SHORT / WAIT / CLOSE sobre candles fechados; as regras matemáticas limitam as operações. Nenhuma ordem na OANDA.':'Separate $1,000 virtual experiment. Ollama decides LONG / SHORT / WAIT / CLOSE from completed candles; mathematical guards limit trading. No OANDA orders.'}</p>
          </div>
          <span className="locked-pill">PAPER ONLY</span>
        </div>
        <div className="ollama-lab-status">
          <span className={health?.ollama?'pulse-dot':'offline-dot'}/>
          <b>{health?.ollama?(lang==='pt'?'Ollama conectado':'Ollama connected'):(lang==='pt'?'Ollama desconectado':'Ollama disconnected')}</b>
          <span>{lang==='pt'?'Motor:':'Engine:'} {sim?.ollamaPaperExperiment?.status??'WAITING'}</span>
          <span>{lang==='pt'?'Última análise:':'Last analysis:'} {sim?.ollamaPaperExperiment?.lastReviewedAt?new Date(sim.ollamaPaperExperiment.lastReviewedAt).toLocaleString(lang==='pt'?'pt-BR':'en-US'):(lang==='pt'?'aguardando':'waiting')}</span>
        </div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'SALDO VIRTUAL':'PAPER BALANCE'}</small><strong>{money(sim?.ollamaPaperExperiment?.balance)}</strong></div>
          <div><small>{lang==='pt'?'LUCRO REALIZADO':'REALIZED P/L'}</small><strong className={Number(sim?.ollamaPaperExperiment?.realizedPL)>0?'profit-up':Number(sim?.ollamaPaperExperiment?.realizedPL)<0?'profit-down':''}>{signedMoney(sim?.ollamaPaperExperiment?.realizedPL??0)}</strong></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small><strong>{signedMoney(sim?.ollamaPaperExperiment?.openPnl??0)}</strong></div>
          <div><small>{lang==='pt'?'PATRIMÔNIO VIRTUAL':'PAPER EQUITY'}</small><strong>{money(sim?.ollamaPaperExperiment?.equity)}</strong></div>
          <div><small>{lang==='pt'?'ANÁLISES REAIS':'MODEL REVIEWS'}</small><strong>{sim?.ollamaPaperExperiment?.decisions??0}</strong></div>
          <div><small>{lang==='pt'?'SINAIS':'SIGNALS'}</small><strong>{sim?.ollamaPaperExperiment?.signals??0}</strong></div>
          <div><small>{lang==='pt'?'ABERTAS / FECHADAS':'OPENED / CLOSED'}</small><strong>{sim?.ollamaPaperExperiment?.opens??0} / {sim?.ollamaPaperExperiment?.closes??0}</strong></div>
          <div><small>{lang==='pt'?'FALHAS REGISTRADAS':'RECORDED ERRORS'}</small><strong>{sim?.ollamaPaperExperiment?.errors??0}</strong></div>
        </div>
        <div className="shadow-position">
          <small>{lang==='pt'?'POSIÇÃO EXCLUSIVA DA IA':'AI-ONLY POSITION'}</small>
          <b>{sim?.ollamaPaperExperiment?.position?String(sim.ollamaPaperExperiment.position.symbol).replace('_','/')+' • '+String(sim.ollamaPaperExperiment.position.direction).toUpperCase():(lang==='pt'?'Nenhuma operação aberta':'No active trade')}</b>
          {sim?.ollamaPaperExperiment?.position
            ?<span>{lang==='pt'?'Entrada':'Entry'} {sim.ollamaPaperExperiment.position.entry} | Stop {sim.ollamaPaperExperiment.position.stop} | Target {sim.ollamaPaperExperiment.position.target} | Units {sim.ollamaPaperExperiment.position.units}</span>
            :<span>{lang==='pt'?'A IA só abre operação quando decide com confiança suficiente e passa nas regras de risco.':'AI opens only on sufficiently confident decisions passing risk rules.'}</span>}
        </div>
        <div className="ollama-lab-decision">
          <small>{lang==='pt'?'ÚLTIMA DECISÃO DA IA':'LATEST AI DECISION'}</small>
          <b>{sim?.ollamaPaperExperiment?.lastDecision?.decision??'WAITING'} {sim?.ollamaPaperExperiment?.lastDecision?.symbol?'• '+String(sim.ollamaPaperExperiment.lastDecision.symbol).replace('_','/'):''}</b>
          <span>{sim?.ollamaPaperExperiment?.lastDecision?.reason??(lang==='pt'?'Aguardando a primeira análise do Ollama.':'Awaiting first Ollama review.')}</span>
          <small>{sim?.ollamaPaperExperiment?.lastDecision?.confidence!=null?(lang==='pt'?'Confiança: ':'Confidence: ')+(Number(sim.ollamaPaperExperiment.lastDecision.confidence)*100).toFixed(0)+'%':''}</small>
        </div>
        <div className="ollama-lab-feed">
          <div className="ollama-lab-feed-title"><Activity size={15}/> {lang==='pt'?'ATIVIDADE REAL DA IA':'REAL AI ACTIVITY'} <small>{lang==='pt'?'Últimos eventos registrados':'Latest recorded events'}</small></div>
          {(sim?.ollamaPaperExperiment?.events??[]).slice(0,10).map((e:any,i:number)=>
            <div className="ollama-lab-event" key={String(e.at)+String(i)}>
              <time>{new Date(e.at).toLocaleTimeString(lang==='pt'?'pt-BR':'en-US')}</time>
              <b>{String(e.event||'').replace('OLLAMA_LAB_','').replaceAll('_',' ')}</b>
              <span>{e.symbol?String(e.symbol).replace('_','/')+' • ':''}{e.decision?e.decision+' • ':''}{e.reason||e.pnl||''}</span>
            </div>
          )}
          {!(sim?.ollamaPaperExperiment?.events?.length)&&<p>{lang==='pt'?'Ainda sem eventos. Os registros aparecerão quando o motor iniciar.':'No events yet. Activity will appear when the engine starts.'}</p>}
        </div>
      </section>

      <section className="panel shadow-lab">
        <div className="panel-head"><div>
          <span className="kicker"><Target size={15}/> FIMATHE PAPER • PROXY V1</span>
          <h2>{lang==='pt'?'Fimathe experimental independente':'Independent experimental Fimathe'}</h2>
          <p>{lang==='pt'?'Simulação isolada de US$1.000: canal dos 20 candles M1 fechados anteriores, direção do último diário fechado, stop estrutural e alvo experimental 2R. Ainda não representa a fórmula oficial Fimathe. Nunca envia ordens.':'Isolated $1,000 simulation: 20 prior closed M1 bars, last completed daily direction, structural stop and experimental 2R target. Not the official Fimathe method. Never submits orders.'}</p>
        </div><span className="locked-pill">PAPER ONLY</span></div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'SALDO':'BALANCE'}</small><strong>{money(sim?.fimathePaperExperiment?.balance)}</strong></div>
          <div><small>{lang==='pt'?'REALIZADO':'REALIZED'}</small><strong>{signedMoney(sim?.fimathePaperExperiment?.realizedPL??0)}</strong></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small><strong>{signedMoney(sim?.fimathePaperExperiment?.openPnl??0)}</strong></div>
          <div><small>{lang==='pt'?'DECISÕES':'DECISIONS'}</small><strong>{sim?.fimathePaperExperiment?.decisions??0}</strong></div>
          <div><small>{lang==='pt'?'SINAIS':'SIGNALS'}</small><strong>{sim?.fimathePaperExperiment?.signals??0}</strong></div>
          <div><small>{lang==='pt'?'ABERTOS / FECHADOS':'OPEN / CLOSED'}</small><strong>{sim?.fimathePaperExperiment?.opens??0} / {sim?.fimathePaperExperiment?.closes??0}</strong></div>
          <div><small>W / L</small><strong>{sim?.fimathePaperExperiment?.wins??0} / {sim?.fimathePaperExperiment?.losses??0}</strong></div>
          <div><small>VERSION</small><strong>{sim?.fimathePaperExperiment?.version??'—'}</strong></div>
        </div>
        <div className="shadow-position">
          <small>{lang==='pt'?'POSIÇÃO FIMATHE':'FIMATHE POSITION'}</small>
          <b>{sim?.fimathePaperExperiment?.position?String(sim.fimathePaperExperiment.position.symbol).replace('_','/')+' • '+String(sim.fimathePaperExperiment.position.direction).toUpperCase():(lang==='pt'?'Nenhuma aberta':'None open')}</b>
          <span>{sim?.fimathePaperExperiment?.lastAction?JSON.stringify(sim.fimathePaperExperiment.lastAction):(lang==='pt'?'Aguardando primeiro sinal':'Waiting for first signal')}</span>
        </div>
      </section>

      <section className="panel protection">
        <div className="panel-head">
          <div><span className="kicker"><ShieldCheck size={15}/>{x.risk}</span><h2>{x.security}</h2><p>{x.securitySub}</p></div>
          <span className="locked-pill"><ShieldCheck size={14}/> LOCKED</span>
        </div>
        <div className="risk-grid">
          <RiskCard label={x.hardStop} value="0.8%" detail="Planner reference; fill revalidated"/>
          <RiskCard label={x.slippage} value="0.1%" detail="Hard ceiling"/>
          <RiskCard label={x.kill} value="3.0%" detail="Rolling 24h"/>
          <RiskCard label={x.exposure} value="0.25%" detail="Capital at risk"/>
        </div>
        <div className="risk-footer"><ShieldCheck size={16}/><span>{x.manual}</span><b>{drawdown.toFixed(2)}% / 3.00%</b></div>
      </section>

      <section className="bottom-grid">
        <div className="panel positions-panel">
          <div className="panel-head compact"><div><span className="kicker"><Target size={15}/>{x.positions}</span><h2>{x.openTitle}</h2></div><span className="count">{positions.length}</span></div>
          {positions.length===0?<div className="empty-state"><div className="empty-icon"><Target size={24}/></div><b>{x.none}</b><span>{x.noData}</span></div>:positions.map((p:any)=><div className="position-row" key={p.id||p.tradeId||JSON.stringify(p)}>
            <div><b>{p.instrument||p.symbol||'—'}</b><small>{p.currentUnits||p.units||''}</small></div><ChevronRight size={18}/>
          </div>)}
        </div>

        <div className="panel mindset">
          <div className="mind-icon"><CircleDollarSign size={27}/></div>
          <span className="kicker">PROFITMIND</span>
          <h2>{x.profit}</h2>
          <p>{x.profitSub}</p>
          <div className="rule-line"><span>01</span><b>Protect capital first</b></div>
          <div className="rule-line"><span>02</span><b>Only trade measurable edge</b></div>
          <div className="rule-line"><span>03</span><b>Compound proven behavior</b></div>
        </div>
      </section>
    </main>
  </div>
}

function Nav({icon,label,active=false}:{icon:React.ReactNode;label:string;active?:boolean}){return <button className={active?'nav-item active':'nav-item'}>{icon}<span>{label}</span></button>}
function Metric({icon,label,value,meta}:{icon:React.ReactNode;label:string;value:string;meta:string}){return <div className="metric"><div className="metric-icon">{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>}
function StrategyPerformanceCard({name,status,stats,lang,researchOnly=false}:{name:string;status:string;stats:any;lang:Lang;researchOnly?:boolean}){
  const trades=Number(stats?.trades||0),wins=Number(stats?.wins||0),losses=Number(stats?.losses||0)
  const grossProfit=Number(stats?.grossProfit||0),grossLoss=Number(stats?.grossLoss||0),net=Number(stats?.netProfit||0),maxDD=Number(stats?.maxDrawdown||0)
  const winRate=trades>0?(wins/trades)*100:0
  const avgWin=wins>0?grossProfit/wins:0
  const avgLoss=losses>0?grossLoss/losses:0
  const profitFactor=grossLoss>0?grossProfit/grossLoss:null
  return <div className="strategy-score-card">
    <div className="strategy-score-head"><div><small>{status}</small><b>{name}</b></div><span className={researchOnly?'research-badge':'paper-badge'}>{researchOnly?'RESEARCH':'PAPER'}</span></div>
    <strong className={net>0?'profit-up':net<0?'profit-down':''}>{signedMoney(net)}</strong>
    <div className="strategy-score-metrics">
      <div><small>{lang==='pt'?'TRADES':'TRADES'}</small><b>{trades}</b></div>
      <div><small>{lang==='pt'?'ACERTO':'WIN RATE'}</small><b>{winRate.toFixed(1)}%</b></div>
      <div><small>{lang==='pt'?'FATOR LUCRO':'PROFIT FACTOR'}</small><b>{profitFactor==null?'—':profitFactor.toFixed(2)}</b></div>
      <div><small>{lang==='pt'?'MAX DRAWDOWN':'MAX DRAWDOWN'}</small><b>{money(maxDD)}</b></div>
      <div><small>{lang==='pt'?'MÉDIA GANHO':'AVG WIN'}</small><b>{signedMoney(avgWin)}</b></div>
      <div><small>{lang==='pt'?'MÉDIA PERDA':'AVG LOSS'}</small><b>{losses>0?'-'+money(avgLoss):money(0)}</b></div>
    </div>
    <div className="strategy-score-foot"><span>W {wins} / L {losses}</span><span>{stats?.lastClosedAt?new Date(stats.lastClosedAt).toLocaleString():(lang==='pt'?'sem trade fechado':'no closed trade')}</span></div>
  </div>
}
function RiskCard({label,value,detail}:{label:string;value:string;detail:string}){return <div className="risk-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function money(v:any){if(v==null||v==='')return'—';const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):String(v)}
function fmt(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';return n>=20?n.toFixed(3):n.toFixed(5)}
function signedMoney(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';const abs=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Math.abs(n));return n>0?`+${abs}`:n<0?`-${abs}`:abs}
function signedPct(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';return `${n>0?'+':''}${n.toFixed(2)}%`}

createRoot(document.getElementById('root')!).render(<App/>)
