import React,{useEffect,useMemo,useState}from'react'
import{createRoot}from'react-dom/client'
import{
  Activity,BrainCircuit,ChartNoAxesCombined,ChevronRight,CircleDollarSign,
  Globe2,LayoutDashboard,LineChart,RefreshCw,ShieldCheck,
  Sparkles,Target,WalletCards,Wifi,WifiOff
}from'lucide-react'
import OllamaChartLab from './OllamaChartLab'
import'./styles.css'

type Lang='en'|'pt'
type Quote={symbol:string;bid:string;ask:string;mid:string;timestamp:string}
function ollamaOandaStatus(status:string|undefined,lang:Lang){
 const label:Record<string,[string,string]>={
  MARKET_CLOSED:['MERCADO FECHADO','MARKET CLOSED'],
  WAITING_SHADOW_FREE:['AGUARDANDO PAR LIVRE','WAITING FOR FREE PAIR'],
  WAITING_NEW_OLLAMA_SIGNAL:['AGUARDANDO NOVO SINAL','WAITING FOR NEW SIGNAL'],
  BROKER_OPEN:['TRADE CONFIRMADO NA OANDA','OANDA TRADE OPEN'],
  REVIEW_REQUIRED:['REVISAR TRADE NA OANDA','REVIEW OANDA TRADE'],
  BLOCKED:['ORDEM NÃO ENVIADA','ORDER NOT SENT'],
  DISABLED_OR_NOT_PRACTICE:['EXECUÇÃO DESATIVADA','EXECUTION DISABLED']
 }
 return label[status||'']?.[lang==='pt'?0:1]??status??'—'
}

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
    exposure:'Per-trade risk',manual:'OANDA Practice broker execution only',
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
    exposure:'Risco por trade',manual:'Execução apenas na OANDA Practice',
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
  const[engine,setEngine]=useState<any>(null)
  const[oandaAudit,setOandaAudit]=useState<any>(null)
  const[ollamaMirror,setOllamaMirror]=useState<any>(null)
  const x=copy[lang]

  const load=async()=>{
    setLoading(true)
    try{
      const[h,a,p,sm,audit,mirror,...qs]=await Promise.all([
        fetch('http://127.0.0.1:8790/health').then(r=>r.json()).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/account').then(r=>r.ok?r.json():null).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/positions').then(r=>r.ok?r.json():[]).catch(()=>[]),
        fetch('http://127.0.0.1:8790/api/engine').then(r=>r.ok?r.json():null).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/oanda-audit').then(r=>r.ok?r.json():null).catch(()=>null),
        fetch('http://127.0.0.1:8790/api/ollama-mirror').then(r=>r.ok?r.json():null).catch(()=>null),
        ...PAIRS.map(pair=>fetch(`http://127.0.0.1:8790/api/quote/${pair}`).then(r=>r.ok?r.json():null).catch(()=>null))
      ])
      setHealth(h);setAccount(a);setPositions(Array.isArray(p)?p:[]);setEngine(sm||null);setOandaAudit(audit);setOllamaMirror(mirror)
      const next:Record<string,Quote>={}
      qs.forEach((q:any)=>{if(q?.symbol)next[q.symbol]=q})
      setQuotes(next)
    }finally{setLoading(false)}
  }

  useEffect(()=>{load();const id=setInterval(load,5000);return()=>clearInterval(id)},[])

  const drawdown=useMemo(()=>{
    const n=Number(account?.drawdown24h||0)*100
    return Number.isFinite(n)?n:0
  },[account])

  const shadowLearning=engine?.brokerLearning?.status==='READY'?engine.brokerLearning?.summary:null
  const shadowRealized=shadowLearning?.trades?shadowLearning.netPL:null
  const shadowOpenTrade=oandaAudit?.mirrorTrade??null
  const shadowOpenPL=shadowOpenTrade?.unrealizedPL!=null?Number(shadowOpenTrade.unrealizedPL):null
  const shadowTradeId=shadowOpenTrade?.id??null
  const shadowVerified=!!oandaAudit&&oandaAudit.syncStatus==='MATCHED'

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
        <div className="sidebar-profit-head"><CircleDollarSign size={18}/>
          <div><small>SHADOW • OANDA</small><span>{lang==='pt'?'P/L confirmado na corretora':'Broker-confirmed P/L only'}</span></div>
        </div>
        <strong className={shadowRealized!=null?(shadowRealized>=0?'profit-up':'profit-down'):''}>
          {shadowRealized!=null?signedMoney(shadowRealized):'—'}</strong>
        <div className="profit-split">
          <div><small>{lang==='pt'?'REALIZADO':'REALIZED'}</small><b>{shadowRealized!=null?signedMoney(shadowRealized):'—'}</b></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small><b>{shadowOpenPL!=null?signedMoney(shadowOpenPL):'—'}</b></div>
        </div>
        <div className="profit-position"><span className={shadowVerified?'pulse-dot':'offline-dot'}/>
          <div><small>TRADE ID • SHADOW</small><b>{shadowTradeId?'#'+shadowTradeId:'—'}</b></div>
        </div>
        <small>{lang==='pt'?'Fechamentos vinculados: ':'Linked broker closures: '}{shadowLearning?.trades??'—'}</small>
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
          <span style={{padding:'8px 12px',borderRadius:999,fontWeight:800,fontSize:12,letterSpacing:'.08em',border:'1px solid rgba(255,255,255,.12)',background:health?.brokerMode==='DEMO'?'rgba(250,204,21,.12)':'rgba(239,68,68,.12)',color:health?.brokerMode==='DEMO'?'#fde68a':'#fecaca'}}>{health?.brokerMode==='DEMO'?'🟢 OANDA PRACTICE • CONTA DEMO':'🔴 EXECUÇÃO DESATIVADA'}</span>
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

      <section className="broker-overview" aria-label={lang==='pt'?'Resumo oficial da conta OANDA':'Official OANDA account summary'}>
         <div className="broker-overview-head">
           <div>
             <div className="broker-overview-kicker"><WalletCards size={17}/>{lang==='pt'?'OANDA · FONTE OFICIAL':'OANDA · BROKER SOURCE'}</div>
             <h2>{lang==='pt'?'Sua conta na OANDA':'Your OANDA account'}</h2>
             <p>{lang==='pt'?'Saldo, patrimônio e posições diretamente da OANDA Practice.':'Balance, equity and trades from OANDA Practice only.'}</p>
           </div>
           <span className={`broker-sync ${oandaAudit?.syncStatus==='MATCHED'?'matched':oandaAudit?.syncStatus==='MISMATCH'?'mismatch':'unavailable'}`} role="status" aria-live="polite">
             {oandaAudit?.syncStatus==='MATCHED'?(lang==='pt'?'✓ Conferido':'✓ Matched'):oandaAudit?.syncStatus==='MISMATCH'?(lang==='pt'?'⚠ Divergência':'⚠ Mismatch'):(lang==='pt'?'⚠ Indisponível':'⚠ Unavailable')}
           </span>
         </div>
         <div className="broker-stat-grid">
           <div className="broker-stat"><span>{lang==='pt'?'Saldo':'Balance'}</span><strong>{oandaAudit?money(oandaAudit.balance):'—'}</strong></div>
           <div className="broker-stat"><span>{lang==='pt'?'Patrimônio':'Equity'}</span><strong>{oandaAudit?money(oandaAudit.equity):'—'}</strong></div>
           <div className="broker-stat"><span>{lang==='pt'?'P/L em aberto':'Unrealized P/L'}</span><strong className={Number(oandaAudit?.unrealizedPL)>0?'profit-up':Number(oandaAudit?.unrealizedPL)<0?'profit-down':''}>{oandaAudit?signedMoney(oandaAudit.unrealizedPL):'—'}</strong></div>
           <div className="broker-stat"><span>{lang==='pt'?'P/L realizado da conta':'Account realized P/L'}</span><strong className={Number(oandaAudit?.accountRealizedPL)>0?'profit-up':Number(oandaAudit?.accountRealizedPL)<0?'profit-down':''}>{oandaAudit?signedMoney(oandaAudit.accountRealizedPL):'—'}</strong></div>
           <div className="broker-stat"><span>{lang==='pt'?'Trades abertos':'Open trades'}</span><strong>{oandaAudit?.openTrades?.length??'—'}</strong></div>
         </div>
         <div className="broker-overview-meta">
           <span>{lang==='pt'?'Margem disponível':'Available margin'}: <b>{oandaAudit?money(oandaAudit.marginAvailable):'—'}</b></span>
           <span>{lang==='pt'?'Margem usada':'Used margin'}: <b>{oandaAudit?money(oandaAudit.marginUsed):'—'}</b></span>
           <span>24h DD: <b>{drawdown.toFixed(2)}%</b></span>
         </div>
         {oandaAudit?.issues?.length>0&&<div className="broker-sync-alert" role="alert">SYNC ALERT: {oandaAudit.issues.join(' · ')}</div>}
         <div className="broker-overview-footer">
           <span>{lang==='pt'?'Última consulta OANDA':'Last OANDA update'}: {oandaAudit?.retrievedAt?new Date(oandaAudit.retrievedAt).toLocaleString(lang==='pt'?'pt-BR':'en-US'):'—'}</span>
           <span>{lang==='pt'?'P/L da conta inteira, não só do Shadow. Status indica verificações básicas.':'Account-wide P/L, not Shadow-only. Status indicates basic checks.'}</span>
         </div>
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

      <section className="panel shadow-lab">
        <div className="panel-head"><div>
          <span className="kicker"><Activity size={15}/> OANDA PRACTICE • AO VIVO</span>
          <h2>{lang==='pt'?'Operações na corretora':'Broker executions'}</h2>
          <p>{lang==='pt'?'Somente posições e resultados da OANDA Practice, nunca resultados simulados.':
           'Only OANDA Practice positions and results, never simulated performance.'}</p>
        </div><span className="locked-pill">OANDA API</span></div>
        <div className="shadow-grid">
          <div><small>TRADE ID • SHADOW</small><strong>{shadowTradeId??'—'}</strong></div>
          <div><small>TRADE ID • OLLAMA</small><strong>{ollamaMirror?.tradeId??'—'}</strong></div>
          <div><small>{lang==='pt'?'POSIÇÕES NA CONTA':'ACCOUNT TRADES'}</small><strong>{oandaAudit?.openTrades?.length??'—'}</strong></div>
          <div><small>{lang==='pt'?'SINCRONIZAÇÃO':'SYNC STATUS'}</small><strong>{oandaAudit?.syncStatus??'—'}</strong></div>
        </div>
      </section>

      <section className="panel shadow-lab">
        <div className="panel-head"><div>
          <span className="kicker"><Target size={15}/> SHADOW 3/4 • OANDA</span>
          <h2>{lang==='pt'?'Shadow 3/4 — resultados oficiais':'Shadow 3/4 — broker results'}</h2>
          <p>{lang==='pt'?'Apenas trades Shadow vinculados a fechamentos da OANDA.':
            'Only Shadow trades attributed to OANDA closed positions.'}</p>
        </div><span className="locked-pill">PRACTICE ONLY</span></div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'LUCRO REALIZADO':'REALIZED P/L'}</small>
            <strong className={shadowRealized!=null?(shadowRealized>=0?'profit-up':'profit-down'):''}>
              {shadowRealized!=null?signedMoney(shadowRealized):'—'}</strong></div>
          <div><small>{lang==='pt'?'EM ABERTO':'OPEN P/L'}</small>
            <strong>{shadowOpenPL!=null?signedMoney(shadowOpenPL):'—'}</strong></div>
          <div><small>W / L</small><strong>{shadowLearning?shadowLearning.wins+' / '+shadowLearning.losses:'—'}</strong></div>
          <div><small>{lang==='pt'?'FECHADOS CONFERIDOS':'VERIFIED CLOSED'}</small><strong>{shadowLearning?.trades??'—'}</strong></div>
          <div><small>TRADE ID</small><strong>{shadowTradeId??'—'}</strong></div>
          <div><small>{lang==='pt'?'HISTÓRICO':'HISTORY STATUS'}</small><strong>{engine?.brokerLearning?.status??'—'}</strong></div>
        </div>
        <div className="shadow-position">
          <small>{lang==='pt'?'POSIÇÃO CONFIRMADA':'CONFIRMED POSITION'}</small>
          <b>{shadowOpenTrade?String(shadowOpenTrade.instrument)+' · '+(Number(shadowOpenTrade.currentUnits)<0?'SHORT':'LONG'):
            (lang==='pt'?'Nenhuma posição Shadow aberta confirmada':'No confirmed open Shadow trade')}</b>
          <span>{shadowOpenTrade?'OANDA #'+shadowOpenTrade.id+' · Entry '+String(shadowOpenTrade.price??'—')+
            ' · Stop '+String(shadowOpenTrade.stopLossOrder?.price??'—'):'—'}</span>
        </div>
      </section>

      <section className="panel performance-board">
        <div className="panel-head"><div>
          <span className="kicker"><ChartNoAxesCombined size={15}/> OANDA PRACTICE</span>
          <h2>{lang==='pt'?'Somente Shadow 3/4 e Ollama':'Only Shadow 3/4 and Ollama'}</h2>
          <p>{lang==='pt'?'Resultados somente de Trade IDs da OANDA.':'Only OANDA-attributed Trade IDs.'}</p>
        </div><span className="live-pill"><i/> OANDA DATA</span></div>
        <div className="strategy-score-grid">
          <div className="strategy-score-card">
            <div className="strategy-score-head"><b>SHADOW 3/4</b><span>OANDA PRACTICE</span></div>
            <strong className={shadowRealized!=null?(shadowRealized>=0?'profit-up':'profit-down'):''}>
              {shadowRealized!=null?signedMoney(shadowRealized):'—'}</strong>
            <div className="shadow-grid">
              <div><small>W / L</small><strong>{shadowLearning?shadowLearning.wins+' / '+shadowLearning.losses:'—'}</strong></div>
              <div><small>TRADE ID</small><strong>{shadowTradeId??'—'}</strong></div>
            </div>
            <p>{lang==='pt'?'Somente fechamentos vinculados na OANDA; amostra pode ser parcial.':
              'Only OANDA-linked closures; the historical sample may be partial.'}</p>
          </div>
          <div className="strategy-score-card ollama-strategy-card">
            <div className="strategy-score-head"><b>OLLAMA • OANDA PRACTICE</b>
              <span>{ollamaOandaStatus(ollamaMirror?.status,lang)}</span></div>
            <strong>{ollamaMirror?.source==='OANDA_API'?signedMoney(ollamaMirror.realizedPL):'—'}</strong>
            <div className="shadow-grid">
              <div><small>{lang==='pt'?'FECHADOS':'CLOSED'}</small><strong>{ollamaMirror?.closedTrades??'—'}</strong></div>
              <div><small>TRADE ID</small><strong>{ollamaMirror?.tradeId??'—'}</strong></div>
            </div>
            <p>{lang==='pt'?'Apenas resultados de operações identificadas na OANDA.':
              'Only broker-confirmed Ollama results.'}</p>
          </div>
        </div>
      </section>

      <section className="panel shadow-lab ollama-lab">
        <div className="panel-head">
          <div>
            <span className="kicker"><BrainCircuit size={15}/> OLLAMA AI LAB • OANDA RESEARCH</span>
            <h2>{lang==='pt'?'IA independente trabalhando':'Independent AI at work'}</h2>
            <p>{lang==='pt'?'Sinais independentes da IA para a OANDA Practice, com risco limitado a US$2,50 por ordem. Sem operações virtuais novas. Todas as entradas exigem confirmação da corretora.':'AI signals submit only to OANDA Practice subject to a $2.50 maximum initial stop risk. No new virtual positions; broker confirmation required.'}</p>
          </div>
          <span className="locked-pill">OANDA PRACTICE ONLY</span>
        </div>
        <div className="ollama-lab-status">
          <span className={health?.ollama?'pulse-dot':'offline-dot'}/>
          <b>{health?.ollama?(lang==='pt'?'Ollama conectado':'Ollama connected'):(lang==='pt'?'Ollama desconectado':'Ollama disconnected')}</b>
          <span>{lang==='pt'?'Motor:':'Engine:'} {engine?.ollamaAi?.status??'WAITING'}</span>
          <span>{lang==='pt'?'Última análise:':'Last analysis:'} {engine?.ollamaAi?.lastReviewedAt?new Date(engine.ollamaAi.lastReviewedAt).toLocaleString(lang==='pt'?'pt-BR':'en-US'):(lang==='pt'?'aguardando':'waiting')}</span>
        </div>
        <div className="ollama-oanda-official">
          <div className="ollama-oanda-head">
            <div>
              <small>OANDA PRACTICE • OLLAMA • {lang==='pt'?'FONTE OFICIAL':'BROKER SOURCE'}</small>
              <b>{ollamaOandaStatus(ollamaMirror?.status,lang)}</b>
            </div>
            <span>{lang==='pt'?'MESMA CONTA • TRADE ID ISOLADO':'SAME ACCOUNT • SEPARATE TRADE ID'}</span>
          </div>
          <div className="ollama-oanda-values">
            <div><small>{lang==='pt'?'P/L REALIZADO NA OANDA':'REALIZED OANDA P/L'}</small><strong>{ollamaMirror?.source==='OANDA_API'?signedMoney(ollamaMirror.realizedPL):'—'}</strong></div>
            <div><small>{lang==='pt'?'TRADE ID OANDA':'OANDA TRADE ID'}</small><strong>{ollamaMirror?.tradeId??'—'}</strong></div>
            <div><small>{lang==='pt'?'FECHADOS NA OANDA':'BROKER CLOSED TRADES'}</small><strong>{ollamaMirror?.closedTrades??'—'}</strong></div>
            <div><small>{lang==='pt'?'PAR ATUAL':'CURRENT PAIR'}</small><strong>{ollamaMirror?.activeSymbol?String(ollamaMirror.activeSymbol).replace('_','/'):'—'}</strong></div>
          </div>
          <p>{lang==='pt'
            ?'Trades exclusivos do Ollama confirmados pela corretora. O saldo e a margem continuam compartilhados com Shadow. Nenhum ganho virtual é contabilizado.'
             :'Only broker-verified trades tagged to Ollama. Account equity and margin are shared with Shadow. No virtual profit is counted.'}</p>
          {ollamaMirror?.status==='MARKET_CLOSED'&&<p className="ollama-market-closed">
            {lang==='pt'
              ?'Mercado Forex da OANDA fechado: sexta às 16h59 até domingo às 17h05 (Nova York). Os próximos sinais serão analisados quando houver cotações válidas; nenhuma ordem será enviada fora do horário.'
              :'OANDA Forex market closed: Friday 4:59 PM to Sunday 5:05 PM (New York). Fresh quotes and new signals resume during market hours; no off-hours order is submitted.'}
          </p>}
          {ollamaMirror?.latestError&&<p className="ollama-oanda-warning">{
            String(ollamaMirror.latestError).includes('SHADOW_PRIORITY')
             ?(lang==='pt'?'Último sinal ignorado: Shadow 3/4 já estava operando esse par. Nenhuma ordem Ollama foi enviada.':'Previous signal skipped: Shadow 3/4 already owned the instrument. No Ollama order sent.')
             :String(ollamaMirror.latestError)}
          </p>}
          {ollamaMirror?.status==='REVIEW_REQUIRED'&&<button type="button" className="ollama-recheck" onClick={async()=>{
            const r=await fetch('http://127.0.0.1:8790/api/ollama-mirror/reconcile',{method:'POST'}).catch(()=>null)
            if(r?.ok)setOllamaMirror(await r.json())
          }}>{lang==='pt'?'Conferir trade na OANDA (somente leitura)':'Recheck OANDA trade (read-only)'}</button>}
          {ollamaMirror?.events?.[0]&&<p className="ollama-oanda-event">{ollamaMirror.events[0].event}: {ollamaMirror.events[0].detail}</p>}
          <p className="ollama-oanda-note">{lang==='pt'
            ?'Operações virtuais antigas não são enviadas retroativamente. Novos sinais elegíveis do Ollama serão enviados somente à OANDA Practice.'
             :'Old virtual positions are never opened retroactively. New eligible Ollama signals are submitted only to OANDA Practice.'}</p>
        </div>
        <div className="ollama-diagnostics">
          <OllamaChartLab data={engine?.brokerLearning} lang={lang}/>
          <div className="ollama-research-card">
            <small>{lang==='pt'?'SETUP OBJETIVO · CANDLES OANDA':'OBJECTIVE SETUP · OANDA CANDLES'}</small>
            <b>{engine?.ollamaAi?.lastSetup?.direction==='NONE'?(lang==='pt'?'SEM CONFIRMAÇÃO':'NO CONFIRMED SETUP'):(engine?.ollamaAi?.lastSetup?.direction??'WAITING')}</b>
            <div className="ollama-research-values">
              <span>{lang==='pt'?'CRITÉRIOS':'CHECKS'} <strong>{engine?.ollamaAi?.lastSetup?.score??0} / 5</strong></span>
              <span>RSI <strong>{engine?.ollamaAi?.lastSetup?.rsiZone??'—'}</strong></span>
            </div>
            <p>{engine?.ollamaAi?.lastSetup?.missing?.length
              ?(lang==='pt'?'Confirmações faltando: ':'Missing confirmations: ')+engine.ollamaAi.lastSetup.missing.join(' · ')
              :(lang==='pt'?'Avaliando novos candles fechados da OANDA.':'Evaluating new completed OANDA candles.')}</p>
            <p>{lang==='pt'?'Scanner independente: envia somente novos sinais qualificados ao executor OANDA Practice e nunca altera o Shadow 3/4.':'Independent scanner sends only qualified new signals to the Practice executor; Shadow 3/4 is untouched.'}</p>
          </div>
        </div>
        <div className="ollama-research-grid">
          <div className="ollama-research-card">
            <small>{lang==='pt'?'CONDIÇÕES DE MERCADO · OANDA':'MARKET CONDITIONS · OANDA'}</small>
            <b>{engine?.ollamaAi?.lastMarket?.symbol?String(engine.ollamaAi.lastMarket.symbol).replace('_','/'):'—'}</b>
            <div className="ollama-research-values">
              <span>RSI 14 <strong>{engine?.ollamaAi?.lastMarket?.rsi14??'—'}</strong></span>
              <span>MACRO <strong>{engine?.ollamaAi?.lastMarket?.macroTrend??'—'}</strong></span>
              <span>BB 20/2 <strong>{engine?.ollamaAi?.lastMarket?.bbPosition??'—'}</strong></span>
              <span>VOLUME <strong>{engine?.ollamaAi?.lastMarket?.volumeRatio!=null?Number(engine.ollamaAi.lastMarket.volumeRatio).toFixed(2)+'×':'—'}</strong></span>
              <span>SPREAD <strong>{engine?.ollamaAi?.lastMarket?.spreadPips!=null?engine.ollamaAi.lastMarket.spreadPips+' pips':'—'}</strong></span>
            </div>
            <p>{lang==='pt'?'Indicadores derivados de candles fechados. Não são previsão de lucro.':'Indicators calculated from completed candles, not a profit forecast.'}</p>
          </div>
          <div className="ollama-research-card">
            <small>{lang==='pt'?'APRENDIZADO · TRADES CONFIRMADOS':'LEARNING · VERIFIED OANDA TRADES'}</small>
            <b>{engine?.brokerLearning?.summary?.trades??0} {lang==='pt'?'trades Shadow ligados':'linked Shadow trades'}</b>
            <div className="ollama-research-values">
              <span>W / L <strong>{engine?.brokerLearning?.summary?.wins??0} / {engine?.brokerLearning?.summary?.losses??0}</strong></span>
              <span>OANDA P/L <strong>{signedMoney(engine?.brokerLearning?.summary?.netPL??0)}</strong></span>
              <span>{lang==='pt'?'PADRÕES AMOSTRADOS':'SAMPLED PATTERNS'} <strong>{engine?.brokerLearning?.summary?.featureSamples??0}</strong></span>
              <span>{lang==='pt'?'STATUS':'STATUS'} <strong>{engine?.brokerLearning?.status??'WAITING'}</strong></span>
            </div>
            <div className="ollama-condition-list">
              <small>{lang==='pt'?'CONDIÇÕES OBSERVADAS NAS VITÓRIAS':'OBSERVED WINNING CONDITIONS'} · {lang==='pt'?'mínimo 3 exemplos':'minimum 3 examples'}</small>
              {(engine?.brokerLearning?.summary?.observedWinningConditions??[]).length
                ?(engine.brokerLearning.summary.observedWinningConditions as Array<{condition:string;wins:number;losses:number}>).map((c)=>
                  <span key={c.condition}>{c.condition.replaceAll('_',' ')} · W {c.wins} / L {c.losses}</span>)
                :<span>{lang==='pt'?'Sem amostra suficiente para mostrar um padrão confiável.':'Not enough confirmed examples to report a pattern.'}</span>}
            </div>
            <p>{engine?.brokerLearning?.summary?.trades
              ?(lang==='pt'?'Só resultados fechados pela OANDA e vinculados ao ID de espelho do Shadow.':'OANDA-confirmed closures linked to Shadow mirror IDs only.')
              :(lang==='pt'?'Ainda sem amostra vinculada; dados locais não são considerados lucro real.':'No linked broker sample yet; local profits are not treated as real.')}</p>
            {engine?.brokerLearning?.error&&<p className="ollama-research-error">{String(engine.brokerLearning.error)}</p>}
          </div>
          <div className="ollama-research-card ollama-comparison">
            <small>{lang==='pt'?'COMPARAÇÃO · MESMO PERÍODO':'COMPARISON · SAME TIME WINDOW'}</small>
            <div className="ollama-compare-line"><span>Shadow • OANDA</span><b>{shadowRealized!=null?signedMoney(shadowRealized):'—'}</b><em>{shadowLearning?.trades??'—'} {lang==='pt'?'fechados vinculados':'linked closures'}</em></div>
            <div className="ollama-compare-line"><span>Ollama • OANDA</span><b>{ollamaMirror?.source==='OANDA_API'?signedMoney(ollamaMirror.realizedPL):'—'}</b><em>{ollamaMirror?.closedTrades??'—'} {lang==='pt'?'fechados':'closed'}</em></div>
            <p>{lang==='pt'?'P/L realizado confirmado pela OANDA; métricas de estratégia e tamanho de posição não são comparáveis diretamente.':'OANDA-confirmed realized P/L; strategy capital and position sizing are not directly comparable.'}</p>
          </div>
        </div>
        <div className="ollama-cost-note"><ShieldCheck size={15}/>
          <span>{lang==='pt'?'Somente OANDA Practice · execução, stops e alvos confirmados pela corretora · sem contabilizar resultados simulados':'OANDA Practice only · broker-executed trades, stops and targets · no simulated results counted'}</span>
        </div>
        <div className="shadow-grid">
          <div><small>{lang==='pt'?'LUCRO REALIZADO • OANDA':'REALIZED P/L • OANDA'}</small><strong>{ollamaMirror?.source==='OANDA_API'?signedMoney(ollamaMirror.realizedPL):'—'}</strong></div>
          <div><small>{lang==='pt'?'EM ABERTO • OANDA':'OPEN P/L • OANDA'}</small><strong>{ollamaMirror?.brokerOpenPL!=null?signedMoney(ollamaMirror.brokerOpenPL):'—'}</strong></div>
          <div><small>{lang==='pt'?'TRADE ID OANDA':'OANDA TRADE ID'}</small><strong>{ollamaMirror?.tradeId??'—'}</strong></div>
          <div><small>{lang==='pt'?'TRADES FECHADOS • OANDA':'CLOSED TRADES • OANDA'}</small><strong>{ollamaMirror?.closedTrades??'—'}</strong></div>
          <div><small>{lang==='pt'?'ANÁLISES DA IA':'AI REVIEWS'}</small><strong>{engine?.ollamaAi?.decisions??'—'}</strong></div>
          <div><small>{lang==='pt'?'SINAIS GERADOS':'SIGNALS GENERATED'}</small><strong>{engine?.ollamaAi?.signals??'—'}</strong></div>
          <div><small>{lang==='pt'?'ESTADO DA OANDA':'BROKER STATUS'}</small><strong className="ollama-oanda-status-value">{ollamaOandaStatus(ollamaMirror?.status,lang)}</strong></div>
          <div><small>{lang==='pt'?'FALHAS DA IA':'MODEL ERRORS'}</small><strong>{engine?.ollamaAi?.errors??'—'}</strong></div>
        </div>
        <div className="shadow-position">
          <small>{lang==='pt'?'POSIÇÃO OLLAMA • CONFIRMADA NA OANDA':'OLLAMA POSITION • OANDA VERIFIED'}</small>
          <b>{ollamaMirror?.tradeId
            ?String(ollamaMirror.activeSymbol??'').replace('_','/')+' • '+String(ollamaMirror.activeDirection??'').toUpperCase()+' • #'+ollamaMirror.tradeId
            :(lang==='pt'?'Nenhuma posição confirmada na OANDA':'No broker-confirmed position')}</b>
          <span>{ollamaMirror?.tradeId
            ?(lang==='pt'?'Entrada confirmada: ':'Confirmed broker entry: ')+(ollamaMirror.brokerFillPrice??'—')+' | Stop '+(ollamaMirror.mirroredStop??'—')
            :(lang==='pt'?'A IA continuará analisando candles até surgir uma entrada permitida pela OANDA Practice.':'The AI keeps analyzing candles until a new OANDA Practice entry passes broker safety checks.')}</span>
        </div>
        <div className="ollama-lab-decision">
          <small>{lang==='pt'?'ÚLTIMA DECISÃO DA IA':'LATEST AI DECISION'}</small>
          <b>{engine?.ollamaAi?.lastDecision?.decision==='LONG'?'BUY':engine?.ollamaAi?.lastDecision?.decision==='SHORT'?'SELL':engine?.ollamaAi?.lastDecision?.decision??'WAITING'} {engine?.ollamaAi?.lastDecision?.symbol?'• '+String(engine.ollamaAi.lastDecision.symbol).replace('_','/'):''}</b>
          <span>{engine?.ollamaAi?.lastDecision?.reason??(lang==='pt'?'Aguardando a primeira análise do Ollama.':'Awaiting first Ollama review.')}</span>
          <small>{engine?.ollamaAi?.lastDecision?.confidence!=null?(lang==='pt'?'Confiança: ':'Confidence: ')+(Number(engine.ollamaAi.lastDecision.confidence)*100).toFixed(0)+'%':''}</small>
        </div>
        <div className="ollama-lab-feed">
          <div className="ollama-lab-feed-title"><Activity size={15}/> {lang==='pt'?'ATIVIDADE REAL DA IA':'REAL AI ACTIVITY'} <small>{lang==='pt'?'Últimos eventos registrados':'Latest recorded events'}</small></div>
          {(engine?.ollamaAi?.events??[]).slice(0,10).map((e:any,i:number)=>
            <div className="ollama-lab-event" key={String(e.at)+String(i)}>
              <time>{new Date(e.at).toLocaleTimeString(lang==='pt'?'pt-BR':'en-US')}</time>
              <b>{String(e.event||'').replace('OLLAMA_LAB_','').replaceAll('_',' ')}</b>
              <span>{e.symbol?String(e.symbol).replace('_','/')+' • ':''}{e.decision?e.decision+' • ':''}{e.reason||e.pnl||''}</span>
            </div>
          )}
          {!(engine?.ollamaAi?.events?.length)&&<p>{lang==='pt'?'Ainda sem eventos. Os registros aparecerão quando o motor iniciar.':'No events yet. Activity will appear when the engine starts.'}</p>}
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
function RiskCard({label,value,detail}:{label:string;value:string;detail:string}){return <div className="risk-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function money(v:any){if(v==null||v==='')return'—';const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):String(v)}
function fmt(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';return n>=20?n.toFixed(3):n.toFixed(5)}
function signedMoney(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';const abs=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Math.abs(n));return n>0?`+${abs}`:n<0?`-${abs}`:abs}
function signedPct(v:any){const n=Number(v);if(!Number.isFinite(n))return'—';return `${n>0?'+':''}${n.toFixed(2)}%`}

createRoot(document.getElementById('root')!).render(<App/>)
