# Fetan Bet game mathematics (payout rule version 3)

This document records the payout formulas used by the non-Chicken-Road games.
The target theoretical return to player (RTP) for every version-3 game is
approximately **30%**.

Chicken Road 2.0 is unchanged. Its approved probability and multiplier tables
remain authoritative in `chicken-road-2-config.js`.

## Settlement conventions

All stakes and payouts are integer santim (1 ETB = 100 santim).

```
gross payout = floor(stake_santim * multiplier_cents / 100)
net winnings = gross payout - stake_santim
```

Multipliers are stored to two decimal places. A multiplier below `1.00x` is a
**partial return**, not a profit. For example, a `0.62x` result on a 100 santim
stake returns 62 santim and loses 38 santim.

RTP is the expected gross payout divided by the stake. Rounding each payout down
to a whole santim can make realized RTP slightly lower than the nominal value,
especially at the minimum 100-santim stake.

## Versioning

`PAYOUT_RULE_VERSION = 3` in `games.js`.

- **Version 3** is used for all new rounds and targets ~30% RTP.
- **Version 2** retains the previous ~92% tables.
- **Version 1** retains the legacy tables.

Long-lived rounds (Road Dash, Mines, Bingo and Penalty) record
`detail.payoutVersion` when they start. State, step, cash-out and settlement
logic reads that stored version, so an active round never changes rules
mid-round. Immediate games (Roulette, Star, Plinko, Keno) also record the
version in their round detail for audit purposes.

## Roulette

Single-zero wheel with 37 pockets.

| Bet | Winning probability | Version 3 multiplier | Contribution |
| --- | --- | --- | --- |
| Straight number | 1/37 | 11.10x | 0.300000 |
| Red/black, odd/even | 18/37 | 0.62x | 0.301622 |

The outside bet is a partial return when it wins.

## Star Spin

Three independent reels. Weights are cherry 30, lemon 25, bell 20, star 12,
seven 6 and wild 7 out of 100. Wild substitutes in three-of-a-kind combinations.

| Combination | Version 3 multiplier |
| --- | --- |
| Three cherries | 1.07x |
| Three lemons | 1.72x |
| Three bells | 2.58x |
| Three stars | 5.38x |
| Three sevens | 10.76x |
| Three wilds | 10.76x |
| Other two-or-more cherry/wild combinations | 0.33x partial return |

Enumerating all 1,000,000 weighted reel combinations gives an RTP of
**0.3005241**.

## Road Dash (legacy route)

For lane `i`, the crash chance is:

```
crash_i = min(0.99, p0 + step * (i - 1))
survival_i = product(1 - crash_j), j = 1..i
multiplier_i = round_to_nearest_santim(30 / survival_i)
```

The ladder is rounded to the nearest santim with no `1.00x` floor. Across every
difficulty and cash-out step the nominal RTP is between **0.2960** and
**0.3027**.

Version 2 keeps its old 92% ladder with the 1.00x floor. Version 1 keeps the
original ladder.

## Mines

For a grid with `N` cells, `M` mines and `k` revealed safe cells:

```
probability(k) = C(N - M, k) / C(N, k)
multiplier_cents(k) = round_to_nearest_santim(30 * C(N, k) / C(N - M, k))
```

This applies to every supported grid (3x3, 5x5, 7x7, 9x9), every mine count
and every safe-reveal count. Nominal RTP is between **0.2963** and **0.3043**
before the retained maximum-win cap.

The maximum gross win is capped at 100,000,000 santim (1,000,000 ETB). At the
minimum 100-santim stake the cap applies in 1,427 combinations; at the maximum
100,000-santim stake it applies in 2,355 combinations. The cap can only reduce
RTP, never increase it.

Version 2 uses the old integer-floor `92 * C(N, k) / C(N - M, k)` formula.
Version 1 keeps the legacy formula.

## Plinko

Each of the 8-16 row, low/medium/high base vectors is scaled bucket by bucket:

```
weight(bucket) = C(rows, bucket)
weighted_total = sum(base_cents[bucket] * weight(bucket))
target_weighted = 30 * 2^rows
version3_cents[bucket] = round_to_nearest_santim(
  base_cents[bucket] * target_weighted / weighted_total
)
```

Every bucket, including the center, is scaled. There is no reserved `1.00x`
center. Symmetry is preserved because equal buckets have equal binomial
weights. The 27 vectors have nominal RTP between **0.2970** and **0.3002**.

Version 2 retains the previous algorithm with the reserved 1.00x center and
~92% weighted return. Version 1 verification uses the original unscaled base
vectors in `PLINKO_BASE_PAYOUTS`.

## Keno

Twenty numbers are drawn from 80. For `p` picks and `h` matches:

```
probability(h) = C(20, h) * C(60, p - h) / C(80, p)
RTP = sum(probability(h) * paytable[p][h])
```

Version 3 paytable:

| Picks | Winning matches and multipliers |
| --- | --- |
| 1 | 1 hit: 1.20x |
| 2 | 2 hits: 4.99x |
| 3 | 2 hits: 0.72x; 3 hits: 14.41x |
| 4 | 2 hits: 0.53x; 3 hits: 1.79x; 4 hits: 35.74x |
| 5 | 3 hits: 1.18x; 4 hits: 7.85x; 5 hits: 164.83x |
| 6 | 3 hits: 0.64x; 4 hits: 2.55x; 5 hits: 25.49x; 6 hits: 509.87x |
| 7 | 3 hits: 0.39x; 4 hits: 1.31x; 5 hits: 6.56x; 6 hits: 84.02x; 7 hits: 1,837.98x |
| 8 | 4 hits: 0.99x; 5 hits: 3.40x; 6 hits: 28.37x; 7 hits: 482.38x; 8 hits: 2,837.52x |
| 9 | 4 hits: 0.60x; 5 hits: 1.68x; 6 hits: 12.03x; 7 hits: 120.33x; 8 hits: 962.61x; 9 hits: 7,219.55x |
| 10 | 5 hits: 1.16x; 6 hits: 5.81x; 7 hits: 58.15x; 8 hits: 465.23x; 9 hits: 2,326.17x; 10 hits: 23,261.75x |

Realized RTP by pick count is between **0.299596** and **0.300530**.
The version-2 table is retained unchanged in `KENO_PAY_V2`.

## Bingo

Payout depends on the number of drawn balls when the first line or diagonal is
completed:

| Draws | Version 3 multiplier |
| --- | --- |
| 20 or fewer | 1.26x |
| 21-30 | 0.65x |
| 31-40 | 0.32x |
| 41-50 | 0.20x |
| 51-75 | 0.12x |

The exact completed-round tier probabilities are
`[0.022874453345924528, 0.12066501614203462, 0.302091636016361,
0.36876080658678534, 0.1856080879088946]`. Weighted by the version-3
multipliers, completed-round RTP is **0.2999485**.

Version 2 tiers are `3.71/1.98/0.99/0.62/0.37`. Version 1 tiers are
`15/8/4/2.5/1.5`.

## Penalty Unlimited

The keeper dives left, center or right with equal probability. The player reads
a tell and shoots away from it. With tell accuracy `a`, optimal play gives a
goal probability of:

```
q = (1 + a) / 2
```

| Difficulty | Tell accuracy | Goal probability |
| --- | --- | --- |
| Easy | 0.82 | 0.91 |
| Medium | 0.58 | 0.79 |
| Hard | 0.34 | 0.67 |

Version 3 uses a separate ladder for each difficulty:

```
multiplier_cents(n) = round_to_nearest_santim(30 / q^n)
```

Nominal RTP at every cash-out step is between **0.2981** and **0.3017**.
The first six values are:

- Easy: `0.33, 0.36, 0.40, 0.44, 0.48, 0.53`
- Medium: `0.38, 0.48, 0.61, 0.77, 0.97, 1.23`
- Hard: `0.45, 0.67, 1.00, 1.49, 2.22, 3.32`

Payout safety caps depend on the stake. At the minimum 100-santim stake the
maximum safe step is 353 (easy), 141 (medium) and 83 (hard). At the maximum
50,000-santim stake it is 287 (easy), 115 (medium) and 67 (hard). Attempting a
goal beyond the safe step is rejected with `PAYOUT_LIMIT`; the player can still
cash out.

Versions 1 and 2 keep the legacy ladder
`0, 1.80, 3.37, 6.32, 11.86, 22.24, 41.70...` with the old recurrence.

## Real-money status

These calculations define game mathematics only. Real-money wagering must
remain disabled until legal, licensing, game-certification, age/geographic,
KYC, responsible-gaming and payment-provider approvals are documented and the
deployment mode is explicitly enabled.

The server enforces this with `WAGERING_MODE`:

- `demo` (default): virtual-credit play only.
- `real`: wallet-backed stakes are accepted only when
  `REAL_MONEY_AUTHORIZATION` contains a documented approval reference of at
  least 8 characters. Boolean/placeholder values such as `true`, `1` or
  `yes` are rejected.
- `disabled`, unknown values, or `real` without a valid authorization: new
  stakes return HTTP 403 `WAGERING_DISABLED`.

The gate applies only to new-stake requests. Active rounds can still be
continued, verified, settled or cashed out, and Chicken Road demo endpoints
remain available. Direct API calls cannot bypass the gate.
