
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper to fetch from Alpha Vantage (stocks + forex)
async function fetchSeries({symbol, marketType, interval="DAILY"}){
  const key = process.env.ALPHA_VANTAGE_KEY
  if(!key) throw new Error("Missing ALPHA_VANTAGE_KEY env var in Netlify.")
  let url
  if(marketType === "forex"){
    // symbol like "EURUSD"
    const from = symbol.slice(0,3), to = symbol.slice(3,6)
    url = `https://www.alphavantage.co/query?function=FX_${interval}&from_symbol=${from}&to_symbol=${to}&apikey=${key}`
  } else {
    // stock
    const fn = interval === "INTRADAY" ? "TIME_SERIES_INTRADAY&interval=60min" : "TIME_SERIES_DAILY_ADJUSTED"
    url = `https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}&outputsize=compact&apikey=${key}`
  }
  const r = await fetch(url)
  if(!r.ok) throw new Error("Data provider error " + r.status)
  const data = await r.json()
  const seriesKey = Object.keys(data).find(k=>k.includes("Time Series"))
  if(!seriesKey) throw new Error("Unexpected response: "+JSON.stringify(data).slice(0,200))
  const rows = Object.entries(data[seriesKey]).map(([ts, ohlc])=> ({
    t: ts,
    open: +ohlc["1. open"],
    high: +ohlc["2. high"],
    low: +ohlc["3. low"],
    close: +ohlc["4. close"],
    volume: +(ohlc["6. volume"] || ohlc["5. volume"] || 0)
  })).sort((a,b)=> new Date(a.t)-new Date(b.t))
  return rows
}

function SMA(arr, n){
  const out = []; let s=0
  for(let i=0;i<arr.length;i++){
    s+=arr[i]; if(i>=n) s-=arr[i-n]
    out.push(i>=n-1 ? s/n : null)
  }
  return out
}
function EMA(arr, n){
  const out = []; const k=2/(n+1); let prev=arr[0]
  for(let i=0;i<arr.length;i++){
    prev = i===0 ? arr[0] : arr[i]*k + prev*(1-k)
    out.push(prev)
  }
  return out
}
function RSI(closes, period=14){
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
      let prevG = rsi.avgG ?? gains/period
      let prevL = rsi.avgL ?? losses/period
      let avgG = ((prevG*(period-1)) + Math.max(0,diff))/period
      let avgL = ((prevL*(period-1)) + Math.max(0,-diff))/period
      rsi.avgG = avgG; rsi.avgL = avgL
      let rs = avgL===0 ? 100 : avgG/avgL
      rsi[i] = 100 - (100/(1+rs))
    }
  }
  return rsi
}
function MACD(closes, fast=12, slow=26, signal=9){
  const emaF = EMA(closes, fast), emaS = EMA(closes, slow)
  const macd = closes.map((_,i)=> emaF[i]-emaS[i])
  const signalLine = EMA(macd, signal)
  const hist = macd.map((x,i)=> x - signalLine[i])
  return { macd, signal: signalLine, hist }
}

// Tiny logistic regression train + predict
function fitLogReg(X, y, epochs=250, lr=0.03){
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

exports.handler = async (event, context) => {
  try {
    const params = event.queryStringParameters || {}
    const symbol = params.symbol || "AAPL"
    const marketType = params.marketType || "stock" // "stock" or "forex"
    const interval = params.interval || "DAILY"
    const spreadBps = Number(params.spreadBps || 5) // configurable spread in basis points
    const riskPct = Number(params.riskPct || 1) // % of equity at risk per trade
    const lookback = Number(params.lookback || 180)

    const rows = await fetchSeries({symbol, marketType, interval})
    const closes = rows.map(r=> r.close)
    const slice = rows.slice(-lookback)
    const c = slice.map(r=> r.close)

    // build features: [ret1, ret5, sma5/sma20 -1, macd, rsi]
    const sma5 = SMA(c,5), sma20=SMA(c,20)
    const {macd, signal, hist} = MACD(c)
    const rsi = RSI(c,14)
    const ret = c.map((v,i)=> i===0?0: (v-c[i-1])/c[i-1])
    const ret5 = c.map((v,i)=> i<5?0:(v-c[i-5])/c[i-5])
    const X=[], y=[]
    for(let i=26;i<c.length-1;i++){
      const f = [
        ret[i],
        ret5[i],
        sma5[i] && sma20[i] ? (sma5[i]/sma20[i]-1) : 0,
        macd[i],
        rsi[i] ? (rsi[i]-50)/50 : 0
      ]
      const up = c[i+1] > c[i] ? 1 : 0
      X.push(f); y.push(up)
    }
    // fallback if not enough data
    if(X.length<20){
      return { statusCode: 400, body: JSON.stringify({error:"Not enough data to train", points: rows.length})}
    }
    const model = fitLogReg(X,y,250,0.05)
    const lastIdx = X.length-1
    const probUp = model.predictProb(X[lastIdx])
    const direction = probUp>=0.5 ? "LONG" : "SHORT"
    const conf = Math.round(100*Math.abs(probUp-0.5)*2) // 0..100

    // Position sizing (risk-based, ATR-lite using recent absolute returns)
    const avgAbsRet = ret.slice(-20).reduce((a,b)=>a+Math.abs(b),0)/20
    const atrPct = Math.max(avgAbsRet, 0.005)
    const stopPct = atrPct*2
    const accountEquity = 100000 // virtual; user-adjust in UI
    const riskAmount = accountEquity * (riskPct/100)
    const positionSize = Math.max(1, Math.floor(riskAmount/(stopPct * c[c.length-1])))

    // Adjust for spread
    const spreadPct = spreadBps/10000
    const expectedEdge = (probUp-0.5)*2*avgAbsRet - spreadPct

    // Backtest (very simple, next-day close with stop at 2*ATR)
    let pnl=0, trades=0, wins=0
    for(let i=26;i<c.length-2;i++){
      const p = model.predictProb(X[i])
      const dir = p>=0.5 ? 1 : -1
      const entry = c[i+1]
      const exit = c[i+2]
      const move = (exit-entry)/entry
      const stop = stopPct
      let realized = dir*move
      if(Math.abs(move)>stop){
        realized = dir * (dir>0 ? (-stop) : (-stop)) // stopped out
      }
      realized -= spreadPct
      pnl += realized
      trades++
      if(realized>0) wins++
    }
    const avgTrade = pnl/(trades||1)
    const winRate = trades? Math.round(100*wins/trades):0
    const backtest = { trades, avgTrade, winRate, cumulative: pnl }

    return {
      statusCode: 200,
      body: JSON.stringify({
        symbol, marketType, interval,
        direction, confidence: conf, probUp,
        positionSize, stopPct, spreadPct, expectedEdge,
        backtest,
        series: slice
      })
    }
  } catch (e){
    return { statusCode: 500, body: JSON.stringify({error: e.message}) }
  }
}
