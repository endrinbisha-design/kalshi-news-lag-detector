# Which source actually tells you the settlement, and when

Measured over the 58 consecutive logged KNYC days, 2026-08-01 → 09-27
(`track_record/call_log.jsonl`). **Every number below is produced by
`scripts/source_reliability.py`** — re-derived from the METAR archive on each run, never
incremented by hand. Re-run it after adding a day and paste the output; do not edit the
figures in place. As of 2026-09-17 that includes the bucket *prices* and the net P&L, which
had been typed in by hand and were wrong; the script now pulls each 17:00 candle itself and
imports `kalshi_taker_fee` rather than restating the formula.

Figures quoted **as of a particular day** — the 09-15 and 09-16 gap distributions in the
quantisation section — are deliberately frozen at what was known when the call was made,
and should not be refreshed. Everything else tracks the latest run.

This document exists because on 09-11 I claimed the preliminary CLI had beaten the
six-hour group and that "the ordering is reversed." **Tested across all 64 days, that is
wrong.** The groups are settlement-grade and the preliminary is not.

## The scoreboard

| source | available | matches settlement |
|---|---|---|
| morning group (8 AM–2 PM) | 1:51 PM | 26/64 — **41 %** |
| preliminary CLI | ~4:31–5:14 PM ‡ | 31/41 — **76 %** |
| afternoon group (2 PM–8 PM) | 7:51 PM | 55/64 — **86 %** † |
| **max of ALL same-day groups** | **7:51 PM** | **63/64 — 98 %** |

‡ **Not always.** On 2026-09-28 the preliminary was issued at **9:41 PM**, absent from
both api.weather.gov and IEM AFOS through 5:47 PM — a real absence, not a feed miss. It
still carried "VALID TODAY AS OF 0400 PM" and still counts as a preliminary. Anything that
assumes the preliminary is in hand by ~5:15 PM now has one counterexample in 41; 09-29's was back at 4:43 PM.

† **That 86 % is partly a free ride — see "The afternoon group is not always an
independent measurement" below.** On the 18 days where it repeats the morning group it
scores 18/18; on the other 46 it scores 37/46 = 80 %. **The partition behind those two
numbers is itself known to be wrong in at least one case, so treat 80 % as indicative
rather than measured.**

**That last row says "all same-day groups" for a reason, and the wording is a correction.**
It originally read "max of both groups" and was computed from the morning and afternoon
groups only. 2026-09-14 broke it: an overnight-max day settling at 75, where morning
(73.04) and afternoon (73.94) both round to 74, while the **2 AM–8 AM group reads 75.02**
and was never consulted. Across the 64 days, daytime-only would miss **two** — 08-27 and
09-14 — where all-same-day-groups misses one. The 98 % was under-specified, not wrong; two
of three available groups were going in, and no earlier day in the run stressed it.

Read the timing column before the accuracy column; these are not competing at the same
hour.

* **At 4:40 PM the preliminary is the best thing available** — 76 % against the morning
  group's 41 %. That much of the 09-11 observation survives.
* **Waiting until 7:51 PM beats it decisively.** Max of all same-day groups is 98 %. The claim that
  the preliminary supersedes the group was generalised from a single favourable day and
  does not hold.
* The one failure of max-of-all-same-day-groups is **2026-08-27**, the sensor-contamination day
  where a 9-minute spike during heavy rain entered the group and the CLI's QC rejected it
  (group 81, settled 77). That remains the only day in 64 where a group was wrong and the
  CLI right — so it is one exception, not a pattern, but it is the reason the 98 % is not
  100 %.

## The preliminary's error was a two-point distribution until 2026-09-20

**This section's headline claim is now falsified, and the falsification is the most
important thing in this document.** For twenty-seven consecutive days the error was +0 or
+1 with *nothing* elsewhere, and this section said so in bold: "Never negative. Never +2."
Day twenty-eight was a +2.

| settled − preliminary | days | share |
|---|---|---|
| **+0 °F** | 31 | **76 %** |
| **+1 °F** | 9 | **22 %** |
| **+2 °F** | **1** | **2 %** |
| negative | **0** | **0 %** |

The nine misses are 08-03, 08-17, 08-25, 08-30, 09-01, 09-03, 09-06, 09-13 (all +1) and
**09-20 (+2)**. The never-negative direction still holds at 41/41 — **but see the minimum
section below, which shows what that record does and does not protect against.**

**The +2 is a different mechanism, not a bigger version of the +1.** On 09-20 the
preliminary read 67 at 2:59 PM and the day settled at 69 **with the maximum at 7:23 PM** —
three hours and twenty-three minutes past the 4 PM validity cutoff. It was a wet, overcast
evening with rain clearing and the trace sat flat at 68.0 °F from 5:51 PM to 9:51 PM. The
eight +1 days were all cases of a max slightly exceeding a pre-cutoff value; this was the
preliminary measuring a different part of the day altogether. **Rain-clearing evenings with
warm advection are their own mode, and autumn produces more of them, not fewer.**

