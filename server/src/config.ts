import 'dotenv/config'
import Decimal from 'decimal.js'
import{z}from'zod'
const s=z.object({PORT:z.coerce.number().default(8787),CLIENT_ORIGIN:z.string().default('http://127.0.0.1:5173'),OANDA_ACCOUNT_ID:z.string().default(''),OANDA_API_TOKEN:z.string().default(''),OANDA_REST_BASE_URL:z.string().default('https://api-fxtrade.oanda.com'),OLLAMA_BASE_URL:z.string().default('http://127.0.0.1:11434'),OLLAMA_MODEL:z.string().default('qwen3:8b'),OLLAMA_TIMEOUT_MS:z.coerce.number().default(2000)})
export const env=s.parse(process.env)
export const LIMITS=Object.freeze({hardStop:new Decimal('0.008'),maxSlippage:new Decimal('0.001'),kill24h:new Decimal('0.03'),riskPerTrade:new Decimal('0.0025')})
