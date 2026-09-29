# Day 19 — 2026-09-29  ·  Phase 3, Day 1 (Options drill + Merton model + Gamma exposure)

New format: **10 interview-style Black-Scholes/options questions**, then a **Merton model lesson** and a **gamma exposure lesson**, each with its own quiz. Work top-to-bottom; **answers with explanations are at the very end.**

Unless stated otherwise: European options on a non-dividend stock, continuous compounding.

---

## Part 1 — Options & Black-Scholes Drill (10 questions)

**Q1. Quick ATM price.**
S = 100, K = 100, σ = 20%, T = 1 year, r = 0. Without a calculator, roughly what is the call worth? And the put?

**Q2. Parity arb.**
S = 50, K = 50, r = 0, same expiry. The call trades at $5.00 and the put at $3.00. Is there an arbitrage? If so, what exactly do you trade, and what do you lock in?

**Q3. Delta of an ATM call.**
With r = 0, σ = 20%, T = 1, is the delta of an at-the-money-spot call exactly 0.5, above, or below? Roughly what is it, and why?

**Q4. Gamma scalping day.**
You're long an option, delta-hedged, with Γ = 0.05, on a $100 stock. Implied vol is 16% (use 256 trading days, so ~1% daily move priced in). Today the stock moves $2 and you rehedge at the close. Roughly what's your P&L for the day (gamma gain net of theta)?

**Q5. Price a digital.**
With S = 100, r = 5%, σ = 20%, T = 1, the 100-strike call is 10.45 and the 101-strike call is 9.93. Roughly what is a digital call paying $1 if S_T > 100.5 worth? What does this say about the digital's relationship to vanilla calls?

**Q6. Vega by tenor.**
S = 100, σ = 20%. Roughly how much does an ATM 1-year option gain per 1 vol point? And an ATM 1-month option? Which is more exposed to vol, and by what factor?

**Q7. Early exercise.**
Would you ever early-exercise an American call on a non-dividend-paying stock? What about an American put? Explain in one or two lines each.

**Q8. The straddle as an expected move.**
S = 100, σ = 25%, T = 3 months, r = 0. Roughly what does the ATM straddle cost, and what's the market's implied expected absolute move?

**Q9. Bound check.**
S = 100, K = 90, r = 5%, T = 1. A European call trades at $12. Is that possible? If not, what's the arbitrage?

**Q10. The theta–gamma link.**
With r = 0, a delta-hedged option has Γ = 0.02, S = 100, σ = 30%. What is its theta per year implied by the Black-Scholes PDE? Per calendar day (365)?

---

## Part 2 — Merton Model Lesson 1

### Equity as a call option on the firm (Merton, 1974)

Black-Scholes prices options on stocks. Merton turned it around: **the stock itself is an option.** This is the foundation of structural credit modeling and one of the favorite "connect the dots" questions on credit, convertibles and derivatives desks.

**1. The setup.**
A firm has assets worth **V** (following geometric Brownian motion with vol **σ_V**), financed by equity plus a single **zero-coupon bond with face F maturing at T**. At T:
- If **V_T ≥ F**: bondholders get F, shareholders keep **V_T − F**.
- If **V_T < F**: the firm defaults, bondholders take the assets V_T, and shareholders get **0** (limited liability).

**2. Equity is a call.** ⭐
Shareholders' payoff is **max(V_T − F, 0)**, which is a call on the firm's assets struck at the debt face. So

> **E = V·N(d₁) − F·e^(−rT)·N(d₂)**,  with d₁ = [ln(V/F) + (r + σ_V²/2)T] / (σ_V√T), d₂ = d₁ − σ_V√T

That's just Black-Scholes with S → V, K → F, σ → σ_V.

**3. Debt is a riskless bond minus a put.**
Bondholders get **min(V_T, F) = F − max(F − V_T, 0)**. So

> **D = F·e^(−rT) − Put(V, F)**

Risky debt means **being long a Treasury and short a put on the firm's assets to the shareholders.** That put is the value of the default option, the equity holders' right to walk away. And **V = E + D** is just put-call parity: Call + (F·e^(−rT) − Put) = V.