The split has read 63/37, 65/35, 62/38, 64/36, 65/35, 67/33, 68/32, 69/31, 70/30, 68/29/4
then **69/28/3** across eleven successive days, and has since drifted to **76/22/2** (41 preliminaries, through 10-03). Quote it from the script, never from memory — and
note that the thing which had "held across all nine" was exactly the thing that broke.

**Read this as a lesson about the shape of the claim, not just the numbers.** A
zero-mass-elsewhere result on a few dozen days is a statement that something is
*impossible*, which is far stronger than the data can carry. The honest-limits section
below predicted this in writing before it happened. The prediction was right and the
headline was still stated in bold. Distributions with hard walls should be written as
"not observed in n days" and never as "never".

So the preliminary gives a **one-sided distribution over the preliminary and the two
integers above it**, known at ~4:40 PM:

```
P(settle = preliminary)     ≈ 0.76
P(settle = preliminary + 1) ≈ 0.22
P(settle = preliminary + 2) ≈ 0.02     <- 1 day in 41, added 09-20
P(settle < preliminary)     ≈ 0        (0/41, but see the caveat below)
```

The never-below half rests on a mechanism — the preliminary can only be *beaten* by what
happens after its cutoff — so it is better supported than the upper tail, whose shape is
one observation deep beyond +1. **That mechanism is about the weather, and it does not
cover the instrument**; 09-22 showed the minimum going the forbidden way purely because the
final's QC removed a bad reading. The same could happen to a maximum. See below.

**This is still worth more than the rules built on top of it.** `SEASONAL_TRANSITION.md` documents
two rules (trace shape, 72 %; the mechanism, whose tally is now withdrawn as unmeasured —
it was scored on the snapshot feed, which cannot see the excursion it asks about) that try
to predict *which* of these two outcomes occurs, and an agreement band quoted at 84 % on
19 days. (Neither rule reasons about
anything but the afternoon, so on an overnight-max day like 09-14 both are simply mute.)
All three are attempts to
collapse a distribution that is already sharp into a point call — and all three are worse
than 100 %, so collapsing it loses information rather than adding any. For a market quoted
in whole-degree buckets the split had an obvious reading — when both integers sit inside one
bucket the bucket looked ~certain, and when they straddle a boundary the split *is* the
price. **The +2 damages the first half of that structurally, not marginally**; the next
section works out why, and what the market charges anyway.

## "Directly usable": the count was wrong, the conclusion survives

**Corrected 2026-09-16, and the error was mine.** This section previously reported that
only 4 days in 22 gave a genuine narrow-bucket certainty, and concluded that the split is
worthless because "the cases where it delivers certainty are mostly cases that were already
certain." Both the number and the reason were wrong.

The cause: `scripts/source_reliability.py` hardcoded **August's** strike ladder (`<=81` …
`>=90`) and applied it to every day. **The KXHIGHNY ladder re-centres daily.** On a cool
September day the open-ended bucket is `<=69`, not `<=81`, so a preliminary of 72–79 sat in
a normal 2-wide bucket while the script filed it under the wide one. That misclassified
**11 of 23 days** and inflated the open-ended count from 7 to 16. The script also assumed
2-wide buckets always pair `[even, even+1]`; the real ladders include `83-84` and `78-79`,
so even the parity was wrong. The script now looks the ladder up per day.

Against real ladders:

| | days | result |
|---|---|---|
| both integers in one bucket | 28/41 (68 %) | bucket correct **28/28** |
| …of which the open-ended bucket | **8** | certainty is nearly free |
| …**genuine 2-wide bucket** | **20** | **20/20 correct** |
| integers straddle a boundary | 13/41 (32 %) | majority side won **11/13** |

So the split flags a genuine narrow-bucket on **20 days in 41 — not 4 — and was right on
all twenty.** The straddle days went 11/13 to the majority side, not 2/4.

**But "near-certainty" was the wrong word, and 09-20's +2 shows why it was structurally
wrong rather than just optimistic.** A 2-wide bucket `[lo, lo+1]` can only contain both
`prelim` and `prelim+1` if `prelim == lo`. That forces `prelim+2 == lo+2`, which is
**always outside the bucket**. So a +2 error breaks *every* genuine-2-wide day, without
exception — the 14/14 record held only because no +2 had yet occurred. The right way to
state it is:

```
P(narrow bucket correct) ≈ 1 − P(+2) ≈ 0.97     (not "~certain")
```

against a market that charges 98.9 ¢. **That inverts the conclusion of this section from
"a real edge too small to trade" to "no edge at all, and possibly negative."** The 14/14 is
still 14/14; it is the forward-looking claim that changes, and it changes from
marginally-positive to marginally-negative. 09-20's own preliminary sat in the open-ended
`<=70` bucket, where +2 is harmless, which is the only reason the record is intact.

**And it is still not tradeable, for the other reason.** Pricing those twenty buckets from
the 17:00 candle on the day (now derived by the script, see below):

