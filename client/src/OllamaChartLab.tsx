import React,{useState} from 'react'
type Candle={time:string;open:number;high:number;low:number;close:number;volume:number}
type Lesson={tradeId:string;symbol:string;direction:'LONG'|'SHORT';realizedPL:number;outcome:string;openedAt:string;closedAt:string;
 features?:{rsi14:number;volumeRatio:number;macroTrend:string;bbPosition:string}|null;
 charts?:{beforeEntry:Candle[];beforeExit:Candle[];granularity:string}|null}
function Candles({bars,label}:{bars:Candle[];label:string}){
 const rows=(bars||[]).filter(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite)).slice(-40)
 if(rows.length<2)return <div className="chartlab-empty">Candles indisponíveis para esta janela.</div>
 const low=Math.min(...rows.map(c=>c.low)),high=Math.max(...rows.map(c=>c.high))
 const span=Math.max(high-low,0.00001),x=(i:number)=>17+i*(((620-34)/rows.length)),y=(v:number)=>15+(high-v)/span*165
 const w=Math.max(3,((620-34)/rows.length)*.58)
 return <div className="chartlab-plot"><div className="chartlab-plot-title">{label} · OANDA MID · M5 · {rows.length} candles</div>
 <svg role="img" aria-label={label+' candles M5 anteriores à marca temporal'} viewBox="0 0 620 230" preserveAspectRatio="xMidYMid meet">
  {[0,1,2,3,4].map(i=><line key={i} x1="12" y1={15+i*42} x2="605" y2={15+i*42} stroke="rgba(244,159,218,.14)" strokeDasharray="4 7"/>)}
  {rows.map((c,i)=>{const color=c.close>=c.open?'#39e6ad':'#ff6caa',cx=x(i)+w/2
   return <g key={c.time+'-'+i}><line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.6"/>
    <rect x={x(i)} y={Math.min(y(c.open),y(c.close))} width={w} height={Math.max(1.4,Math.abs(y(c.open)-y(c.close)))} fill={color} rx=".5"/></g>})}
  <text x="12" y="204" fill="#fbc7e9" fontSize="12">{rows[0]?.time.slice(0,16).replace('T',' ')}</text>
  <text x="606" y="204" textAnchor="end" fill="#fbc7e9" fontSize="12">{rows[rows.length-1]?.time.slice(0,16).replace('T',' ')}</text>
  <text x="606" y="14" textAnchor="end" fill="#fbc7e9" fontSize="12">{high.toFixed(5)}</text>
  <text x="606" y="189" textAnchor="end" fill="#fbc7e9" fontSize="12">{low.toFixed(5)}</text>
 </svg></div>
}
export default function OllamaChartLab({data,lang}:{data:any;lang:'pt'|'en'}){
 const lessons:Lesson[]=Array.isArray(data?.examples)?data.examples.filter((x:any)=>x.charts):[]
 const [selected,setSelected]=useState<string|null>(null)
 const current=lessons.find(l=>l.tradeId===selected)||lessons[0]
 return <section className="ollama-chartlab">
  <div className="chartlab-top"><div><span className="chartlab-kicker">OLLAMA • OANDA CHART LAB</span>
   <h3>{lang==='pt'?'Fábrica de gráficos do 3/4':'Shadow 3/4 chart research'}</h3>
   <p>{lang==='pt'?'Candles reais da OANDA, apenas trades Shadow vinculados e encerrados pela corretora. Verde = candle de alta; rosa = queda.':'Actual OANDA candles, only attributed broker-closed Shadow trades. Green = up candle; pink = down.'}</p>
  </div><div className="chartlab-count"><strong>{data?.chartCoverage??0}</strong><small>{lang==='pt'?'trades com gráficos':'trades with charts'}</small></div></div>
  {data?.status==='UNAVAILABLE'&&<p className="chartlab-alert">{lang==='pt'?'Pesquisa OANDA indisponível: dados podem estar desatualizados.':'OANDA research unavailable: data may be stale.'}</p>}
  {lessons.length===0?<div className="chartlab-empty">{lang==='pt'?'Aguardando trades Shadow identificados por Trade ID e candles M5. Nenhum gráfico fictício será criado.':'Waiting for broker-attributed Shadow trade IDs and M5 candles. No fictional chart data.'}</div>
   :<><div className="chartlab-trades">{lessons.map(l=><button key={l.tradeId} type="button" aria-pressed={current?.tradeId===l.tradeId} className={'chartlab-pick '+(current?.tradeId===l.tradeId?'chosen':'')} onClick={()=>setSelected(l.tradeId)}>
     #{l.tradeId} · {l.symbol.replace('_','/')} · <strong className={l.realizedPL>=0?'win':'loss'}>{l.realizedPL>=0?'+':''}{'$'+l.realizedPL.toFixed(2)}</strong></button>)}</div>
   {current&&<><div className="chartlab-details"><b>{current.symbol.replace('_','/')} · {current.direction} · {current.outcome}</b>
    <span>OANDA #{current.tradeId} · RSI {current.features?.rsi14??'—'} · Volume {current.features?.volumeRatio??'—'}× · Macro {current.features?.macroTrend??'—'} · BB {current.features?.bbPosition??'—'}</span>
    <small>{current.openedAt?.replace('T',' ').slice(0,19)} → {current.closedAt?.replace('T',' ').slice(0,19)}</small></div>
    <div className="chartlab-grid"><Candles bars={current.charts?.beforeEntry??[]} label={lang==='pt'?'ANTES DA ENTRADA':'BEFORE ENTRY'}/>
     <Candles bars={current.charts?.beforeExit??[]} label={lang==='pt'?'ANTES DO FECHAMENTO':'BEFORE CLOSE'}/></div>
    <p className="chartlab-disclaimer">{lang==='pt'?'Janelas independentes de candles MID concluídos; não representam todos os candles durante a operação nem os preços exatos de execução. Lucro/prejuízo oficial vem do trade fechado na OANDA.':'Separate windows of completed MID candles, not the full intratrade path or exact execution prices. Official P/L comes from the OANDA closed trade.'}</p>
   </>}</>}
 </section>
}