**4. Worked example.**
V = 100, F = 80, T = 1, r = 5%, σ_V = 20%.
- d₁ = [ln(1.25) + 0.07] / 0.20 = (0.2231 + 0.07)/0.20 ≈ **1.466**, d₂ ≈ **1.266**
- N(d₁) ≈ 0.929, N(d₂) ≈ 0.897
- **E** = 100(0.929) − 80e^(−0.05)(0.897) ≈ **$24.59**
- **D** = V − E ≈ **$75.41**. Risk-free debt would be 80e^(−0.05) = $76.10, so the **default put ≈ $0.69**.
- **Yield on the debt**: y = −ln(D/F)/T = −ln(75.41/80) ≈ 5.91% → **credit spread ≈ 91bp**.
- **Risk-neutral default probability** = P(V_T < F) = **N(−d₂) ≈ 10.3%**.

**5. Turn up the asset vol.**
Same firm, σ_V = 40%: E ≈ **$28.98** (up), D ≈ **$71.02** (down), spread ≈ **690bp**, default probability ≈ **31.5%**. The firm's total value didn't change. More risk just **transferred about $4.39 of value from bondholders to shareholders**. This is the **asset-substitution problem**: equity is long vega, debt is short vega, so shareholders of a levered firm are tempted to take on risk. (Day 23 goes deeper.)

**6. Why interviewers love it.**
- It links **equity, credit and vol** in one picture: rising equity vol and falling stock price → wider credit spreads.
- It explains why a stock close to default behaves like an **out-of-the-money option** (highly levered, high vol, convex).
- It's the basis of **KMV/Moody's EDF**, **CreditGrades**, and **capital-structure arbitrage** (Days 21–24).

