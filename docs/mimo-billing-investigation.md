# MiMo Token Plan — Billing Behaviour Investigation

**To:** Stefanus E. Prasetyo — IT Manager, Yayasan Vitka IT Department &lt;stefanus@yayasanvitka.id&gt;
**From:** Adli I. Ifkar — IT Consultant &lt;adly.shadowbane@gmail.com&gt;
**Date:** 2026-04-18
**Subject:** Unexpected credit consumption on Xiaomi MiMo Token Plan (`mimo-v2-pro`)

---

## 1. Executive Summary

The MiMo (Xiaomi) Token Plan dashboard is reporting credit consumption that is **materially higher than what raw token usage would suggest** under the pricing model most API consumers assume (Anthropic-style, where cache reads are discounted to ~0.1× of fresh input).

After reconciling proxy-side logs against the dashboard reading, and cross-referencing a third-party investigation, we conclude with high confidence that:

> **MiMo bills `cache_read_input_tokens` at the full model-tier multiplier (2× for `mimo-v2-pro`), not at a discounted cache rate.**

This has significant budgeting implications for the Max tier subscription (1.6B credits / month), because Claude Code and similar clients generate cache-read volume that is typically **5–10× larger than fresh input**. Under MiMo's billing, that volume is charged in full.

---

## 2. Observations

### 2.1 Proxy-side token totals

Data pulled from `request_logs` in the production proxy database, covering the full log window **2026-04-16 14:57 UTC → 2026-04-17 10:39 UTC** (1,892 requests, all `mimo-v2-pro`):

| Metric | Value |
|---|---|
| Fresh input + output tokens | 7,016,133 |
| Cache-creation tokens | 0 |
| Cache-read tokens | ~50,670,784 |
| **Raw total (x1)** | **57,686,917** |
| **At 2× pro multiplier (x2)** | **115,373,834** |

Cache reads account for **~88% of total token volume**.

### 2.2 Dashboard reading

At the time of measurement, the MiMo Max-tier dashboard indicated **approximately 8% of 1.6B credits consumed**, i.e. **~128M credits**.

### 2.3 Reconciliation

| Hypothesis | Predicted credits | Delta vs dashboard (~128M) |
|---|---|---|
| Pro multiplier 2× applied only to fresh input; cache reads at Anthropic-style 0.1× discount | ~14M + ~10M = ~24M | **-81%** (far too low) |
| Pro multiplier 2× applied to all tokens (fresh + cache) uniformly | ~115M | **-10%** (within normal slippage) |

Only the second hypothesis is consistent with the observed dashboard value. The residual ~10% gap is plausibly explained by requests that pre-date our logging window, requests on other endpoints, or rounding in the dashboard's percentage display.

### 2.4 Corroborating third-party report

A public account by a separate MiMo user reached the same conclusion via an independent session-level test:

> *"I did a rough calculation and saw around 6M in cached input. The sessions had 25–200k tokens in context. But the usage graph on Xiaomi dashboard showed 12M increase. So instead of 0.20$ for cached input (ie: 0.2x), there's a chance it was actually charging (2x) for every bit of token."*
>
> — r/opencodeCLI, "I think Xiaomi Token Plan charges 2x real input price for the cached input"

The 6M cached input → 12M credit increase is a clean 2× ratio, matching our finding.

---

## 3. Why This Matters

Modern Claude-compatible clients (Claude Code, OpenCode, KiloCode, etc.) aggressively use **prompt caching**: the system prompt, tool schemas, and full conversation history are marked `cache_control` and re-sent on every turn. Every turn in a session re-reads that prefix.

Under Anthropic's native pricing, this is efficient — cache reads cost ~10% of fresh tokens. Under MiMo's apparent pricing, **caching provides no cost reduction**; each turn pays the full multiplied rate for the entire replayed context.

Practical consequence for our deployment:
- A 40-turn Claude Code session with a 30K-token context prefix costs **~2.4M credits** on MiMo, versus **~240K** on Anthropic-equivalent billing — a **10× difference** for the same work.
- Our proxy's current daily quota (see `docs/daily-quota.md`) counts only `prompt_tokens + completion_tokens`, which under-reports the real MiMo cost by roughly **8×**.

---

## 4. Per-User Impact (Lifetime)

Total usage since logging began, with MiMo-equivalent credit estimate at 2× pro multiplier applied uniformly:

| User   | Requests | Fresh (in+out) | Raw total | Est. MiMo credits (x2) |
|--------|---------:|---------------:|----------:|-----------------------:|
| Rizki  |      607 |      2,244,185 | 21,656,857 |             43,313,714 |
| Heri   |      332 |      1,199,525 | 10,981,605 |             21,963,210 |
| Indra  |      344 |      1,134,705 |  8,853,105 |             17,706,210 |
| Dicky  |      128 |        819,524 |  6,427,588 |             12,855,176 |
| Elvis  |      301 |        771,226 |  5,055,130 |             10,110,260 |
| Kris   |      163 |        710,899 |  4,262,835 |              8,525,670 |
| Adly   |       14 |         81,303 |    323,287 |                646,574 |
| Stef   |        3 |         54,766 |    126,510 |                253,020 |
| **Total** | **1,892** | **7,016,133** | **57,686,917** | **115,373,834** |

---

## 5. Recommendations

### 5.1 Immediate — operational guidance to end users

Because MiMo charges cache reads at full rate, **session length is the dominant cost driver**. Users should:

1. Run `/clear` between unrelated tasks rather than letting a single session span multiple topics.
2. Run `/compact` when a session's context grows large.
3. Disable MCP servers not needed for the current project (each server's tool schemas are re-read every turn).
4. Minimise global `CLAUDE.md` content — every byte is paid for on every turn of every session.

### 5.2 Proxy-side — quota accounting changes

Update the daily-quota middleware so that `cache_read_input_tokens` and `cache_creation_input_tokens` are included in the counted total. The current accounting under-reports true MiMo cost by roughly 8× and therefore does not protect the shared Max-tier budget.

Suggested formula (reflecting what MiMo actually bills):

```
counted_tokens = prompt_tokens + completion_tokens
               + cache_creation_input_tokens
               + cache_read_input_tokens
```

No model-multiplier needs to be applied inside the proxy as long as all users are on `mimo-v2-pro` (the 2× is a constant and can be absorbed into the quota value itself).

### 5.3 Strategic — evaluate alternatives

A separate public account recommends routing the same Anthropic-compatible traffic through **OpenCode Go**, which reportedly offers `mimo-v2-pro` without the cache-read penalty. We recommend:

1. **Confirm the behaviour directly with Xiaomi support** before drawing final conclusions — request an official statement on how `cache_read_input_tokens` is billed for `mimo-v2-pro`.
2. **Run a controlled test** on OpenCode Go or a comparable alternative with an identical workload to compare effective credit burn.
3. **Re-evaluate the Max-tier subscription**. At current session patterns, 1.6B credits covers substantially less Claude Code usage than the nominal token count would suggest, and a different provider or a different subscription mix may be more cost-effective.

---

## 6. References

- r/opencodeCLI — *"I think Xiaomi Token Plan charges 2x real input price for the cached input"* — https://www.reddit.com/r/opencodeCLI/comments/1sd6rof/i_think_xiaomi_token_plan_charges_2x_real_input/
- MiMo pricing / subscription docs — https://platform.xiaomimimo.com/#/docs/tokenplan/subscription
- Internal: `docs/daily-quota.md`, `docs/request-logging.md`
- Internal: proxy production database `proxy-live.db`, table `request_logs`

---

*Prepared by Adli I. Ifkar, IT Consultant, for the Yayasan Vitka IT Department.*
