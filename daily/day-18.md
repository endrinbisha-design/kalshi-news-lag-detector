# Day 18 — 2026-09-29  ·  Phase 2, Day 3 (two tracks) — 🎯 BIG CUMULATIVE QUIZ DAY

Two tracks again — **Track G (generalist S&T)** and **Track D (vol trading)**. Today ends with a **big cumulative quiz (Part 5)** covering Days 16–18. Work top-to-bottom; **answers with explanations are at the very end.**

---

## Part 1 — Probability & Expected Value (6 questions)

**Q1. Roll once, re-roll once.**
You roll a fair die and are paid the face value in dollars. After seeing the first roll you may re-roll once (and must keep the second result). What is the expected payoff under optimal play?

**Q2. The rogue-trader screen.**
1% of traders in a large firm are actually breaking limits. A surveillance model flags 95% of the true offenders, but also falsely flags 10% of honest traders. A trader is flagged. What is the probability they are actually an offender?

**Q3. Pick a committee.**
A desk has 5 men and 4 women. Three people are chosen at random for a client dinner. What is the probability exactly 2 of them are women?

**Q4. The product game.**
You pay $10 to play: roll two fair dice and receive the *product* of the faces in dollars. (a) What is the expected payoff? (b) What is your edge per play? (Hint: the dice are independent.)

**Q5. Gambler's ruin.**
You start with $3 and bet $1 on a fair coin flip each round. You stop when you hit $0 or $10. (a) What is the probability you reach $10? (b) What is the expected number of flips until you stop?

**Q6. Four correlated books.**
Four positions each have daily P&L standard deviation of $10, and every pair has correlation 0.5. What is the standard deviation of the combined P&L? What would it be if they were fully independent?

---

## Part 2 — Brainteaser

