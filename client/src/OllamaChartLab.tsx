import React,{useState} from 'react'
type Candle={time:string;open:number;high:number;low:number;close:number;volume:number}
type TF='M1'|'M5'|'M10'|'M15'|'H1'
type ChartWindow={timeframe:TF;bars:Candle[]}
type Journey={bars:Candle[];granularity:string;complete:boolean;note:string}
type Charts={source:string;windows:ChartWindow[];journey:Journey;entryTime:string;exitTime:string;
 entryPrice:string|null;exitPrice:string|null;stopPrice:string|null;targetPrice:string|null}
type Lesson={tradeId:string;symbol:string;direction:'LONG'|'SHORT';realizedPL:number;outcome:string;openedAt:string;closedAt:string;
 features?:{rsi14:number;volumeRatio:number;macroTrend:string;bbPosition:string}|null;charts?:Charts}
const timeframes:TF[]=['M1','M5','M10','M15','H1']
const en:Record<TF,string>={M1:'MICRO / M1',M5:'ENTRADA / M5',M10:'TENDÊNCIA / M10',M15:'CONTEXTO / M15',H1:'MACRO / H1'}
const labelsEn:Record<TF,string>={M1:'MICRO / M1',M5:'ENTRY / M5',M10:'TREND / M10',M15:'CONTEXT / M15',H1:'MACRO / H1'}
const sane=(b:Candle)=>Number.isFinite(Date.parse(b.time))&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&
 b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)
