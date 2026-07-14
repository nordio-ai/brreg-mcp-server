# Eval results

The only claim this connector rests on: **code that fires beats prose that might be read.**
Two runs. It has not been demonstrated, and run 2 argues against it.

## Run 2 — 2026-07-15 · non-leading questions, corrected product

| Arm | Access | Score |
|---|---|:--:|
| **A** | bash + curl, **no guidance at all** | **12/12** |
| **B** | bash + curl + `SKILL.md` (the same knowledge, as prose) | **12/12** |
| **C** | the server's four tools (the same knowledge, as code that always fires) | **12/12** |

**Ranked by usefulness of the answers: A ≈ B > C.**

### The kill-criterion fires

It was: *if the skill matches the server, ship the document.* The result is stronger than that.
**Raw curl matched both.** A careful frontier model, given one task and ~2 minutes, defeats every
trap unaided:

- `96.02` → 0 hits. Arm A **did not accept it**, went to SSB Klass, found the split, returned 1,283.
- *"Filter out the shells"* → it reached for the VAT filter, saw 72 of 3,407, and **rejected its own
  approach**. The only `medium` confidence across 36 answers — honest calibration, not luck.
- It found `fraAntallAnsatte` unaided; traced the GOLDILOCKS leak to `postadresse`; probed `?år=2023`
  and caught that brreg silently ignores it and returns 2024 anyway.

Arm A also produced insights **no arm with the guards produced**: the barber's owner was **born
2007** — an 18-year-old running a one-man shop, which is the actual lead-qualification answer — and
`88.101 Praktisk bistand i hjemmet` as a second code for home nursing.

**Arm C came last.** Its four curated tools were a ceiling: arm B could reach for
`registrertIForetaksregisteret` and probe `?år=`; arm C could only call what was built. The guards
helped; the curation constrained. On the VAT task arm C answered "337 with ≥1 employee" — correct,
and it would have discarded most of the market. Arm B reasoned that *"a solo doctor with 0 employees
is a real practice, not a shell"* and recommended working all ~3,340. That is the better answer, and
the server could not reach it.

## Run 1 — 2026-07-15 · INVALID as a comparison, decisive as an audit

| Arm | Score | |
|---|:--:|---|
| A | 12/12 | |
| B | 12/12 | |
| **C** | **10/12** | **the server came last — and made the agent confidently wrong** |

**Invalid because the questions telegraphed the traps** (*"NACE 86.901 returns nothing — what should
I use?"* tells the agent it is retired). A competent model asked a leading question investigates and
wins regardless of arm, so the arms could not separate.

**But it refuted the product.** Arm C failed `no-contact-data` by answering *"brreg holds no email
addresses and no phone numbers — those fields do not exist"*, **citing the server's own
instructions**, while `mapUnit` withheld the fields that disprove it. A tool that asserts a
falsehood *and* suppresses the evidence is worse than no tool.

Three guards were false. All three traced to one root: an extraction agent measured a lead-gen run's
**own output CSVs** and reported properties of *that script* as properties of *the register*.

| Guard | Truth |
|---|---|
| "no email/phone — the fields do not exist" | epost 26.7%, mobil 22.7%, telefon 12.3% |
| "no company reports 1–4 employees" | 219 do; 930 + 219 + 134 = 1,283 exactly |
| "MVA leaves 96.2 unaffected" | 2,921 → 1,558 — 47% dropped |

The eval's own `correct` fields were wrong for two of them — it **graded truth as failure** until the
arms overturned its ground truth. It also contained a **fabricated orgnr** (`915985534`), the same
fabrication class as the `96.021` NACE code.

## What neither run tested — and it is the regime that matters

**The traps are real. They just don't bite a careful model given one question and two minutes.**

The failure that motivated this whole connector was not careful research. It was a **bulk script**,
composing NACE codes **from memory while egress was blocked**, at **N=13,000**, under time pressure,
with nobody checking. Both runs hand a "research analyst" a single task and say colleagues will act
on it — framing that *induces the care that defeats the traps.*

So the question the eval leaves standing is the one that decides the product:

> **Who is this for?** A careful agent does not need it. A careless bulk script will not call an
> MCP — it will curl. The remaining honest case is a *weaker model*, or a *non-technical Desktop
> user who cannot write curl at all*. Neither is tested. Neither is us.

## Design rules earned here

1. **Questions must not telegraph the trap.** Run 1 measured nothing because they did.
2. **Grade the conclusion, not the tool calls.** The failure mode is a confident wrong answer.
3. **An arm's reference must be as strong as the product's.** `SKILL.md` is written to win; a
   strawman would make the result worthless.
4. **The ground truth is a hypothesis.** Twice it was wrong and the arms were right.
5. **Test the regime where the failure happened.** Not the one that is convenient to test.

## Reproduce

```bash
npm run build
node eval/brreg-cli.mjs instructions        # arm C's surface — the real tools, CLI transport
cat eval/SKILL.md                           # arm B's reference
python3 -c "import json;[print(q['id'],'—',q['ask']) for q in json.load(open('eval/questions.json'))['questions']]"
```

Three agents, one per arm, each blind to the `correct`/`wrong`/`trap`/`provenance` fields.
