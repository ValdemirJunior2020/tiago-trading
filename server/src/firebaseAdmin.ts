import admin from 'firebase-admin'; import {config} from './config.js';
export function getAdmin(){ if(!admin.apps.length){ const f=config.firebase; if(!f.projectId||!f.clientEmail||!f.privateKey) throw new Error('Firebase Admin is not configured'); admin.initializeApp({credential:admin.credential.cert({projectId:f.projectId,clientEmail:f.clientEmail,privateKey:f.privateKey})}); } return admin }
export function db(){ return getAdmin().firestore() }