```
08-01  86-87  100c     08-21  79-80  100c     08-22  77-78   97c
08-23  80-81   96c     09-03  83-84   96c     09-04  84-85  100c
09-06  75-76   98c     09-11  79-80  100c     09-13  78-79   97c
09-15  72-73  100c     09-16  77-78  100c     09-17  82-83  100c
09-18  80-81  100c     09-19  69-70   99c     09-21  72-73  100c
09-23  67-68  100c     09-24  66-67   98c     09-25  69-70  100c
10-02  83-84   98c     10-03  70-71   99c
```

20/20 correct (09-27's preliminary sat in an open-ended bucket, so it is not in this list),
mean ask **98.9 ¢**, ten of them at exactly 100 ¢. Net **+1.0 % per bet**,
+$2.07 on twenty $10 stakes, before any slippage or depth check. That is `EDGE_DECAY.md`
again — the same wall `PRELIM_FALLING` hit at exactly $1.00, just a whisker above zero
instead of on it.

**Corrected 2026-09-17: this block used to be typed in by hand, and the net was wrong.**
It read "+1.1 %, +$1.13 on ten $10 stakes". Recomputed with the canonical
`kalshi_taker_fee`, those same ten days give **+$1.52** — 09-16, bought at 100 ¢,
contributes exactly nothing — so the hand figure understated the (still negligible) edge by
a third. Both the prices and the net are now produced by
`scripts/source_reliability.py`, which imports the fee function rather than retyping it —
the first draft of that code reimplemented the formula from memory, ceiled per contract
instead of per order and divided by 100 once too often, understating the fee about
thirtyfold. Sixth instance in this project of a number that was written down instead of
computed.

**And computed is not the same as correct — 2026-10-03.** The script's candle fetch caught
every exception and reported it as "no 17:00 candle", so on one run Kalshi's HTTP 429 rate
limit quietly removed 09-16 and 09-17 from the sample (n = 18 instead of 20) while the
output looked perfectly normal. The candles exist and price at 100 ¢. The fetch now retries,
pauses between calls, and raises if a non-404 error persists, so a failed fetch stops the
run instead of shrinking the denominator.

The honest summary: the two-point distribution is real, sharper than previously credited,
and identifies a single-bucket outcome on 71 % of days, of which 14 are genuine 2-wide. The
market charges 98.9 ¢ and the forward-looking hit rate is about 1 − P(+2) ≈ 97 %, so the
trade is not merely too small — it is **negative in expectation**. The measurement is sound;
the edge was an artefact of a wall that has since fallen.

## The afternoon group is not always an independent measurement

**Found 2026-09-17, by being wrong about something small.** The advance note that day
predicted the 2 PM–8 PM group would come in near 80–81, well under the morning group's
82.04. It came in at **exactly 82.04** — while every `:51` snapshot inside its own window
read 78.98 or lower, on a trace that fell monotonically from a 12:55 PM peak. No reading in
the window can produce that number.

It is not a one-off. Across the 49 days:

| | days |
|---|---|
| afternoon group **exactly equals** the morning group | **18/64** — upper bound |
| …and also exceeds every snapshot inside its own window | **13** |

Twelve exact ties, each landing precisely on the morning maximum, looked far more
consistent with **a value being carried forward** than with twelve independent brief
excursions that each recover the morning peak to the tenth of a degree.

### That inference was too quick, and 09-18 falsified it within a day

**Exact equality is not sufficient, because a double-topped day produces both symptoms
honestly.** On 09-18 the afternoon group read 26.7 °C, exactly the morning group, and
exceeded every snapshot in its own window (max 26.1 °C) — so the detector above flagged it
as carried forward. It was not: **the CLI times the peak at 2:16 PM, inside the 2 PM–8 PM
window.** The day genuinely touched 26.7 twice.

The discriminator is therefore the **CLI peak time**, not the equality:

| day | morning grp | afternoon grp | CLI peak | verdict |
|---|---|---|---|---|
| 09-17 | 27.8 | 27.8 | **12:55 PM** — outside the window | carried forward |
| 09-18 | 26.7 | 26.7 | **2:16 PM** — inside the window | genuine double top |

Consequences, stated plainly:

* **14/49 is an upper bound on carry-forward, not a measurement of it.** At least one of
  those days is genuine.
* **The 13/13 vs 27/35 split rests on that wrong partition**, so 77 % is indicative only.
* The repair works **forward only**. `actual_high_time_lst` exists from 09-16; the NWS CLI
  archive retains about a week, so August and early September can never be classified. The
  script now reports the three-way split (carried / genuine / unknown) rather than a single
  count, and it currently reads **2 / 1 / 10** (10-01 added a carried-forward case whose CLI peak time, 1:03 PM, agrees with the obs).

**Corrected 2026-09-27.** That three-way split was originally computed over *all* days where
the afternoon group equals the morning group. It should only cover the days that show the
symptom needing explanation — the group exceeding every snapshot in its own window. A day
whose afternoon group equals the morning group *and* equals a snapshot inside the afternoon
window is a benign coincidence: the maximum simply sits on the 2 PM boundary, as on 09-26,
where the 2:51 PM snapshot is itself 60.98. Classifying those inflated the carried-forward
count. The split now runs over the 12 suspicious days only, and of those exactly two have a
recorded peak time, because `actual_high_time_lst` begins on 09-16.

This possibility was written down on 09-18 *before* the evening data arrived, which is the
only reason it was tested rather than quietly absorbed into the duplicate count.

**The discriminator is downgraded to suggestive, because the CLI peak time is not just
imprecise — it can be flatly wrong.** Three strikes by 10-02:

* **09-19**: the time moved from 2:11 PM to 3:24 PM between the preliminary and the final —
  73 minutes — while the value stayed 69.
* **09-21**: *both* products report **1:00 PM**, and that is impossible on their own
  evidence. 1:00 PM lies inside the morning group's window, where the maximum was
  21.7 °C = 71.06 °F, a full degree below the 72 the same product reports. The afternoon
  group read 22.2 °C, so the real peak fell after 2 PM. The CLI mis-timed its own maximum
  by more than an hour, consistently, in both products.
* **10-02**: the preliminary timed the 83 at **1:49 PM**, inside the 8 AM–2 PM window whose
  group read 81 (27.2 °C) — impossible. The final moved it to **4:14 PM**, which the
  2–8 PM group (83) supports. Value right, time wrong by nearly two and a half hours.

**A field that can be wrong by over an hour cannot decide which side of a 2 PM boundary a
peak fell on**, which is exactly what the carried-forward-versus-double-top test asks of it.
So the carried / genuine / unknown split the script prints is *indicative only* and must not
be quoted as a measurement. Reading it from the final product does not help when both
products carry the same wrong time.

The broader observation, worth stating once: **every field in the CLI except the max and min
values has now proved unreliable** — issuance time varies over 4:31–5:14 PM (and once, 09-28, 9:41 PM), peak time can
be wrong by hours, and the preliminary's own value can miss by up to +2. The values settle
the market and are the only part that has earned trust.

**What this does and does not damage:**

* **`max of ALL same-day groups` is unaffected.** A carried-forward value is still a true
  maximum for that day, so feeding it in cannot push the estimate above the real max. The
  98 % stands exactly as measured.
* **The afternoon group's standalone 83 % is partly a free ride.** On the 13 duplicate days
  it scores **13/13** — unsurprising, since it is repeating a figure that was already the
  day's max. On the other 35 days it scores **27/35 = 77 %**. Quote 77 % when asking how
  good the afternoon group is *as a measurement*.
* **Anything inferring afternoon *behaviour* from the afternoon group is contaminated** —
  including the gap distribution behind the 09-16 call. That was checked rather than
  assumed. Excluding duplicates the distribution is **34/35 = 97 %** and the
  0.0-to-+0.5 °C wall is intact, and the nine shape-matched days behind the 09-16 call
  contain **zero** duplicates. The call survives; the statistic needed the audit regardless.

The general lesson is the one this project keeps relearning in new costume: **three
six-hour groups were being treated as three independent measurements when on roughly a
quarter of days two of them are one measurement reported twice.** `scripts/source_reliability.py`
now prints the duplicate share on every run.

## The minimum is NOT simply the mirror image — falsified 2026-09-22

**This section used to say the preliminary minimum is "never positive, but as far as
−4 °F". On 09-22 it was +4.** Preliminary 55 at 4:25 AM; final **59** at 5:00 AM.

**And it was not the weather.** The hourly stream sits flat at 59.0 °F from 3:51 AM
straight through 8:51 AM — nothing in it supports a 55. The preliminary carried a spurious
sub-hourly reading four degrees below a flat trace, and the final's QC removed it. That is
the **second documented QC rejection**, after 08-27 where a rain-driven nine-minute spike
inflated a six-hour group and the CLI threw it out.

### Why this matters for the maximum, which is the number that settles the market

Both one-sided claims in this document rest on the same mechanism: *a preliminary can only
be beaten by what happens after its cutoff*, so a max can only be too low and a min only
too high. **That argument is about meteorology. QC rejection is a separate channel, and it
runs in either direction.**

| channel | affects max | affects min | covered by the mechanism argument? |
|---|---|---|---|
| late warming / cooling after the 4 PM cutoff | too low | too high | **yes** |
| QC removing a spurious reading between products | **could go either way** | **did, +4 on 09-22** | **no** |

So the maximum's 30/30 never-negative record is protected by physics against late warming
and by **nothing at all** against a spurious high being deleted between the preliminary and
the final. 08-27 establishes that spurious highs occur at this station. The record is real;
the *guarantee* people would read into it is not. Quote it as "not observed in 30 days".

The rest of this section — the magnitudes, the radiational-cooling mode — still stands for
the weather channel, and is retained below.

## The minimum's weather channel: still the mirror image, and far worse

Every cutoff finding in this project has been about the maximum. The 4 PM validity cutoff
truncates the **minimum** window identically, so the same mechanism should apply with the
sign flipped. Measured on the nine days where both products were captured while still in
the NWS archive (it retains about a week, so this is all that can be checked):

| | error (final − preliminary) | bound |
|---|---|---|
| **maximum** | +0 on 9 days, +1 on 1 | not yet observed negative; worst **+1 °F** |
| **minimum** | 0 on 6 days, −3 on 1, −4 on 2, **+4 on 1** | **no longer one-sided** |

The weather channel is one-sided in the direction the cutoff predicts — the preliminary can only be
*beaten* by what happens after 4 PM, so its max can only be too low and its min only too
high. **But the magnitudes are not comparable.** A late max can exceed the 4 PM value by a
fraction of a degree; a clear evening can drop several degrees below the morning minimum.
Both miss days did exactly that:

```
09-11   min 70 at 10:27 AM  →  67 at 11:59 PM   (−3)
09-14   min 67 at  7:36 AM  →  63 at 11:20 PM   (−4)
09-18   min 73 at  8:04 AM  →  69 at 11:59 PM   (−4)
```

On all three, the true minimum arrived within an hour of midnight. **The fourth miss,
09-22, is not in this list because it is not a weather event** — it is the QC rejection
described at the top of this section, and it went the other way (+4). So the preliminary minimum is
**materially less trustworthy than the preliminary maximum**, and the two-point
distribution above does *not* transfer to it — a min needs a wider, one-sided spread of at
least four degrees.

**09-18 added a third miss, and it went to the −4 °F bound again.** A clear, calm evening
after a 26.7 °C afternoon: the preliminary's 73 at 8:04 AM was beaten by 69 at 11:59 PM.
That is consistent with the mechanism rather than reassuring about it — a preliminary
minimum only breaks when the sky is clear and radiational cooling runs past 11 PM, so most
days read zero and the failures are large when they come. A mean error is a useless summary
of a distribution shaped like that. Three misses in nineteen days, all in September, is
also the first direct evidence for the autumn projection below rather than an argument for
it.

This should get worse, not better, through autumn: the failure mode is hard radiational
cooling after dark, which is exactly what shorter days and drier air produce.

### 09-19: I forecast a fourth miss, said it would break the −4 bound, and was wrong

Worth recording in full because the prediction was explicit, staked in advance, and failed.
At 4:56 PM on 09-19, with the preliminary minimum at 63 °F and the 3:51 PM observation
reading 20.0 °C under CLR/FEW045, light winds, dewpoint 11.7 °C and rising pressure, I
called the final minimum at **58 °F (range 56–61), set near midnight** — and noted that at
−5 this would break the −4 °F bound in the table above.

**The final minimum was 63 °F at 7:51 AM. Error zero. The bound survives untouched.**

The cause is identifiable and it is not subtle: **cloud arrived within the hour and shut
the cooling down.**

```
15:51  FEW045   <- the observation the call was based on
16:51  OVC037
18:51  BKN035
22:51  OVC120
23:51  FEW045 SCT070 OVC110      temperature bottomed at 64.94 °F, never near 63
```

All three recorded misses had clear skies **through the night**. I substituted a 4 PM sky
for an overnight sky, which is a forecast this project has no instrument for.

**The generalisable point is the boundary of the method.** The maximum calls work because
they are claims about a *quantised, already-banked measurement* — the day's max is largely
in the bag by 4 PM and the remaining uncertainty is lattice arithmetic. This was a claim
about the weather eight hours out, dressed in the same confident format. The 09-16 entry
warns about exactly this in the opposite direction, where a correct answer arrived with a
false story attached; here the story and the answer failed together. **The preliminary
minimum's reliability is conditional on overnight cloud cover, and that condition is not
observable at 4 PM.** Until there is a cloud forecast in the pipeline, the honest position
on any given night's minimum is no position. Relevant if a
low-temperature market is ever priced from a preliminary CLI.

**n = 10, and six of those ten are not reproducible.** This table is the one place in
this document that is *not* script-derived. `prelim_low_f` only started being recorded on
09-15, so the log can independently confirm **three** days — 09-15 and 09-16 at zero error,
**09-18 at −4** and **09-22 at +4** — the two most consequential rows in the table are both
log-derived, which is the whole reason the field was added. The other six come
from a one-off reading of the NWS archive, which has since rolled over; those products are
gone and no re-derivation is possible. So the older half of this table remains a
**hand-carried counter**, the precise failure mode the rest of this document exists to
eliminate, retained only because the evidence is unrecoverable rather than merely
uncomputed. Treat the six old days as an anecdote with a direction; the three logged days
are real. The direction is unambiguous and the
magnitudes are large enough to matter, but eight days cannot pin the spread. Going forward, `prelim_low_f` should be recorded
alongside `prelim_high_f` so this can be re-derived rather than re-discovered — the
evidence expires in about a week. That field is now recorded daily, and from 09-16 the
peak and trough *times* are recorded too (`prelim_high_time_lst`, `actual_high_time_lst`),
which is what the minimum question actually turns on — both misses above were identified by
their timestamps, not their values. A year from now this table should be entirely
log-derived; today it is four-tenths so, and the logged rows are already the ones
carrying the findings.

## Quantisation beats modelling near a rounding boundary

> **Corrected 2026-09-30 — the "lattice" is whole degrees Fahrenheit, and the wall below
> was never a finding.** All **1591** KNYC hourly snapshots and six-hour groups from 08-01
> to 09-29 lie within 0.1 °F of a whole degree. The ASOS reports temperature in whole °F;
> the METAR's tenths-of-°C `T` group is that integer converted, which is why every value
> looks like 71.96 or 73.04. So:
>
> * "Nothing between 0.00 and 0.90 °F" / "nothing between +0.0 and +0.5 °C" is the step
>   from +0 °F to +1 °F. +0.5/+0.6 °C is +1 °F, +1.1/+1.2 is +2 °F, +1.6/+1.7 is +3 °F.
>   It is a property of the instrument and **cannot** be falsified by any afternoon.
> * From 09-15 to 09-29 this document and the daily calls named "a group landing in the
>   gap" as a falsifier and counted each non-occurrence as a survival. **Those eight
>   survivals carry no evidential weight** and should not be cited.
> * The rounding-boundary arithmetic ("0.44 °F below 71.5") was ceremony: the reported
>   value already is the integer that settles, barring CLI QC.
>
> What is **not** affected: every excess distribution below (they are just integer-°F
> steps), the equal/below/above conditioning, and max-of-groups. Those were always counts
> of whole-degree outcomes. The section is left as written, because the reasoning that
> got here is part of the record, but read every "lattice" as "whole °F".

The single most useful result of the run, from 2026-09-15. Three consecutive `:51`
snapshots read 71.06 °F and the day looked finished; the banked value sat **0.44 °F** below
the 71.5 rounding boundary. The gap cannot take an arbitrary value — observations are
reported in 0.1 °C, so it lands on multiples of 0.18 °F, and across the 46 days logged
**as of that morning** the afternoon-group gap distribution was:

```
0.00 ×6    0.90 ×15    1.08 ×10    1.98 ×12    2.16 ×1    3.96 ×1
```

**Nothing exists between 0.00 and 0.90.** So the outcome was strictly binary — gap 0 →
settle 71, gap ≥ 0.90 → settle 72 — with no third possibility, and 39 of 45 prior days sat
on the favourable side. Called **72 at 87 %**; the afternoon group arrived at 71.96, a gap
of exactly **+0.90**, the modal value.

Two other methods were tried first on that day and both failed:

| method | call | outcome |
|---|---|---|
| `models/post_peak` | 70–71 at 75 % raw, 55 % calibrated | wrong |
| base rate on "rising through 13:51" | 74+ at 24 % | wrong — vanished once conditioned on the flat 14:51 |
| **gap quantisation** | **72 at 87 %** | **right** |

The lesson is not that the model is bad but that **the two failures were attempts to fit
the atmosphere while the winner was a statement about the instrument.** Whenever the banked
max lands within 0.44 °F of a `.5` boundary, the meteorology is nearly irrelevant: the
question reduces to whether the gap is zero, which is a 13 % event. That is checkable in
one line and does not decay with the season.

The market held 72–73 at 80–85 ¢ (~82 %) throughout, against the 87 % above — fairly
priced, and no trade was warranted.

### 2026-09-16 repeated it, against a market that was not fairly priced

The next day gave the same setup a cleaner test. At 3:51 PM the morning group and the
3:51 snapshot were *exactly equal* at 75.92 °F (24.4 °C) — 0.58 °F below the 76.5 boundary,
so 24.5, 24.6 and 24.7 all settle 76 and only 24.8 reaches 77. Conditioning on the 3:51
snapshot rather than the final one (the statistic the 4 PM decision actually needs), the
afternoon group's excess over it across 46 days ran:

```
+0.0 ×1   +0.5 ×13   +0.6 ×7   +1.1 ×10   +1.2 ×3
+1.6 ×1   +1.7 ×6    +2.2 ×2   +2.3 ×2    +2.8 ×1     (°C)
```

Again nothing between 0.0 and +0.5, so P(≥ +0.4 °C) = **45/46**. The single exception
(09-10) is a day where the 3:51 snapshot was already *above* the morning group and was
itself the window max — structurally not the 09-16 case. On the nine days whose shape
matched (3:51 exactly equal to the morning group), the excess ran +0.5 ×5, +0.6 ×2,
+1.1 ×2, and **all nine map into the 77-78 bucket**. Called **77-78 at 82 %**.

Settled 77. The afternoon group read 25.0 °C = 77.00 °F, an excess of +0.6 °C — the second
most common value in the matched subset.

**The market was a coin flip on exactly that lattice question** and it was wrong: the 3:00
PM candle had 75-76 at 47 ¢ against 77-78 at 51 ¢, every other strike at a penny. By 4:00
PM, 77-78 was 86/92 and 75-76 had collapsed to 7/8. So unlike 09-15, the 82 % was *not*
already in the price — the board was reading the whole-degree value of the visible snapshot
("76 is banked, coin flip on one more") while the quantised sub-hourly gap made ≥ 24.8 °C
near-certain. **Two for two, and the one instance where the method disagreed with the
market, the method was right.**

**But the reasoning attached to it was wrong, and that is the part to remember.** The
advance note described the trace as still rising with the peak likely 3–4 PM, and asked
whether the afternoon *would* add ≥ 0.4 °C. It already had — the peak was **2:32 PM at 77**,
eighty minutes earlier, and it appeared in **no `:51` snapshot at all**, sitting 1.1 °C
above the 2:51 PM reading. The statistic does not care where inside the window the
excursion falls, so the 82 % stands untouched; the narrative was simply false. A story that
rides along with a correct answer is the easiest thing in this project to promote by
accident into a finding. See `SEASONAL_TRANSITION.md` for the consequence — the mechanism
rule asks a question about the continuous trace and is answered with the snapshot lattice,
so its tally is withdrawn as unmeasured rather than 77 %.

## Do not score a 4 PM call against a 3 PM quote — found 2026-09-24

**Every market comparison recorded in this project between 09-22 and 09-24 was measured
across an information gap that flattered me, and the first honest measurement reversed the
verdict.**

Kalshi's candlestick `end_period_ts` is the **end** of the period. So at 3:54 PM the newest
*complete* 60-minute candle is the one ending **15:00 local** — covering 2 PM to 3 PM. The
3:51 observation reaches the wire around 3:53 PM. **No complete candle at call time contains
it.** An advance call built on the 3:51 reading is therefore being compared against a market
that has not seen the 3:51 reading.

09-24 demonstrates the size of the effect. The same three strikes, an hour apart:

| strike | candle ending 3 PM | candle ending 4 PM | my 3:57 PM call |
|---|---|---|---|
| 65 or below | 19 / 21 | **0 / 1** | 0 % |
| 66-67 | 74 / 75 | **86 / 87** | 66 % |
| 68-69 | 4 / 6 | **12 / 13** | 33 % |

`65 or below` collapses from 19 ¢ to 0 ¢ across exactly the boundary where the 3:51
observation lands. That quote was never a mispricing; it was a price that had not yet seen
the datum which killed it.

**And on the fair comparison the market won.** Against the stale candle, 33 % on 68-69
looked like a 27-point edge over 6 ¢. Against the candle sharing my information it is 33 %
against 12–13 %, and the day settled 66. That was not an edge in the tail, it was
overweighting the tail.

**What this retires.** The 09-19 entry claimed "two for two on divergences". Re-scored
honestly, only two days had a genuine same-information disagreement: **09-16, where the
morning group was public at 1:51 PM and inside the 2–3 PM candle and the market still
priced 51 ¢ against my 82 % — that one stands** — and **09-24, which I lost.** One for two
on n = 2, which is the nothing it always was. The 09-22 and 09-23 "divergences" hinged on
the 3:51 snapshot and are latency artifacts.

Every decision not to trade was still correct. But the reason given at the time — that the
confidence intervals overlapped — was the wrong reason. The right one is that there was no
basis for believing the market wrong at all.

**Rule.** Score a 3:5x PM call against the candle **ending 16:00 local**, and label it as
incomplete at call time. Better still, do not read an advance call's edge off any candle:
by construction the market has one observation less than the call does.

**09-29, scored under that rule: lost, and the first loss from the low-probability side.**
I put 71-72 at ~15 % against the 16:00-ending candle's 5/6 ¢ (the 15:00 candle was 5/7, so
the 3:51 ob barely moved it — a genuine same-information disagreement). Settled 70. The
15 % came from a below-and-falling pool whose every hit was an August day, carried into a
late-September overcast afternoon at more than half strength because the September 0/4
was "too small to use". It was too small to use as a number; it was not too small to say
the August mass was the wrong reference class. When a pool's positive mass sits entirely
in one month, split it by month *before* shading, and let a same-season zero pull toward
the market rather than splitting the difference.

