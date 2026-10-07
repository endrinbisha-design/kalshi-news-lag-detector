import json, math
from fractions import Fraction as F
from math import comb, exp, log, sqrt, erf
D="2026-10-07"; P="p-20261007-"
N=lambda x:0.5*(1+erf(x/sqrt(2)))
# --- checks ---
aces=F(comb(4,2),comb(52,2))/(1-F(comb(48,2),comb(52,2))); assert aces==F(1,33)
die=F(1,2)*5+F(1,2)*F(7,2); assert die==F(17,4)
bayes=0.01*0.95/(0.01*0.95+0.99*0.10); assert abs(bayes-0.0876)<1e-3
var=3*14*49/51; sd=sqrt(var); afterK=13+2*351/51
put=6-50+50*exp(-0.05); assert abs(put-3.56)<0.005
d1=(0.02*0.25)/(0.2*0.5); bs=100*N(d1)-100*N(d1-0.1); assert abs(bs-3.99)<0.005
kelly=(2*0.4-0.6)/2; assert abs(kelly-0.1)<1e-12
mental=[("7/16 as a decimal",7/16,"0.4375"),("17% of 340",0.17*340,"57.8"),("47 × 53",47*53,"2,491"),("68²",68**2,"4,624"),
 ("355 ÷ 7",355/7,"50.71"),("5/12 as a decimal (4 places)",5/12,"0.4167"),("38 × 67",38*67,"2,546"),("12.5% of 712",0.125*712,"89"),
 ("96²",96**2,"9,216"),("1,000 ÷ 13",1000/13,"76.92")]
for q,v,a in mental:
    av=float(a.replace(",",""))
    assert abs(v-av) < 0.005 or (len(a.split(".")[-1])==4 and abs(v-av)<0.00005), (q,v,a)
