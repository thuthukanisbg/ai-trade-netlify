// functions/predict.js
// Netlify Function: AI Trade Pilot predictor (stocks + forex)
// Free Alpha Vantage endpoints + strong error checks

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/** ---------- Indicator helpers ---------- */
function SMA(arr, n) {
  const out = []; let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= n) s -= arr[i - n];
    out.push(i >= n - 1 ? s / n : null);
  }
  return out;
}
function EMA(arr, n) {
  const out = []; const k = 2 / (n + 1);
  let prev = arr[0];
  for (let i = 0; i < arr.length; i++) {
    prev = i === 0 ? arr[0] : arr[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function RSI(closes, period = 14) {
  let gains = 0, losses = 0;
  const rsi = Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains += Math.max(0, diff);
    losses += Math.max(0, -diff);
    if (i === period) {
      const avgG = gains / period, avgL = losses / period;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      rsi[i] = 100 - 100 / (1 + rs);
    } else if (i > period) {
      const d = closes[i] - closes[i - 1];
      const prevG = rsi.avgG ?? gains / period;
      const prevL = rsi.avgL ?? losses / period;
      const avgG = ((prevG * (period - 1)) + Math.max(0, d)) / period;
      const avgL = ((prevL * (period - 1)) + Math.max(0, -d)) / period;
      rsi.avgG = avgG; rsi.avgL = avgL;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }
  return rsi;
}
function MACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaF = EMA(closes, fast), emaS = EMA(closes, slow);
  const macd = closes.map((_, i) => emaF[i] - emaS[i]);
  const signalLine = EMA(macd, signal);
  const hist = macd.map((x, i) => x - signalLine[i]);
  return { macd, signal: signalLine, hist };
}

/** ---------- Simple logistic regression ---------- */
function fitLogReg(X, y, epochs = 250, lr = 0.03) {
  const n = X.length, d = X[0].length;
  let w = Array(d).fill(0), b = 0;
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  for (let ep = 0; ep < epochs; ep++) {
    let dw = Array(d).fill(0), db = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const p = sigmoid(z);
      const diff = p - y[i];
      for (let j = 0; j < d; j++) dw[j] += diff * X[i][j];
      db += diff;
    }
    for (let j = 0; j < d; j++) w[j] -= (lr * dw[j]) / n;
    b -= (lr * db) / n;
  }
  return {
    w, b,
    predictProb: (x) => {
      let z = b;
      for (let j = 0; j < x.length; j++) z += w[j] * x[j];
      return 1 / (1 + Math.exp(-z));
    }
  };
}

/** ---------- Alpha Vantage fetch (free endpoints) ---------- */
async function fetchSeries({ symbol, marketType, interval = "DAILY" }) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error("Missing ALPHA_VANTAGE_KEY env var in Netlify.");

  const useInterval = (marketType === "forex") ? "DAILY" : interval;
  let url;

  if (marketType === "forex") {
    const from = symbol.slice(0, 3);
    const to = symbol.slice(3, 6);
    url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&apikey=${key}`;
  } else {
    if (useInterval === "INTRADAY") {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&interval=60min&symbol=${symbol}&outputsize=compact&apikey=${key}`;
    } else {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${key}`;
    }
  }

  const r = await fetch(url);
  if (!r.ok) throw new Error("Network or provider error: " + r.status);
  const data = await r.json();

  if (data.Information) throw new Error("Provider message: " + data.Information);
  if (data.Note) throw new Error("Rate limit hit: " + data.Note);
  if (data["Error Message"]) throw new Error("API error: " + data["Error Message"]);

  const keyName = Object.keys(data).find(k => k.includes("Time Series"));
  if (!keyName || !data[keyName]) {
    throw new Error("No market data returned (try Daily interval or wait for rate limit).");
  }

  const rows = Object.entries(data[keyName])
    .map(([ts, ohlc]) => ({
      t: ts,
      open: +ohlc["1. open"],
      high: +ohlc["2. high"],
      low: +ohlc["3. low"],
      close: +ohlc["4. close"],
      volume: +(ohlc["6. volume"] || ohlc["5. volume"] || 0)
    }))
    .sort((a, b) => new Date(a.t) - new Date(b.t));

  if (!rows.length) throw new Error("Empty dataset (API returned no bars).");
  return rows;
}

/** ---------- Netlify handler ---------- */
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const symbol = (params.symbol || "AAPL").toUpperCase();
    const marketType = params.marketType === "forex" ? "forex" : "stock";
    const interval = (params.interval || "DAILY").toUpperCase();
    const spreadBps = Number(params.spreadBps || 5);
    const riskPct = Number(params.riskPct || 1);
    const lookback = Number(params.lookback || 180);

    const rows = await fetchSeries({ symbol, marketType, interval });
    if (!rows || !rows.length) throw new Error("No data retrieved from Alpha Vantage.");

    const slice = rows.slice(-lookback);
    const closes = slice.map(r => r.close);
    if (closes.length < 30) throw new Error("Not enough bars for analysis.");

    const sma5 = SMA(closes, 5), sma20 = SMA(closes, 20);
    const { macd } = MACD(closes);
    const rsi = RSI(closes, 14);
    const ret = closes.map((v, i) => i === 0 ? 0 : (v - closes[i - 1]) / closes[i - 1]);
    const ret5 = closes.map((v, i) => i < 5 ? 0 : (v - closes[i - 5]) / closes[i - 5]);

    const X = [], y = [];
    for (let i = 26; i < closes.length - 1; i++) {
      const f = [
        ret[i],
        ret5[i],
        (sma5[i] && sma20[i]) ? (sma5[i] / sma20[i] - 1) : 0,
        macd[i],
        rsi[i] ? (rsi[i] - 50) / 50 : 0
      ];
      const up = closes[i + 1] > closes[i] ? 1 : 0;
      X.push(f); y.push(up);
    }

    if (!X.length) throw new Error("Not enough features to train model.");

    const model = fitLogReg(X, y, 250, 0.05);
    const probUp = model.predictProb(X[X.length - 1]);
    const direction = probUp >= 0.5 ? "LONG" : "SHORT";
    const confidence = Math.round(100 * Math.abs(probUp - 0.5) * 2);

    const recentAbs = ret.slice(-20).map(Math.abs);
    const avgAbsRet = recentAbs.length ? recentAbs.reduce((a, b) => a + b, 0) / recentAbs.length : 0.005;
    const atrPct = Math.max(avgAbsRet, 0.005);
    const stopPct = atrPct * 2;

    const accountEquity = 100000;
    const riskAmount = accountEquity * (riskPct / 100);
    const lastClose = closes[closes.length - 1];
    const positionSize = Math.max(1, Math.floor(riskAmount / (stopPct * lastClose)));

    const spreadPct = spreadBps / 10000;
    const expectedEdge = (probUp - 0.5) * 2 * avgAbsRet - spreadPct;

    let pnl = 0, trades = 0, wins = 0;
    for (let i = 26; i < closes.length - 2; i++) {
      const p = model.predictProb(X[i]);
      const dir = p >= 0.5 ? 1 : -1;
      const entry = closes[i + 1];
      const exit = closes[i + 2];
      const move = (exit - entry) / entry;
      const stop = stopPct;
      let realized = dir * move;
      if (Math.abs(move) > stop) realized = -stop;
      realized -= spreadPct;
      pnl += realized;
      trades++;
      if (realized > 0) wins++;
    }
    const avgTrade = pnl / (trades || 1);
    const winRate = trades ? Math.round((wins / trades) * 100) : 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        symbol, marketType, interval,
        direction, confidence, probUp,
        positionSize, stopPct, spreadPct, expectedEdge,
        backtest: { trades, avgTrade, winRate, cumulative: pnl },
        series: slice
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
