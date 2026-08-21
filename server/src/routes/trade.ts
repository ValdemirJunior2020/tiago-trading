import {Router} from 'express';
import {z} from 'zod';
import Decimal from 'decimal.js';
import {db} from '../firebaseAdmin.js';
import {requireAuth,type AuthedRequest} from '../middleware/auth.js';
import {marketService} from '../market/service.js';
import {normalizedLeverage,validateOrder,livePnL} from '../trading/engine.js';
import {FieldValue} from 'firebase-admin/firestore';

export const tradeRouter=Router();
tradeRouter.use(requireAuth);

const schema=z.object({
  symbol:z.string().min(1),
  market:z.enum(['stock','crypto','forex']),
  direction:z.enum(['long','short']),
  quantity:z.string(),
  leverage:z.string().default('1'),
  stopLoss:z.string().nullable().optional(),
  takeProfit:z.string().nullable().optional()
});

async function settlePosition(uid:string,id:string,exitPrice:string,reason:'manual'|'stop-loss'|'take-profit'){
  const ref=db().collection('positions').doc(uid).collection('items').doc(id);
  const walletRef=db().collection('wallets').doc(uid);
  const tradeRef=db().collection('trades').doc(uid).collection('items').doc();
  let result={pnl:'0'};
  await db().runTransaction(async tx=>{
    const [pos,wallet]=await Promise.all([tx.get(ref),tx.get(walletRef)]);
    if(!pos.exists||pos.data()?.status!=='open') throw new Error('Open position not found');
    const p:any=pos.data(); const wd:any=wallet.data();
    const pnl=livePnL(p.direction,p.entryPrice,exitPrice,p.quantity);
    const balance=new Decimal(wd.virtualBalance).plus(pnl);
    const bp=new Decimal(wd.buyingPower).plus(p.marginUsed).plus(pnl);
    const totalPnL=new Decimal(wd.totalPnL).plus(pnl);
    tx.update(walletRef,{virtualBalance:balance.toString(),buyingPower:bp.toString(),portfolioValue:balance.toString(),totalPnL:totalPnL.toString(),totalReturnPercent:totalPnL.div(10000).mul(100).toString(),updatedAt:FieldValue.serverTimestamp()});
    tx.update(ref,{status:'closed',currentPrice:exitPrice,unrealizedPnL:pnl.toString(),closedAt:new Date().toISOString(),closeReason:reason});
    tx.set(tradeRef,{...p,positionId:ref.id,exitPrice,pnl:pnl.toString(),closedAt:new Date().toISOString(),closeReason:reason});
    result={pnl:pnl.toString()};
  });
  return result;
}

tradeRouter.post('/open',async(req:AuthedRequest,res,next)=>{try{
  const input=schema.parse(req.body); const uid=req.uid!;
  const quote=await marketService.quote(input.symbol,input.market);
  const lev=normalizedLeverage(input.market,input.leverage);
  const walletRef=db().collection('wallets').doc(uid);
  const posRef=db().collection('positions').doc(uid).collection('items').doc();
  await db().runTransaction(async tx=>{
    const w=await tx.get(walletRef); if(!w.exists) throw new Error('Virtual account not initialized');
    const data=w.data()!; const {margin}=validateOrder({price:quote.price,quantity:input.quantity,leverage:lev.toString(),buyingPower:data.buyingPower});
    const price=new Decimal(quote.price);
    if(input.stopLoss){const sl=new Decimal(input.stopLoss); if(input.direction==='long'&&sl.gte(price))throw new Error('Long Stop Loss must be below entry price'); if(input.direction==='short'&&sl.lte(price))throw new Error('Short Stop Loss must be above entry price')}
    if(input.takeProfit){const tp=new Decimal(input.takeProfit); if(input.direction==='long'&&tp.lte(price))throw new Error('Long Take Profit must be above entry price'); if(input.direction==='short'&&tp.gte(price))throw new Error('Short Take Profit must be below entry price')}
    const bp=new Decimal(data.buyingPower).minus(margin);
    tx.update(walletRef,{buyingPower:bp.toString(),updatedAt:FieldValue.serverTimestamp()});
    tx.set(posRef,{symbol:input.symbol,market:input.market,direction:input.direction,quantity:input.quantity,entryPrice:quote.price,currentPrice:quote.price,unrealizedPnL:'0',stopLoss:input.stopLoss||null,takeProfit:input.takeProfit||null,leverage:lev.toString(),marginUsed:margin.toString(),status:'open',openedAt:new Date().toISOString()});
  });
  res.json({ok:true,positionId:posRef.id,executionPrice:quote.price,updatedAt:quote.updatedAt});
}catch(e){next(e)}});

tradeRouter.post('/close/:id',async(req:AuthedRequest,res,next)=>{try{
  const uid=req.uid!, ref=db().collection('positions').doc(uid).collection('items').doc(req.params.id);
  const pos=await ref.get(); if(!pos.exists||pos.data()?.status!=='open') return res.status(404).json({error:'Open position not found'});
  const p:any=pos.data(); const quote=await marketService.quote(p.symbol,p.market);
  const result=await settlePosition(uid,ref.id,quote.price,'manual');
  res.json({ok:true,pnl:result.pnl,exitPrice:quote.price});
}catch(e){next(e)}});

tradeRouter.get('/positions',async(req:AuthedRequest,res,next)=>{try{
  const uid=req.uid!; const snaps=await db().collection('positions').doc(uid).collection('items').where('status','==','open').get();
  const rows:any[]=[];
  for(const d of snaps.docs){
    const p:any=d.data();
    try{
      const q=await marketService.quote(p.symbol,p.market); const current=new Decimal(q.price);
      const hitStop=p.stopLoss && (p.direction==='long'?current.lte(p.stopLoss):current.gte(p.stopLoss));
      const hitTarget=p.takeProfit && (p.direction==='long'?current.gte(p.takeProfit):current.lte(p.takeProfit));
      if(hitStop||hitTarget){await settlePosition(uid,d.id,q.price,hitStop?'stop-loss':'take-profit');continue}
      rows.push({id:d.id,...p,currentPrice:q.price,unrealizedPnL:livePnL(p.direction,p.entryPrice,q.price,p.quantity).toString(),priceFreshness:q.freshness,priceUpdatedAt:q.updatedAt});
    }catch{rows.push({id:d.id,...p,priceFreshness:'CACHED'})}
  }
  res.json(rows);
}catch(e){next(e)}});