**The two ropes.**
You have two ropes. Each takes exactly 60 minutes to burn from one end to the other, but they burn *unevenly* (half the rope's length does not necessarily take 30 minutes). You have a lighter. How do you measure exactly **45 minutes**?

---

## Part 3 — Track G (Generalist S&T)

### Rates & fixed income I — the yield curve, duration, DV01

Rates is the backbone of every S&T desk: it prices discounting for everything else and is where the macro views from Day 17 get expressed. Three concepts you must know cold.

**1. Price and yield move opposite.**
A bond is a stream of fixed cash flows; its price is the PV of those flows at the yield `y`. Yield up → PV down. A **zero-coupon** 5-year bond at a 4% annual yield costs `100 / 1.04⁵ = $82.19`; at 5% it costs `$78.35`; at 3%, `$86.26`. Note the asymmetry: −$3.84 on the way up, +$4.07 on the way down. That curvature is **convexity** (it's good for the holder: you gain more than you lose).

**2. Duration — the price sensitivity.**
- **Macaulay duration** = the PV-weighted average time to receive the cash flows (in years). For a **zero-coupon bond it equals its maturity**. Coupons pull it *shorter* than maturity.
- **Modified duration** = Macaulay / (1 + y). It gives the % price change per 1% (100bp) change in yield: `ΔP/P ≈ −ModDur × Δy`.

*Example:* the 5-year zero: mod dur = `5/1.04 = 4.81`. A +1% yield move → about −4.81% (actual −4.68%; the gap is convexity). A 10-year, 4% annual coupon bond priced at par (y = 4%) has Macaulay ≈ 8.44 and **modified duration ≈ 8.11**. Check: at y = 5% its price is 92.28 (−7.72%); at 3% it's 108.53 (+8.53%). The average of those, ~8.1%, matches duration. Rules of thumb: **longer maturity → higher duration; higher coupon → lower duration; higher yield → lower duration.**

**3. DV01 — dollar value of a basis point.** ⭐
`DV01 = ModDur × Price × 0.0001` (per 100 face). It's the P&L for a 1bp yield move — the unit desks actually trade and hedge in.
*Example:* 5-year zero, price 82.19, mod dur 4.81: `DV01 = 4.81 × 82.19 × 0.0001 ≈ $0.0395` per $100 face, so on $10 million face ≈ **$3,950 per bp**. The 10-year par bond: `8.11 × 100 × 0.0001 = $0.0811` per $100 → ~$8,110 per bp per $10mm.
**Hedging with DV01:** to be neutral, sell enough of the hedge instrument that the DV01s offset. Long $10mm of the 10-year (DV01 ≈ $8,110) → short about `8,110 / 3,950 ≈ 2.05` times $10mm face of 5-year zeros, i.e. ~$20.5mm.

**4. The curve, once more.**
The curve isn't just one number: **parallel shifts** move everything together (duration captures this); **steepeners/flatteners** (e.g., 2s10s) are bets on the *spread* between maturities and are typically done **DV01-neutral** so you only carry the slope view — long 2s / short 10s (DV01-weighted) is a steepener that profits if the curve steepens.

**Key intuition:** duration says *how much* a bond moves per unit of yield; DV01 says *how many dollars*; and hedging is just matching DV01s. Convexity is the second-order bonus that favors the long.

**Track G Quiz**
**GQ1.** What is the duration of a zero-coupon bond, in terms of its maturity?
**GQ2.** Modified duration is 7. Yields rise 50bp. Approximately what is the % price change?
**GQ3.** Define DV01 in one sentence.
**GQ4.** A 2s10s "steepener" — what do you do in each leg, and what should the DV01s be?

---

## Part 4 — Track D (Volatility Trading)

### Correlation & dispersion

An index is a basket, so **index variance depends on single-stock variances *and* how the stocks co-move**. That link is what dispersion trading monetizes.

**1. The index variance identity.**
For weights `wᵢ`, single-stock vols `σᵢ` and pairwise correlation ρ:

> **σ²_index = Σ wᵢ²σᵢ² + Σ_{i≠j} wᵢwⱼ ρ σᵢσⱼ**

Big index, roughly equal vols: `σ_index ≈ σ_stock × √ρ`. Correlation is the only thing separating index vol from average stock vol.

**2. Implied correlation.**
Plug *implied* vols (index and single-names) into the identity and solve for ρ: that's **implied correlation**, the market's price of co-movement.
*Example:* 4 equal-weight stocks (Σw² = 0.25), each 30% implied vol, index implied vol 20%:
`0.20² = 0.30² × (0.25 + 0.75ρ)` → `0.04/0.09 = 0.4444 = 0.25 + 0.75ρ` → **ρ ≈ 0.259**. (For a 500-stock index, use the approximation: `ρ ≈ (20/30)² ≈ 0.44`.)

**3. The dispersion trade.**
**Sell index variance/vol, buy single-name variance/vol** (usually vega-weighted). You are effectively **short implied correlation**:
- If stocks move idiosyncratically (realized correlation stays *below* implied), the single-name legs earn more than the index leg costs → profit.
- If everything moves together (correlation spikes), the index leg loses and the trade blows out — this is what happens in crashes, when correlation → 1.

**4. Why is there a premium to harvest?**
On average **implied correlation > realized correlation** — the **correlation premium**. Reason: structural demand for index puts (portfolio hedgers) and supply of single-stock calls (overwriters) inflates index implied vol relative to the single names. Dispersion sellers of correlation collect this — but it's a **short-tail-risk** trade (like selling insurance).

**5. Implementation notes.**
- **Sizing:** vega-neutral (or variance-notional weighted) between index and basket; then watch **gamma/theta** mismatches since the legs differ.
- **Costs:** trading dozens of single-name options is expensive (wide spreads), so real dispersion often uses the top names and a residual.
- **Risk:** correlation spikes, single-name event risk (earnings jumps *help* the long-single-name side but can skew the P&L), and skew differences between index and names.

**Key intuition:** index vol = f(single-name vols, correlation). If you think the market overprices correlation, short index vol against long single-name vol — and know you're paid to carry crash risk.

**Track D Quiz**
**DQ1.** In a large index with roughly equal single-stock vols σ and average correlation ρ, what is approximate index vol?
**DQ2.** Stocks' implied vol is 25%; index implied vol is 15%. Approximate implied correlation?
**DQ3.** A dispersion trade is long/short which legs, and what is it essentially short?
**DQ4.** Why does the correlation premium exist, and when does a dispersion trade lose?

---

## Part 5 — 🎯 Big Cumulative Quiz (Days 16–18, both tracks)

**Market-making & microstructure (Day 16)**
**BQ1.** You quote 99 / 101 on something with fair value 100. Uninformed flow (70%) trades at your quote and it stays at 100; informed flow (30%) trades and the price then moves $4 against you. What's your expected P&L per fill?
**BQ2.** You are long too much inventory. What do you do to your quotes, and why is that better than just dumping the position at the bid?
**BQ3.** Give two reasons you'd widen your quote and one reason you'd tighten.

**The vol surface (Day 16)**
**BQ4.** Contrast sticky-strike and sticky-delta. If spot rises and the skew slopes down, what happens to ATM vol under each?
**BQ5.** What does an inverted vol term structure signal, and what does forward vol represent?

**The macro map (Day 17)**
**BQ6.** Central bank surprises with a hike. Give the typical direction for bonds, equities, and the currency.
**BQ7.** Give the 4-part market-view pitch structure and apply it in one sentence each to "the Fed will cut next year."

**Variance swaps (Day 17)**
**BQ8.** A variance swap has strike 20² (vol points; strike variance = 400) and realized vol comes in at 25 (variance = 625). Notional is $1,000 per variance point. What do you receive if you're long? What's the payoff if realized is 15 (variance = 225)?
**BQ9.** Why is a variance swap convex in vol, and why is its strike above ATM implied?

**Rates & duration (Day 18)**
**BQ10.** A $20mm position has DV01 of $12,000. The hedge instrument has DV01 of $400 per $1mm face. How much face do you trade to hedge, and in which direction if you're long the bond?

**Correlation & dispersion (Day 18)**
**BQ11.** Index vol 18%, average stock vol 30%, large index. Implied correlation approximately?
**BQ12.** Realized correlation comes in *higher* than the implied you traded. Did the dispersion trade make or lose money, and why?

---
---

# ANSWERS

*(Scroll here only after attempting everything above.)*

## Part 1 — Probability & EV

**A1 — $4.25.**
Re-roll if the first roll is below the re-roll EV of 3.5, i.e., on 1, 2, 3. Keep 4, 5, 6. `EV = (1/6)(4+5+6) + (3/6)(3.5) = 2.5 + 1.75 = **4.25**`.

**A2 — ≈ 8.76%.**
`P = (0.01·0.95)/(0.01·0.95 + 0.99·0.10) = 0.0095/(0.0095 + 0.099) = 0.0095/0.1085 ≈ **0.0876**`. Base rates dominate: most flagged traders are honest.

**A3 — 5/14 ≈ 0.357.**
`C(4,2)·C(5,1)/C(9,3) = 6·5/84 = 30/84 = **5/14**`.

**A4 — (a) $12.25; (b) +$2.25.**
Independent dice: `E[XY] = E[X]E[Y] = 3.5 × 3.5 = 12.25`. Edge = `12.25 − 10 = **+$2.25**`.

**A5 — (a) 3/10; (b) 21 flips.**
Fair game → a martingale, so `P(reach 10) = start/target = 3/10 = **0.30**`. Expected duration for a symmetric walk is `a·b = 3 × 7 = **21**` flips (distance to each barrier multiplied).

**A6 — ≈ $31.62 vs. $20.**
`Var = 4·100 + (4·3 = 12 ordered pairs)·0.5·100 = 400 + 600 = 1000`, SD = `√1000 ≈ **$31.62**`. Independent: `√400 = **$20**`. Correlation cost you 58% more risk — the same effect dispersion trades exploit.

## Part 2 — Brainteaser

**Light rope A at both ends and rope B at one end simultaneously.**
Rope A, lit at both ends, burns out in exactly **30 minutes** (two flames cover the total burn time together regardless of unevenness). At that instant, light the *other* end of rope B — it has 30 minutes' worth of burning left, and with two flames it now finishes in **15 more minutes**. Total = **45 minutes**.

## Part 3 — Track G Quiz

**GAQ1.** Equal to its **maturity** (a single cash flow at time T).

**GAQ2.** About **−3.5%** (`−7 × 0.5%`). Prices fall.

**GAQ3.** The **dollar change in a position's value for a 1 basis point (0.01%) change in yield** — `ModDur × Price × 0.0001`.

**GAQ4.** **Long the 2-year (buy front end), short the 10-year (sell back end)**, sized **DV01-neutral** so the P&L reflects only the spread widening, not parallel moves.

## Part 4 — Track D Quiz

**DAQ1.** `σ_index ≈ σ × √ρ`.

**DAQ2.** `ρ ≈ (15/25)² = 0.36`.

**DAQ3.** **Short index variance/vol, long single-name variance/vol** — essentially **short implied correlation**.

**DAQ4.** Because index options are structurally in demand (hedgers buy index puts; overwriters sell single-name calls), implied correlation tends to exceed realized. It **loses when realized correlation spikes** (crashes, risk-off), when index legs blow out relative to single-name gains.

## Part 5 — Big Cumulative Quiz

**BA1 — −$0.20 per fill.**
Every fill earns the $1 half-spread vs. fair 100. Uninformed (70%): `+$1`. Informed (30%): you fill at 99 or 101, then the price moves $4 against you, so `+1 − 4 = −$3`. `EV = 0.7(+1) + 0.3(−3) = 0.7 − 0.9 = **−$0.20**`. The spread is too tight for this flow mix — widen.

**BA2.** **Skew both quotes down** (lower bid and ask): fewer buyers hit your bid, more customers lift your (now cheaper) offer, so inventory drains organically. Better than dumping at the bid because you avoid paying the spread and signaling/impact.

**BA3.** Widen: **high volatility, thin liquidity, large size, suspected informed flow, pending event**. Tighten: **competition/benign flow**.

**BA4.** *Sticky strike:* vol at each fixed strike is unchanged; the ATM point slides down the skew, so **ATM vol falls** when spot rises. *Sticky delta:* the smile shifts with spot, so **ATM vol is unchanged**.

**BA5.** Inversion (short-dated above long-dated) signals **near-term stress or a known event**. Forward vol is the **vol implied between two future dates**, derived from the term structure (as forward rates from the yield curve).

**BA6.** **Bonds down** (yields up), **equities down** typically, **currency up**.

**BA7.** Thesis / Drivers / Trade / Risk. E.g.: **Thesis:** the Fed cuts next year. **Drivers:** disinflation and softening labor market. **Trade:** receive 2-year rates / long front-end duration. **Risk:** an inflation re-acceleration (e.g., an energy shock).

**BA8 — $225,000 gain; −$175,000 loss.**
Realized 25: `1,000 × (625 − 400) = **+$225,000**`. Realized 15: `1,000 × (225 − 400) = **−$175,000**`. Note the convexity: +5 vol points made $225k, −5 vol points lost only $175k.

**BA9.** Variance = vol², so P&L is quadratic in vol → gains more on a vol spike than it loses on an equal drop. The strike sits above ATM because the replicating `1/K²` strip includes **high-vol OTM puts**, making fair variance a skew-weighted average (and the convexity is priced in too).

**BA10 — Short $30mm face of the hedge.**
Needed DV01 = $12,000; `12,000 / 400 = 30` → **$30mm face**. Long the bond → **short** the hedge instrument.

**BA11 — 0.36.**
`ρ ≈ (18/30)² = 0.36`.

**BA12.** **Lost money** (or at least underperformed): dispersion is short correlation; realized correlation above implied means the index leg's realized variance is higher than priced while the single-name legs don't compensate.

---

*Tomorrow (Day 19): Track G: **FX** — spot, forwards, carry, triangular relationships. Track D: **relative-value vol** — calendar spreads, skew trades, gamma-scalping P&L.*
