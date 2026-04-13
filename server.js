const express = require(“express”);
const cors = require(“cors”);
const fetch = require(“node-fetch”);
const path = require(“path”);

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, “public”)));

const DS = “https://api.dexscreener.com”;

// ── Main scanner endpoint ─────────────────────────────────────────────────────
app.get(”/api/scan”, async (req, res) => {
try {
const hours = parseFloat(req.query.hours || 4);
const cutoff = hours * 3600000;
const now = Date.now();

```
// Fetch from multiple DexScreener endpoints in parallel
const [r1, r2, r3] = await Promise.allSettled([
  fetch(`${DS}/latest/dex/search?q=pump+sol`, { timeout: 8000 }),
  fetch(`${DS}/latest/dex/search?q=solana+meme`, { timeout: 8000 }),
  fetch(`${DS}/token-profiles/latest/v1`, { timeout: 8000 }),
]);

let pairs = [];

for (const r of [r1, r2]) {
  if (r.status === "fulfilled" && r.value.ok) {
    const d = await r.value.json();
    const sol = (d.pairs || []).filter(p =>
      p.chainId === "solana" &&
      p.baseToken?.address?.endsWith("pump")
    );
    pairs.push(...sol);
  }
}

// Deduplicate
const seen = new Set();
pairs = pairs.filter(p => {
  if (!p.pairAddress || seen.has(p.pairAddress)) return false;
  seen.add(p.pairAddress);
  return true;
});

// Filter by age
pairs = pairs.filter(p => {
  if (!p.pairCreatedAt) return true;
  return (now - p.pairCreatedAt) <= cutoff;
});

// Score each pair
const scored = pairs.map(p => {
  const age = p.pairCreatedAt ? (now - p.pairCreatedAt) / 60000 : 999;
  const v5 = p.volume?.m5 || 0;
  const p5 = parseFloat(p.priceChange?.m5 || 0);
  const liq = p.liquidity?.usd || 0;
  const mcap = p.fdv || p.marketCap || 0;
  const buys = p.txns?.m5?.buys || 0;
  const sells = p.txns?.m5?.sells || 0;
  const total = buys + sells;
  const buyRatio = total > 0 ? Math.round((buys / total) * 100) : 50;

  let score = 0;
  if (age < 10)        score += 35;
  else if (age < 30)   score += 20;
  else if (age < 60)   score += 10;
  if (v5 > 100000)     score += 35;
  else if (v5 > 30000) score += 20;
  else if (v5 > 5000)  score += 10;
  if (p5 > 50)         score += 25;
  else if (p5 > 20)    score += 15;
  else if (p5 > 8)     score += 8;
  if (p5 < -25)        score -= 20;
  if (buyRatio > 80 && total > 8)  score += 20;
  else if (buyRatio > 65 && total > 4) score += 10;
  if (liq >= 15000 && liq <= 800000) score += 10;
  else if (liq < 5000 && liq > 0)    score -= 15;
  if (mcap > 0 && mcap < 500000)     score += 8;

  return {
    symbol:    p.baseToken?.symbol || "???",
    name:      p.baseToken?.name   || "",
    ca:        p.baseToken?.address || "",
    pairAddr:  p.pairAddress || "",
    price:     p.priceUsd || "0",
    change5m:  p5,
    change1h:  parseFloat(p.priceChange?.h1 || 0),
    vol5m:     v5,
    vol1h:     p.volume?.h1 || 0,
    liq,
    mcap,
    buys,
    sells,
    buyRatio,
    ageMin:    Math.round(age),
    dex:       p.dexId || "pump.fun",
    url:       p.url || `https://dexscreener.com/solana/${p.pairAddress}`,
    pumpUrl:   `https://pump.fun/${p.baseToken?.address}`,
    score:     Math.min(100, Math.max(0, score)),
  };
});

// Sort by score
scored.sort((a, b) => b.score - a.score);

res.json({ pairs: scored, count: scored.length, ts: Date.now() });
```

} catch (e) {
res.status(500).json({ error: e.message });
}
});

// ── Whale activity — top movers in last 5 min ─────────────────────────────────
app.get(”/api/whales”, async (req, res) => {
try {
const r = await fetch(`${DS}/latest/dex/search?q=solana+pump`, { timeout: 8000 });
if (!r.ok) throw new Error(“DexScreener error”);
const data = await r.json();
const pairs = (data.pairs || [])
.filter(p => p.chainId === “solana” && p.baseToken?.address?.endsWith(“pump”))
.filter(p => {
const v5 = p.volume?.m5 || 0;
const buys = p.txns?.m5?.buys || 0;
const sells = p.txns?.m5?.sells || 0;
const total = buys + sells;
const buyRatio = total > 0 ? buys / total : 0;
return v5 > 20000 && buyRatio > 0.7;
})
.slice(0, 10)
.map(p => ({
symbol:   p.baseToken?.symbol || “???”,
ca:       p.baseToken?.address || “”,
vol5m:    p.volume?.m5 || 0,
change5m: parseFloat(p.priceChange?.m5 || 0),
buys:     p.txns?.m5?.buys || 0,
sells:    p.txns?.m5?.sells || 0,
pumpUrl:  `https://pump.fun/${p.baseToken?.address}`,
}));

```
res.json({ whales: pairs, ts: Date.now() });
```

} catch (e) {
res.status(500).json({ error: e.message });
}
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Whale scanner running on port ${PORT}`));