function bands(rows:Candle[]){
 return rows.map((_,i)=>{
  if(i<19)return null
  const v=rows.slice(i-19,i+1).map(b=>b.close),avg=v.reduce((a,b)=>a+b,0)/20
  const dev=Math.sqrt(v.reduce((sum,c)=>sum+(c-avg)**2,0)/20)
  return{upper:avg+2*dev,lower:avg-2*dev,middle:avg}
 })
}
function rsi14(rows:Candle[]){
 if(rows.length<15)return null
 const v=rows.slice(-15).map(c=>c.close)
 let gain=0,loss=0
 for(let i=1;i<v.length;i++){const n=v[i]-v[i-1];if(n>0)gain+=n;else loss-=n}
 if(loss===0)return 100
 return Math.round((100-(100/(1+gain/loss)))*10)/10
}
function Candles({bars,title,period,isJourney,charts,lang,showBands,showVolume,showTradeLines}:{
 bars:Candle[];title:string;period:string;isJourney?:boolean;charts?:Charts;lang:'pt'|'en';
 showBands:boolean;showVolume:boolean;showTradeLines:boolean
}){
 const rows=bars.filter(sane).slice(-200)
 if(rows.length<2)return <div className="chartlab-plot"><b className="chartlab-plot-title">{title}</b>
  <div className="chartlab-empty">{lang==='pt'?'OANDA não forneceu candles suficientes para este gráfico.':'OANDA did not return enough completed bars for this chart.'}</div></div>
 const width=660,height=277,left=18,right=18,top=18,priceHeight=172,volTop=209,volHeight=42
 const start=left,end=width-right,step=(end-start)/rows.length
 const bs=bands(rows)
 const bounds=rows.flatMap(c=>[c.low,c.high])
 if(showBands)for(const b of bs)if(b)bounds.push(b.upper,b.lower)
 const min=Math.min(...bounds),max=Math.max(...bounds),span=Math.max(max-min,0.000001)
 const y=(v:number)=>top+(max-v)/span*priceHeight
 const x=(i:number)=>start+step*(i+.5)
 const candleWidth=Math.max(1,step*.59)
 const maxVol=Math.max(...rows.map(c=>c.volume),1)
 const lines: Array<{price:number;color:string;caption:string;dash?:string}>=[]
 if(isJourney&&showTradeLines&&charts){
  for(const item of [
   {raw:charts.entryPrice,color:'#ffd37f',caption:lang==='pt'?'ENTRADA':'ENTRY'},
   {raw:charts.exitPrice,color:'#95c7ff',caption:lang==='pt'?'SAÍDA':'EXIT'},
   {raw:charts.stopPrice,color:'#ff7b9c',caption:'STOP',dash:'4 5'},
   {raw:charts.targetPrice,color:'#56e9c4',caption:'TARGET',dash:'4 5'}
  ]){
   const value=Number(item.raw)
   if(item.raw&&Number.isFinite(value)&&value>=min&&value<=max)lines.push({price:value,color:item.color,caption:item.caption,dash:item.dash})
  }
 }
 const overlayPath=(name:'upper'|'lower'|'middle')=>bs.map((b,i)=>b?String(x(i))+','+String(y(b[name])):null).filter(Boolean).join(' ')
 const first=rows[0].time.slice(0,16).replace('T',' ')
 const last=rows[rows.length-1].time.slice(0,16).replace('T',' ')
 return <div className="chartlab-plot">
  <div className="chartlab-plot-heading"><b className="chartlab-plot-title">{title}</b>
   <span className="chartlab-timeframe">OANDA MID • {period} • {rows.length}</span></div>
  <svg role="img" aria-label={title+' · '+period+' · '+rows.length+' candles completos OANDA'} viewBox="0 0 660 277" preserveAspectRatio="xMidYMid meet">
   {[0,1,2,3,4].map(i=><line key={i} x1={left} x2={end} y1={top+i*(priceHeight/4)} y2={top+i*(priceHeight/4)} stroke="rgba(255,162,220,.13)" strokeDasharray="4 6"/>)}
   {showBands&&(['upper','lower','middle'] as const).map((k)=><polyline key={k} points={overlayPath(k)}
    stroke={k==='middle'?'#d8a6f1':'#9b87e2'} opacity={k==='middle'?.54:.85} strokeWidth={k==='middle'?1:1.5} fill="none"/>)}
   {rows.map((b,i)=>{
    const color=b.close>=b.open?'#46e8b3':'#ff6ca9',px=x(i)
    return <g key={b.time+'-'+i}>
     <title>{b.time+' | O '+b.open.toFixed(5)+' H '+b.high.toFixed(5)+' L '+b.low.toFixed(5)+' C '+b.close.toFixed(5)+' | volume '+b.volume}</title>
     <line x1={px} x2={px} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1.25}/>
     <rect x={px-candleWidth/2} y={Math.min(y(b.open),y(b.close))} width={candleWidth}
      height={Math.max(1.3,Math.abs(y(b.close)-y(b.open)))} fill={color} rx=".6"/>
     {showVolume&&<rect x={px-candleWidth/2} y={volTop+volHeight*(1-b.volume/maxVol)} width={candleWidth}
      height={Math.max(1,volHeight*b.volume/maxVol)} fill={color} opacity=".65"/>}
    </g>
   })}
   {lines.map(l=><g key={l.caption}><line x1={start} y1={y(l.price)} x2={end} y2={y(l.price)}
    stroke={l.color} strokeWidth="1.25" strokeDasharray={l.dash}/><text x={end-5} y={Math.max(11,y(l.price)-3)}
     fill={l.color} fontWeight="bold" fontSize="10" textAnchor="end">{l.caption} {l.price.toFixed(5)}</text></g>)}
   {isJourney&&<><line x1={start} x2={start} y1={top} y2={top+priceHeight} stroke="#ffd37f" strokeDasharray="3 5"/>
    <line x1={end} x2={end} y1={top} y2={top+priceHeight} stroke="#95c7ff" strokeDasharray="3 5"/></>}
   {!isJourney&&<><line x1={end} x2={end} y1={top} y2={top+priceHeight} stroke="#ffd37f" strokeDasharray="3 5"/>
    <text x={end-4} y="12" fill="#ffd37f" fontSize="10" textAnchor="end">{lang==='pt'?'ANTES DA ENTRADA':'PRE-ENTRY'}</text></>}
   <text x={left} y="271" fill="#f9d1e8" fontSize="11">{first}</text>
   <text x={end} y="271" textAnchor="end" fill="#f9d1e8" fontSize="11">{last}</text>
   <text x={end-4} y={Math.max(13,y(max))} textAnchor="end" fill="#ffe4f2" fontSize="11">{max.toFixed(5)}</text>
   <text x={end-4} y={Math.min(203,y(min)+10)} textAnchor="end" fill="#ffe4f2" fontSize="11">{min.toFixed(5)}</text>
  </svg>
  <div className="chartlab-plot-footer">
   <span>RSI(14) <b>{rsi14(rows)??'—'}</b></span>
   <span>{lang==='pt'?'Volume último':'Last volume'} <b>{rows[rows.length-1].volume}</b></span>
   <span>BB(20,2) <b>{showBands?'ON':'OFF'}</b></span>
  </div>
 </div>
}
export default function OllamaChartLab({data,lang}:{data:any;lang:'pt'|'en'}){
 const lessons:Lesson[]=Array.isArray(data?.examples)?data.examples.filter((x:any)=>x.charts):[]
 const [selected,setSelected]=useState<string|null>(null)
 const [showBands,setShowBands]=useState(true)
 const [showVolume,setShowVolume]=useState(true)
 const [showTradeLines,setShowTradeLines]=useState(true)
 const current=lessons.find(l=>l.tradeId===selected)||lessons[0]
 const graphs=current?.charts?.windows??[]
 const complete=graphs.filter(x=>x.bars?.length>=2).length+
  (current?.charts?.journey?.complete&&current.charts.journey.bars.length>=2?1:0)
 return <section className="ollama-chartlab">
  <div className="chartlab-top"><div><span className="chartlab-kicker">OLLAMA • OANDA CHART LAB 6×</span>
   <h3>{lang==='pt'?'Laboratório dos 6 gráficos do 3/4':'Six-chart Shadow 3/4 laboratory'}</h3>
   <p>{lang==='pt'?'Cinco períodos antes da entrada + trajetória da operação. Apenas candles reais e operações fechadas confirmadas pela OANDA.':'Five pre-entry timeframes plus trade lifecycle. Only OANDA midpoint candles and broker-attributed closed trades.'}</p>
  </div><div className="chartlab-count"><strong>{data?.chartCoverage??0}</strong>
   <small>{lang==='pt'?'trades com 6 gráficos':'trades with 6 charts'}</small></div></div>
  {data?.status==='UNAVAILABLE'&&<p className="chartlab-alert">{lang==='pt'?'Pesquisa OANDA indisponível: os dados podem estar desatualizados.':'OANDA research unavailable; previous data may be stale.'}</p>}
  {lessons.length===0?<div className="chartlab-empty">{lang==='pt'?'Aguardando candles históricos de operações Shadow identificadas por Trade ID. Sem dados fictícios.':'Waiting for verified Shadow trade histories; no fabricated chart data.'}</div>:
   <><div className="chartlab-trades">{lessons.map(l=><button key={l.tradeId} type="button" aria-pressed={current?.tradeId===l.tradeId}
    className={'chartlab-pick '+(current?.tradeId===l.tradeId?'chosen':'')} onClick={()=>setSelected(l.tradeId)}>
    #{l.tradeId} · {l.symbol.replace('_','/')} · <strong className={l.realizedPL>=0?'win':'loss'}>{l.realizedPL>=0?'+':''}{'$'+l.realizedPL.toFixed(2)}</strong></button>)}</div>
   {current&&<><div className="chartlab-details">
     <b>{current.symbol.replace('_','/')} · {current.direction} · {current.outcome}</b>
     <span>OANDA #{current.tradeId} · RSI {current.features?.rsi14??'—'} · VOL {current.features?.volumeRatio??'—'}× · MACRO {current.features?.macroTrend??'—'} · BB {current.features?.bbPosition??'—'}</span>
     <small>{current.openedAt?.replace('T',' ').slice(0,19)} → {current.closedAt?.replace('T',' ').slice(0,19)} UTC</small>
     <b className={complete===6?'chartlab-six-ready':'chartlab-six-partial'}>{complete}/6 {lang==='pt'?'gráficos disponíveis':'charts available'}</b>
    </div>
    <div className="chartlab-toolbar">
     <label><input type="checkbox" checked={showBands} onChange={e=>setShowBands(e.target.checked)}/> Bollinger 20/2</label>
     <label><input type="checkbox" checked={showVolume} onChange={e=>setShowVolume(e.target.checked)}/> {lang==='pt'?'Volume':'Volume'}</label>
     <label><input type="checkbox" checked={showTradeLines} onChange={e=>setShowTradeLines(e.target.checked)}/> {lang==='pt'?'Preços da operação':'Trade price lines'}</label>
    </div>
    <div className="chartlab-grid">
     {timeframes.map(tf=>{
      const window=graphs.find(x=>x.timeframe===tf)
      return <Candles key={tf} bars={window?.bars??[]} title={lang==='pt'?en[tf]:labelsEn[tf]} period={tf}
       charts={current.charts} lang={lang} showBands={showBands} showVolume={showVolume} showTradeLines={showTradeLines}/>
     })}
     <div className="chartlab-journey">
      <Candles bars={current.charts?.journey?.bars??[]} title={lang==='pt'?'OPERAÇÃO COMPLETA • ENTRADA → SAÍDA':'FULL TRADE • ENTRY → CLOSE'}
       period={current.charts?.journey?.granularity??'—'} isJourney charts={current.charts}
       lang={lang} showBands={showBands} showVolume={showVolume} showTradeLines={showTradeLines}/>
      <p>{current.charts?.journey?.complete
       ?(lang==='pt'?'Período entre entrada e saída com candles concluídos; lacunas de mercado não são interpoladas.':'Completed candles inside the trade window; market closures are not interpolated.')
       :(lang==='pt'?'Trajetória incompleta ou indisponível na OANDA.':'Incomplete or unavailable OANDA trade history.')}</p>
      <p>{lang==='pt'?'Preços oficiais: ':'Broker prices: '}
       {lang==='pt'?'Entrada ':'Entry '}{current.charts?.entryPrice??'—'} · {lang==='pt'?'Saída ':'Exit '}{current.charts?.exitPrice??'—'} · Stop {current.charts?.stopPrice??'—'} · Target {current.charts?.targetPrice??'—'}</p>
     </div>
    </div>
    <p className="chartlab-disclaimer">{lang==='pt'?'Candles MID históricos da OANDA não são preços de execução. RSI e Bollinger nesta tela são indicadores descritivos, calculados dos candles disponíveis. O resultado em USD vem exclusivamente do trade fechado na OANDA. Nenhum candle ausente é inventado.':'OANDA historical MID candles are not execution fills. On-screen RSI/Bollinger are descriptive only. USD P/L comes solely from the broker-closed trade. Missing candles are never interpolated.'}</p>
   </>}</>}
 </section>
}