**Limitations to mention (preview):** single zero-coupon debt, default only at T, assets not directly observable (we'll back them out from equity on Day 20), and short-dated spreads come out near zero, which is too low versus reality (Day 22).

**Key intuition:** equity is a call on the firm struck at the debt; debt is a Treasury minus a put. Everything else, including spreads, default probabilities and the shareholder–bondholder conflict, falls out of Black-Scholes applied to the balance sheet.

---

### Merton Quiz

**LQ1.** In the Merton model, what option is equity, and what's the underlying and strike?
**LQ2.** Write risky debt as a combination of a riskless bond and an option. Who is long the option?
**LQ3.** Which Merton-model expression gives the risk-neutral probability of default?
**LQ4.** Firm asset vol increases while V is unchanged. What happens to equity value, debt value, and the credit spread? Why is that a problem for bondholders?
**LQ5.** V = 100, F = 80, r = 5%, T = 1. Equity is worth $24.59. What is the debt worth, what is the value of the default put, and what's the approximate credit spread?

---

## Part 3 — Gamma Exposure Lesson 1

### From an option's gamma to "gamma exposure" (GEX)

You know gamma as the Greek: how much delta changes per $1 move in the stock. **Gamma exposure** takes that to the level of a whole book, or of the whole market. It asks: *when the underlying moves 1%, how many dollars of stock must the holders of these options buy or sell to stay delta-hedged?* Desks and strategists use it to reason about **hedging flows**, and interviewers increasingly ask about it ("what does it mean that dealers are short gamma?").

**1. Share gamma → dollar gamma.**
Per-share gamma Γ tells you Δ changes by Γ per $1. A 1% move is 0.01·S dollars, so per option-share delta changes by Γ·0.01·S shares, which is worth Γ·0.01·S² dollars of stock. For a position:

> **Dollar gamma (per 1% move) = Γ × S² × 0.01 × (contracts × multiplier)**

This is the standard definition of **GEX**: the dollar value of stock that must trade to rebalance the hedge after a 1% move.

*Worked example.* S = $100, Γ = 0.04 per share, you hold 10,000 contracts (× 100 = 1,000,000 option-shares).
GEX = 0.04 × 100² × 0.01 × 1,000,000 = **$4,000,000 per 1% move**.
Check it directly: a $1 (1%) move changes delta by 0.04 × 1,000,000 = 40,000 shares = $4mm at $100. ✓

**2. Sign = direction of the hedge flow.** ⭐
- **Long gamma** (you own options): the stock rises → your delta rises → you **sell** stock to re-hedge; it falls → you **buy**. You trade **against** the move: buy low, sell high.
- **Short gamma** (you sold options): the stock rises → you're shorter delta → you must **buy**; it falls → you must **sell**. You trade **with** the move: buy high, sell low.
In the example, if you were *short* those options, a 1% rally forces you to buy **$4mm** of stock, and a 1% drop forces you to sell $4mm.

**3. Why it matters beyond your own P&L.**
Recall the P&L of a hedged position: ≈ ½·Γ·(ΔS)² (long gamma gains on any move, short gamma loses). For the example, a $2 move gives ½ × 0.04 × 1,000,000 × 2² = $80,000 of gamma P&L (a gain if long, a loss if short). When the **dealers** who make markets in options are collectively on one side, their re-hedging becomes a market-wide flow:
- Dealers **net long gamma** → their hedging **dampens** moves (lower realized vol, mean reversion).
- Dealers **net short gamma** → their hedging **amplifies** moves (higher realized vol, trending, gap risk).
Lessons 2–3 build this into the market-level GEX picture and the "gamma flip".

**4. Where gamma lives: strike and expiry.**
Gamma is largest **at the money** and **near expiry**. ATM, Γ ≈ φ(d₁)/(S·σ·√T) ≈ 0.4/(S·σ·√T):
- S = 100, σ = 20%, 1 year: Γ ≈ 0.4/20 = 0.020.
- Same option with 1 week left: Γ ≈ 0.4/(100 × 0.2 × √(1/52)) ≈ 0.144, about **7× larger** (√52 ≈ 7.2).
So short-dated ATM open interest carries most of the GEX, which is why expiry weeks and 0DTE options get so much attention. Also note GEX scales with **S²**, so compare dollar gamma, not raw Γ, across underlyings.

**5. Calls and puts have the same gamma.**
At the same strike and expiry, a call and a put have identical Γ (put-call parity: their difference is linear in S). So GEX depends on **who is long or short** the options, not on whether they're calls or puts.

**Key intuition:** gamma exposure is "how many dollars of stock get traded per 1% move to stay hedged". Long gamma trades against the move and calms markets; short gamma chases it and inflates moves. It concentrates in short-dated, at-the-money strikes.

### GEX Quiz

**GQ1.** Write the formula for dollar gamma (GEX) per 1% move for an options position.
**GQ2.** You're short 5,000 contracts (multiplier 100) of an option with Γ = 0.02 on a $100 stock. What is your GEX, and what must you do if the stock rallies 1%?
**GQ3.** Explain in one sentence each why dealers who are net long gamma dampen moves and dealers who are net short gamma amplify them.
**GQ4.** An ATM option has Γ = 0.02 with 1 year left. Roughly what is its gamma with 1 month left (same vol and spot)? Why?

---
---

# ANSWERS

*(Scroll here only after attempting everything above.)*

## Part 1 — Options & Black-Scholes Drill

**A1. Call ≈ $8.00; put ≈ $8.00.**
ATM shortcut: C ≈ 0.4·S·σ·√T = 0.4·100·0.2·1 = 8.0 (exact BS: 7.97). With r = 0 and K = S, parity gives C − P = S − K = 0, so the put is the same.

**A2. Yes, lock in $2.**
Parity with r = 0: C − P = S − K = 0, but the market has C − P = 2. The call is rich relative to the put. **Sell the call, buy the put, buy the stock** (a conversion): collect 5, pay 3, pay 50 = net −48. At expiry the stock is delivered at 50 either way (the put or the short call makes sure of that), so you receive 50. **Riskless profit $2.**

**A3. Above 0.5, about 0.54.**
d₁ = [ln(S/K) + σ²T/2]/(σ√T) = σ√T/2 = 0.10 → N(0.10) ≈ 0.54. The lognormal drift term (+σ²/2) pushes d₁ positive. (With r = 5%, d₁ = 0.35 and delta ≈ 0.64.)

**A4. ≈ +$0.075.**
Gamma P&L: ½·Γ·(ΔS)² = ½·0.05·4 = $0.10. Theta is what you pay for the priced-in ~1% move ($1): ½·0.05·1² = $0.025. Net ≈ **+$0.075**. The stock moved 2× the breakeven, so you earn 4× the theta, minus the theta.

**A5. ≈ $0.52.**
The digital is the limit of a tight call spread: (C(100) − C(101))/1 = 10.45 − 9.93 = 0.52. Formally a digital = −∂C/∂K = e^(−rT)·N(d₂) (at K = 100.5 that's also ≈ 0.52). So a digital is a vertical call spread with tiny width and large notional, which is why digitals are skew-sensitive.

**A6. 1y ≈ $0.40/vol pt; 1m ≈ $0.115/vol pt; ~3.5× more for the 1-year.**
ATM vega ≈ 0.4·S·√T per unit of vol → per 1 point: 0.4·100·1·0.01 = 0.40; 1-month: 0.4·100·√(1/12)·0.01 ≈ 0.115. Vega scales with **√T**, so the ratio is √12 ≈ 3.46. (Gamma is the opposite: short-dated options carry more gamma.)

**A7. Call: never. Put: sometimes.**
Call: exercising early gives up the remaining time value and pays K earlier than needed (you lose interest on K), so the call is worth more alive (or sell it). American call = European call with no dividends. Put: deep ITM, exercising gets you K *now* and the interest on K can outweigh the small remaining optionality, so early exercise can be optimal.

**A8. ≈ $10; expected absolute move ≈ ±$10 (10%).**
Straddle ≈ 0.8·S·σ·√T = 0.8·100·0.25·0.5 = 10.0 (exact 9.97). The straddle price ≈ the market's **expected absolute move** (E|ΔS| = √(2/π)·σ√T·S ≈ 0.8σ√T·S), so ≈ ±$10 by expiry.

**A9. Not possible: lower bound is $14.39.**
C ≥ S − K·e^(−rT) = 100 − 90e^(−0.05) = 100 − 85.61 = 14.39. Trade: **buy the call at 12, short the stock at 100, invest $88** at r (it grows to $92.51). At expiry: if S_T > 90, exercise, pay 90 and return the share → keep 2.51. If S_T ≤ 90, buy the share back at S_T ≤ 90 → keep ≥ 2.51. **Riskless ≥ $2.51 at T** (= 2.39 today).

**A10. Θ = −$9/year ≈ −$0.025/day.**
With r = 0 the BS PDE gives Θ + ½σ²S²Γ = 0 → Θ = −½·0.09·10,000·0.02 = −9 per year; /365 ≈ −0.0247 per day. Long gamma means paying theta, and the PDE says exactly how much.

## Part 2 — Merton Quiz

**LA1.** A **European call on the firm's assets V**, struck at the **face value of the debt F**, expiring at the debt maturity T. Payoff max(V_T − F, 0).

**LA2.** D = F·e^(−rT) − Put(V, F, T): a riskless bond minus a put on the firm's assets. **Shareholders are long the put** (bondholders are short it). That's the limited-liability right to hand over the assets instead of paying F.

**LA3.** N(−d₂), the risk-neutral probability that V_T < F. (Under the physical measure you'd replace r with the asset's real drift μ.)

**LA4.** **Equity up, debt down, spread wider.** V is unchanged, so value just shifts from bondholders to shareholders. Equity is long a call (long vega) and debt is short a put (short vega). Bondholders are hurt because shareholders control the firm's risk-taking and gain from raising it (**asset substitution**). That's why covenants exist. (Example: σ_V 20% → 40% moves ≈ $4.39 from debt to equity, and the spread goes from ~91bp to ~690bp.)

**LA5. D ≈ $75.41; put ≈ $0.69; spread ≈ 91bp.**
D = V − E = 100 − 24.59 = 75.41. Riskless debt = 80e^(−0.05) = 76.10, so the put = 76.10 − 75.41 ≈ 0.69. Yield = −ln(75.41/80) ≈ 5.91% → spread ≈ 5.91% − 5.00% ≈ 91bp.

## Part 3 — GEX Quiz

**GA1.** GEX = Γ × S² × 0.01 × (number of contracts × multiplier): the dollars of stock traded to re-hedge per 1% move.

**GA2. −$1,000,000 per 1%; buy about $1mm of stock.**
0.02 × 100² × 0.01 × (5,000 × 100) = 0.02 × 100 × 500,000 = $1,000,000, negative because you're short. After a 1% rally your delta is 10,000 shares shorter (0.02 × $1 × 500,000), so you **buy ~10,000 shares ≈ $1mm**. You're buying into strength.

**GA3.** Long gamma: as price rises their delta grows, so they sell into rallies and buy dips, which leans against the move. Short gamma: as price rises they get shorter, so they must buy into rallies and sell into declines, which pushes in the direction of the move.

**GA4. ≈ 0.069, about 3.5× larger.**
ATM gamma scales with 1/√T: 0.02 × √12 ≈ 0.02 × 3.46 ≈ 0.069. As expiry approaches, delta for near-ATM options swings between 0 and 1 over a narrower price range.

---

*Tomorrow (Day 20): Merton Lesson 2, backing out firm value and asset vol from the observed stock price and equity vol (the two-equation system, and why equity vol = (V/E)·N(d₁)·σ_V makes levered stocks so volatile). Gamma Exposure Lesson 2: dealer positioning and market-level GEX from open interest. Day 21 is the next big cumulative quiz.*
