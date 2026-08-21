import type {Request,Response,NextFunction} from 'express'; import {getAdmin} from '../firebaseAdmin.js';
export interface AuthedRequest extends Request{uid?:string;email?:string}
export async function requireAuth(req:AuthedRequest,res:Response,next:NextFunction){ try{ const h=req.headers.authorization; if(!h?.startsWith('Bearer ')) return res.status(401).json({error:'Authentication required'}); const decoded=await getAdmin().auth().verifyIdToken(h.slice(7)); req.uid=decoded.uid; req.email=decoded.email; next(); }catch{ return res.status(401).json({error:'Invalid or expired token'}) } }