**09-30: lost again, from the other side, on the largest divergence of the run.** Equal
shape, three hourly reads of 72 from 1:51 to 3:51 PM on a clear, dry, calm afternoon. The
equal subset (consistent across August and September, so no reference-class problem this
time) put 72-73 at ~87 % and 74-75 at ~13 %; the 16:00 candle, which had the third 72, sat
at 65/67 ¢ and 32/33 ¢. **Settled 74.** The continuous trace reached 73 at 2:45 PM and 74
at 3:31 PM while the 2:51 and 3:51 obs both read 72, and the 4:51 ob read 73 — the
"plateau" was the hourly feed sampling the dips of a trace still rising after a morning
that climbed 2 °F an hour. I also declined to shade the +2 tail up on the grounds that
wet days carry the fatter tail; this was a dry day.

**The same-information record is now two wins, three losses** — 09-16 W, 09-24 L, 09-25 W,
09-29 L, 09-30 L — with the last two lost from opposite sides. The conditional pools have
been good at point estimates on quiet days. They have **not** shown that they beat the
market when the market disagrees. Until that record turns, a divergence is a reason to
doubt the pool, not an edge.

## A second zero-mass claim fell, for the same reason as the first — 2026-09-27

On 09-20 the two-point distribution's "never +2" broke. On 09-27 a second absolute claim
broke: the **equal subset had never shown a +0.0 excess** in 13 days, and day 14 was one.

