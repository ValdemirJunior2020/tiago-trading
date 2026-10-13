import {describe,it,expect,vi,afterEach} from 'vitest'
vi.mock('../config.js',()=>({
 env:{OANDA_API_TOKEN:'test-token-not-real',OANDA_ACCOUNT_ID:'test-account',OANDA_REST_BASE_URL:'https://api-fxpractice.oanda.com'}
}))
import {OandaReadOnly,oandaAuthStatus} from './OandaReadOnly.js'

afterEach(()=>vi.unstubAllGlobals())

describe('OANDA 401 diagnostics and recovery',()=>{
 it('does not retry 401, exposes sanitized diagnostic and recovers on later successful reads',async()=>{
  const broker=new OandaReadOnly()
  let calls=0
  vi.stubGlobal('fetch',vi.fn(async()=>{
   calls++
   if(calls===1)return{status:401,ok:false,json:async()=>({errorMessage:'Unauthorized'})}
   return{status:200,ok:true,json:async()=>({account:{balance:'100000',unrealizedPL:'0',marginUsed:'0',marginAvailable:'100000'}})}
  }))
  await expect(broker.account()).rejects.toThrow('OANDA_HTTP_401')
  expect(calls).toBe(1)
  const bad=oandaAuthStatus()
  expect(bad.state).toBe('AUTH_FAILED')
  expect(bad.actionRequired).toBe(true)
  expect(bad.lastErrorCode).toBe('OANDA_HTTP_401')
  expect(JSON.stringify(bad)).not.toContain('test-token-not-real')
  await expect(broker.account()).resolves.toMatchObject({balance:'100000'})
  expect(calls).toBe(2)
  expect(oandaAuthStatus()).toMatchObject({state:'RECOVERED',actionRequired:false,lastErrorCode:null})
 })
})
