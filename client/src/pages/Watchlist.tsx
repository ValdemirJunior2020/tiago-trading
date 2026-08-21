import {useEffect,useState} from 'react';
import {doc,onSnapshot,setDoc} from 'firebase/firestore';
import {auth,firestore} from '../firebase';
import {Link} from 'react-router-dom';

type Item={symbol:string;market:'stock'|'crypto'|'forex'};
export function Watchlist(){
  const [items,setItems]=useState<Item[]>([]);
  useEffect(()=>{const u=auth.currentUser;if(!u)return;return onSnapshot(doc(firestore,'watchlists',u.uid),s=>setItems((s.data()?.symbols||[]) as Item[]))},[]);
  async function remove(item:Item){const u=auth.currentUser;if(!u)return;const next=items.filter(x=>!(x.symbol===item.symbol&&x.market===item.market));await setDoc(doc(firestore,'watchlists',u.uid),{symbols:next},{merge:true})}
  return <><header className="pageHead"><div><span className="eyebrow">Saved in Firebase</span><h1>Watchlist</h1><p>Your saved stocks, crypto and forex symbols.</p></div></header><section className="panel">{!items.length?<div className="empty"><h3>Your watchlist is empty.</h3><p>Open an asset and tap “Add to watchlist”.</p><Link to="/markets">Browse markets</Link></div>:items.map(x=><div className="row" key={`${x.market}:${x.symbol}`}><Link to={`/market/${encodeURIComponent(x.symbol)}?market=${x.market}`}><strong>{x.symbol}</strong><small>{x.market.toUpperCase()}</small></Link><button className="ghostDanger" onClick={()=>remove(x)}>Remove</button></div>)}</section></>
}