The subset is days whose 3:51 PM snapshot exactly equals the morning six-hour group. Those
days had *always* gone on to exceed the group by at least +0.5 °C, and three consecutive
correct point estimates (09-22, 09-23, 09-25) rested on it. 09-27 came in at exactly +0.0.

**It is not dead, it is no longer absolute, and the difference is quantitative.** The
overall +0.0 rate is 22/58 ≈ 38 %. Zero in thirteen against that base rate has probability
0.62¹³ ≈ 0.2 %, so the effect was real and strong. One in fourteen ≈ 7 % is still far below
38 %. The correct edit is **"never" → "rarely, roughly 1 in 14"** — the identical repair the
two-point section needed a week earlier.

**Two absolute claims, one week apart, both predicted in this document's own limits
section, both stated in bold anyway.** The rule that keeps being relearned: a
zero-observation count is not zero probability. Write "not observed in n days" and carry
the interval.

### The specific error it caused, which is worth more than the tally

On 09-27 I used `0/13` as *literally zero* when forming the point estimate — and in the
same write-up, for the market comparison, used its Wilson upper bound of 24 % to argue no
edge existed. **Interval discipline applied to the market question and not to my own
forecast.** The point estimate would still have been 64, but P(63) would have been ~7 %
rather than unmentioned, and the call would not have listed `P(67+) 1 %` while omitting a
more likely outcome on the other side. State the interval on both sides or on neither.