problems=[
 dict(id=P+"01",topic="Probability",sub="Conditional",level=2,minutes=3,key="prob:two-cards-at-least-one-ace-both-aces",
  prompt="You draw two cards from a standard 52-card deck without replacement. Given that at least one of them is an ace, what is the probability that both are aces?",
  answer="1/33 (about 3.0%)",
  solution="P(both aces) = C(4,2)/C(52,2) = 6/1326.\nP(at least one ace) = 1 − C(48,2)/C(52,2) = 1 − 1128/1326 = 198/1326.\nConditional = 6/198 = 1/33.\nTrap: \"given the first card is an ace\" would be 3/51 = 1/17. \"At least one\" conditions on a bigger event, so the answer is smaller."),
 dict(id=P+"02",topic="Probability",sub="Expected value",level=2,minutes=3,key="prob:die-one-reroll-ev",
  prompt="You roll a fair six-sided die and are paid the face value in dollars. After seeing the first roll you may reroll once, but then you must take the second roll. What's your optimal strategy and what is the game worth?",
  answer="Reroll on 1, 2 or 3; keep 4, 5 or 6. Fair value $4.25.",
  solution="A reroll is worth 3.5 on average, so keep any roll above 3.5.\nKeep 4–6 (probability 1/2, average 5) or reroll 1–3 (probability 1/2, worth 3.5).\nValue = 0.5 × 5 + 0.5 × 3.5 = 4.25.\nFollow-up to expect: with two rerolls the threshold for the first roll becomes the value of this game, 4.25, so you keep only 5 or 6 and the game is worth (1/3)(5.5) + (2/3)(4.25) = 4.67."),
 dict(id=P+"03",topic="Probability",sub="Bayes",level=2,minutes=3,key="prob:bayes-test-1pct-95sens-90spec",
  prompt="A condition affects 1% of people. A test catches 95% of true cases (sensitivity) and correctly clears 90% of healthy people (specificity). Someone tests positive. What is the probability they have the condition?",
  answer="About 8.8% (95/1085)",
  solution="Take 10,000 people: 100 have it, 9,900 don't.\nTrue positives: 0.95 × 100 = 95. False positives: 0.10 × 9,900 = 990.\nP(condition | positive) = 95 / (95 + 990) = 95/1085 ≈ 0.0876.\nThe base rate dominates: false positives outnumber true ones about 10 to 1."),
 dict(id=P+"04",topic="Brainteasers",sub="Weighing",level=2,minutes=3,key="brain:8-coins-one-heavy-balance",
  prompt="You have 8 identical-looking coins. One is slightly heavier than the rest. Using a two-pan balance, what is the minimum number of weighings that guarantees you find the heavy coin? Describe the method.",
  answer="2 weighings",
  solution="Each weighing has three outcomes (left heavy, right heavy, balance), so k weighings separate at most 3^k cases. 3^1 = 3 < 8 ≤ 9 = 3^2, so 2 is the minimum.\nMethod: weigh 3 vs 3.\n• If one side is heavier, the coin is among those 3: weigh 1 vs 1 from that group; heavier side wins, or if they balance it's the third.\n• If they balance, it's one of the remaining 2: weigh them against each other."),
 dict(id=P+"05",topic="Market making",sub="Card sum",level=2,minutes=4,key="mm:sum-of-3-cards-ranks",
  prompt="Make me a market on the sum of the ranks of 3 cards I'm about to deal from a shuffled 52-card deck (Ace = 1, 2–10 face value, J = 11, Q = 12, K = 13).\n\nGive a bid and an offer. Say out loud why you chose that centre and that width before revealing the follow-ups.",
  followUps=["What's your fair value, and how did you get it in one line?","Roughly what's the standard deviation of the sum? How does that shape your width?","I lift your offer. Do you change your market? Why or why not?","I flip the first card: it's a King. Where's your new market?","I'll trade 10 lots instead of 1. Does your width change?"],
  answer="Fair value 21. A sensible opening market is about 19 – 23. After seeing a King, re-centre near 26.8.",
  solution="Mean rank of one card = (1 + 2 + … + 13)/13 = 7, so 3 cards average 21 (linearity of expectation; no replacement doesn't change the mean).\nSD: one card's rank variance is (13² − 1)/12 = 14. For 3 cards without replacement, Var = 3 × 14 × (52 − 3)/(52 − 1) ≈ 40.4, so SD ≈ 6.4. A 2–4 point wide market around 21 is a tight but defensible quote for a one-lot.\nLifted offer: against a counterparty with no information about the deck, keep fair value at 21. If they might know something, shade up a little and tell the interviewer why.\nFirst card is a King: the 51 cards left sum to 364 − 13 = 351, average 351/51 ≈ 6.88. New fair value = 13 + 2 × 6.88 ≈ 26.8, so quote around 25.5 – 28. The remaining uncertainty is only 2 cards now (SD ≈ 5.2).\nBigger size: widen. Your risk scales with size and you don't know their information."),
 dict(id=P+"06",topic="Options",sub="Put–call parity",level=2,minutes=3,key="opt:pcp-s50-k50-1y-r5-c6",
  prompt="A stock trades at $50 and pays no dividends. A 1-year European call struck at $50 costs $6.00. The continuously compounded risk-free rate is 5%.\n(a) What should the 1-year $50 put cost?\n(b) If the put actually trades at $4.00, what trade do you put on and what do you lock in today?",
  answer="(a) About $3.56. (b) The put is $0.44 rich: sell the put and buy the synthetic put (buy the call, short the stock, lend $47.56).",
  solution="Parity: C − P = S − K·e^(−rT).\nK·e^(−0.05) = 50 × 0.95123 = 47.56.\nP = C − S + K·e^(−rT) = 6.00 − 50 + 47.56 = 3.56.\n(b) Put at 4.00 > 3.56. Sell the put (+4.00), buy the call (−6.00), short the stock (+50.00), lend the PV of the strike (−47.56). Net cash today = +0.44. At expiry the long call plus short stock plus $50 from the loan exactly offsets the short put in every state, so the 0.44 is riskless."),
 dict(id=P+"07",topic="Options",sub="Black–Scholes estimate",level=2,minutes=3,key="opt:atm-approx-s100-vol20-3m",
  prompt="A stock is at $100. Implied volatility is 20%, rates are about zero, and there are no dividends. Estimate the price of a 3-month at-the-money call without a calculator. Then: what happens to your estimate if implied vol rises to 25%? And what is the put worth?",
  answer="About $4.00. At 25% vol about $5.00. The put is also about $4.00.",
  solution="ATM approximation: C ≈ 0.4 × S × σ × √T = 0.4 × 100 × 0.20 × √0.25 = 0.4 × 100 × 0.20 × 0.5 = 4.00.\n(The exact Black–Scholes value is 3.99. The 0.4 is 1/√(2π) ≈ 0.399.)\nAt 25% vol: 0.4 × 100 × 0.25 × 0.5 = 5.00. The ATM price is linear in vol, so vega ≈ 0.4 × S × √T = 0.20 per vol point.\nWith r = 0 and K = S, put–call parity gives P = C, so the put is also about 4.00."),
 dict(id=P+"08",topic="Betting & EV",sub="Kelly sizing",level=2,minutes=3,key="bet:kelly-2to1-p40",
  prompt="You're offered a bet that pays 2 to 1 (win $2 for every $1 staked, lose your stake otherwise). You estimate you win 40% of the time. What is your edge per dollar, and what fraction of your bankroll does the Kelly criterion say to bet?",
  answer="Edge = $0.20 per $1 staked. Kelly fraction = 10% of bankroll.",
  solution="EV per $1 = 0.4 × 2 − 0.6 × 1 = 0.20.\nKelly: f* = (b·p − q)/b = (2 × 0.4 − 0.6)/2 = 0.2/2 = 0.10.\nA useful shortcut: f* = edge / odds = 0.20 / 2.\nIn practice desks bet half Kelly or less: it gives about 3/4 of the growth rate with much smaller drawdowns, and your 40% is an estimate."),
 dict(id=P+"09",topic="Estimation",sub="Fermi",level=2,minutes=3,key="est:us-gasoline-gallons-per-day",
  prompt="Estimate how many gallons of gasoline are sold in the United States per day. Talk through your assumptions as you would to an interviewer.",
  answer="Roughly 370–380 million gallons per day (about 8.9 million barrels per day). Anything from 250 to 500 million with clean reasoning is a good answer.",
  solution="One clean path:\n• About 290 million registered vehicles; most are gasoline light vehicles.\n• About 12,000 miles per vehicle per year at about 25 mpg gives 480 gallons per vehicle per year.\n• 290M × 480 ≈ 139 billion gallons per year.\n• ÷ 365 ≈ 380 million gallons per day.\nCheck: EIA data put US motor gasoline use near 8.9 million barrels per day; × 42 gallons per barrel ≈ 374 million gallons per day.\nInterviewers grade the structure and the sanity checks more than the final digit."),
]
mm=[{"q":q,"a":a} for q,v,a in mental]
day=dict(date=D,createdAt="2026-10-07T17:45:00-05:00",updatedAt="2026-10-07T17:45:00-05:00",
 focus=["Baseline across every topic"],
 note="First set: every topic at level 2 so the next sets can find your weak spots",
 problems=problems,mental=mm,
 story=dict(prompt="Walk me through your Kalshi weather-forecasting project.",tips="In 60 seconds: the market and the edge you were after, your data and model, how you'd size a trade, one result, and what you'd do differently."),
 marketsHint="Pick one headline from this morning's tape (rates, oil, earnings, a macro print). Name the instrument, the direction, and the level or event that would make you exit.")
tot=sum(p["minutes"] for p in problems)+2+4+3+2
print("est minutes",tot, "sd",round(sd,2),"afterK",round(afterK,2))
json.dump(day,open("day.json","w"),ensure_ascii=False,indent=1)
levels={t:{"level":2,"runGot":0,"runMiss":0} for t in ["Probability","Brainteasers","Market making","Options","Betting & EV","Estimation","Sequences","Mental math"]}
json.dump(dict(lastRunAt="2026-10-07T17:45:00-05:00",lastRunSummary="Seeded the first set: 9 problems plus the mental-math drill, all topics at level 2.",focus=day["focus"],levels=levels),open("meta.json","w"),ensure_ascii=False,indent=1)
json.dump(dict(date=D,items={},marks={},revealed={},retry={}),open("results.json","w"))
print(len(json.dumps(day)),"bytes")
