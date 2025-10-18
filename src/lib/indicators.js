
// Simple TA indicators and a tiny logistic regression for direction prediction
export function SMA(series, period){
  const out = Array(series.length).fill(null)
  let sum = 0
  for(let i=0;i<series.length;i++){
    sum += series[i]
    if(i>=period) sum -= series[i-period]
    if(i>=period-1) out[i] = sum/period
  }
  return out
}
export function EMA(series, period){
  const out = Array(series.length).fill(null)
  const k = 2/(period+1)
  let prev = series[0]
  out[0] = prev
  for(let i=1;i<series.length;i++){
    const v = series[i]*k + prev*(1-k)
    out[i] = v; prev = v
  }
  return out
}
export function RSI(closes, period=14){
  let gains=0, losses=0
  const rsi = Array(closes.length).fill(null)
  for(let i=1;i<closes.length;i++){
    const diff = closes[i]-closes[i-1]
    gains += Math.max(0,diff)
    losses += Math.max(0,-diff)
    if(i===period){
      let avgG = gains/period, avgL = losses/period
      let rs = avgL===0 ? 100 : avgG/avgL
      rsi[i] = 100 - (100/(1+rs))
    } else if(i>period){
      const diff = closes[i]-closes[i-1]
      let avgG = ((rsi.avgG ?? gains/period)*(period-1) + Math.max(0,diff))/period
      let avgL = ((rsi.avgL ?? losses/period)*(period-1) + Math.max(0,-diff))/period
      rsi.avgG = avgG; rsi.avgL = avgL
      let rs = avgL===0 ? 100 : avgG/avgL
      rsi[i] = 100 - (100/(1+rs))
    }
  }
  return rsi
}
export function MACD(closes, fast=12, slow=26, signal=9){
  const emaFast = EMA(closes, fast)
  const emaSlow = EMA(closes, slow)
  const macd = closes.map((_,i)=> (emaFast[i]!=null && emaSlow[i]!=null) ? emaFast[i]-emaSlow[i] : null)
  const macdVals = macd.map(x=> x==null?0:x)
  const signalLine = EMA(macdVals, signal)
  const hist = macd.map((x,i)=> x==null||signalLine[i]==null? null : x - signalLine[i])
  return { macd, signal: signalLine, hist }
}

// Tiny logistic regression (binary up/down) trained with gradient descent
export function fitLogReg(X, y, epochs=300, lr=0.03){
  const n = X.length, d = X[0].length
  let w = Array(d).fill(0), b = 0
  const sigmoid = z=> 1/(1+Math.exp(-z))
  for(let ep=0; ep<epochs; ep++){
    let dw = Array(d).fill(0), db = 0
    for(let i=0;i<n;i++){
      let z = b
      for(let j=0;j<d;j++) z += w[j]*X[i][j]
      let p = sigmoid(z)
      const diff = p - y[i]
      for(let j=0;j<d;j++) dw[j] += diff*X[i][j]
      db += diff
    }
    for(let j=0;j<d;j++) w[j] -= lr*dw[j]/n
    b -= lr*db/n
  }
  return { w, b, predictProb: (x)=>{
    let z = b
    for(let j=0;j<x.length;j++) z += w[j]*x[j]
    return 1/(1+Math.exp(-z))
  }}
}