## "Banked" means every reading, not every hourly reading — 2026-09-28

The 3:51 PM call treats the day's maximum so far as banked and asks how much more the
afternoon will add. On 09-28 the banked figure was taken as 16.1 °C, the morning group and
the 15:51 hourly snapshot. **A SPECI at 3:38 PM had already read 16.7 °C = 62.06 °F**, in
the same aviationweather response the hourly obs came from. The trace pull kept only the
`:51` rows.

So the call asked "will the day add +0.5 °C?" about something that had already happened.
It was still right — point estimate 62, settled 62, and the afternoon group came in at
exactly 16.7 °C (+0.6, on the lattice, the gap's seventh named test survived) — but it was
right about the future when the answer was already in the past. That is the 09-16 lesson
again, and this time the evidence was in a response I had fetched and not read.

Two consequences:

* **Banked = max(hourly, SPECI, groups) at call time.** SPECIs are irregular but they are
  real observations of the continuous trace.
* **The SPECI fed the six-hour group.** The group read 16.7 °C while every hourly
  snapshot in its window read 16.1. That is direct confirmation that the group reads the
  continuous trace rather than the hourly lattice, and it is how the SPECIs should be
  thought of: partial, early sightings of the value the group will report.

The conditional statistic (afternoon group minus 15:51 snapshot) is still correctly defined
on the hourly ob and is not changed by this. What changes is the question put to it: it is
the distribution of *what exceeds the 15:51 ob*, and when a SPECI has already exceeded it,
part of that distribution has been realised and must be conditioned out.

## Honest limits

* **n = 28 for the preliminary**, not 51. Twenty-three of the logged days never recorded a
  preliminary-versus-final comparison, and the NWS CLI archive retains only about a week,
  so that evidence is permanently gone. The split rests on twenty-eight days.
* ~~A two-point distribution with zero mass elsewhere on n = 27 is exactly the kind of
  clean result that gets ragged with more data.~~ **It got ragged on day 28 — see the
  section above.** This limit was written before 09-20 and called the outcome correctly,
  which is the one encouraging thing about the episode. The direction (never high) still
  holds at 28/28.
* One station, one warm season. Nothing checked at KPHX or KLAS.
* The 98 % for max-of-all-same-day-groups is what makes the 204/204 settlement reconstruction
  credible, but it is measured on the same kind of days that reconstruction used. 08-27
  shows the failure mode is sensor contamination, which autumn frontal precipitation should
  make *more* common, not less.
* **Spanning evening groups stay excluded, and 09-14 confirms that is right.** The
  8 PM 09-13 – 2 AM 09-14 group reads 75.92 °F, which rounds to 76 and exceeds the
  settlement of 75 — because that 75.92 is Sep 13's evening warmth (18:51 read 75.92),
  not Sep 14's 12:52 AM peak. The window straddles both days and belongs to neither. A
  naive "just include the evening group" fix would have returned 76 and been wrong.
* Evening groups spanning two local days are excluded throughout, per
  `six_hour_group_covers_local_day()`.
