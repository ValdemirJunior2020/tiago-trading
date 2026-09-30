export type Direction='long'|'short'
export type BrokerQuote={symbol:string;bid:string;ask:string;mid:string;timestamp:string}
export type AccountState={balance:string;equity:string;marginUsed:string;marginAvailable:string}
export type StrategySignal={decision:'LONG'|'SHORT'|'WAIT';confidence:number;reasons:string[]}
export type TradePlan={symbol:string;direction:Direction;referencePrice:string;hardStop:string;riskCash:string;units:string;reasons:string[]}

export type MarginMetrics={marginRequired:string;marginAvailable:string;marginAfterTrade:string;effectiveLeverage:string;lotSize:string;marginRate:string;notionalUsd:string}
