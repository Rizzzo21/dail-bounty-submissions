# OPEN_REMAINDER.md — precisely what this artefact does NOT establish

This file exists to make the boundary impossible to miss. Every item below
is either genuinely open in mathematics, or open *in this artefact* (i.e.
we cite it rather than prove it). Nothing here is a deficiency hidden
elsewhere: `CLAIMS.md` and `PROOF.md` say the same thing.

---

## 1. The general BSD conjecture — **OPEN, and untouched here**

The Birch–Swinnerton-Dyer conjecture for an elliptic curve `E/ℚ` of rank `r`
asserts

```
    L^(r)(E,1)/r!  =  Omega_E * Reg_E * prod_p c_p * #Sha(E) / #E(Q)_tors^2
```

with the correct regulator convention. **This is open.** It is one of the
seven Clay Millennium Prize Problems.

This artefact verifies the **rank-0 leading coefficient** for **one**
curve, `E : y² = x³ − x`. A single verified instance:

* does not constitute a proof of a universal statement;
* does not constitute a counterexample to anything;
* carries **no** information about curves of positive rank, about the
  analytic rank equalling the algebraic rank in general, about the
  regulator, about the odd-primary part of `Sha`, or about any of the
  other six Millennium Prize Problems.

**This is not a solution of the Millennium Prize Problem, and it is not a
partial solution of it in any sense that a mathematician would recognise.**
It is a rigorous, reproducible, honest special case.

## 2. The odd-primary part of `Sha(E)` — **CITED here, not proved here**

`#Sha(E) = 1` is used as an input in §6 of `PROOF.md`. Its justification:

* **CITED:** Cremona's `ecdata` tables (`allbsd`, `curvedata`) record the
  Sha order for 32a2 as `1`.
* **CITED + COMPUTED for the 2-part:** `src/sha2.py` certifies that
  `Sha(E)[2] = 0`, using PARI/GP's `ellrank` output `[0, 0, 0, []]` and the
  documented identity `C = T + R + S` (so `S = R_upper − R_true = 0`).
  The inference itself is validated on PARI's *own* worked example
  `ellinit([-113²,0])`, where it predicts the 2-rank (2) that PARI's manual
  states for that curve. Note that the third component `s = 0` **cannot** be
  used for this: PARI's manual shows `s = 0` for that same example, whose
  `Sha` is `(ℤ/4ℤ)²` and hence nontrivial. The classical descent for the
  congruent-number curve `E_1` (see `PROOF.md` §2) settles the same part
  by hand.

**We do not prove the odd-primary part is trivial, and we do not claim to.**
A reader who wants the identity to be a theorem rather than a numerical
consistency check must supply that citation independently.

## 3. The closed forms — **CITED here, numerically verified only**

```
    Omega_E  = Gamma(1/4)^2 / sqrt(2*pi)
    L(E,1)   = Gamma(1/4)^2 / (8*sqrt(2*pi))  =  Omega_E / 8
```

These are classical (Chowla–Selberg). We do not derive them. What we do is
**verify** them: both of our independent certified routes for `Ω_E` and the
certified `L(E,1)` agree with these closed forms to 45+ digits, and PARI
agrees to 60 digits. Numerical agreement at 45 digits is a very strong check
on the *numerics*; it is not a proof of the *formula*.

## 4. The newform identification — **CITED here, verified only in effect**

That `f(z) = η(4z)²η(8z)²` is the newform of level 32 attached to `E`, and
that the Fricke eigenvalue is `λ = −1`, are classical facts. Our
verification is that the coefficients computed from the eta product agree,
for every `n ≤ 400`, with the coefficients computed independently by point
counting plus the Hecke relations. That is strong evidence and it also
rules out transcription errors; it is not a derivation of the modularity
of `E`.

The `λ = −1` deduction in `PROOF.md` §5.1 *is* proved (from the cited eta
transformation formula), and it is additionally cross-checked by PARI's
`ellrootno = 1` and by the fact that the resulting `L(E,1)` reproduces
PARI's independent `ellL1` to 47 digits.

## 5. What a single case cannot distinguish

Even if every number here were computed perfectly, the identity
`L(E,1)·16 = Ω_E·2` for this one curve is satisfied by BSD **and** by any
other formula that happens to agree with BSD here. Numerics on one curve
have a vanishingly small power to discriminate between competing
formulations. We therefore make **no** claim of the form "this supports
BSD over its rivals".

## 6. Genuinely open mathematics that this artefact does not touch

* BSD in general; the analytic rank formula; the regulator.
* The finiteness and structure of `Sha` in general; the Cassels–Tate
  pairing.
* The odd-primary part of `Sha` for this curve (item 2).
* Whether the "real period" convention used by one database matches
  another's for curves where `E(ℝ)` has a different number of components
  (for *this* curve it is settled by three independent sources — see
  `PROOF.md` §1.1 — but the general bookkeeping is a known source of
  published errors, and we flag it rather than assume it).

## 7. The honest bottom line

The value of this artefact is:

1. a **self-contained proof** of `E(ℚ) = E[2](ℚ)` by infinite descent;
2. a **certified, cross-checked** computation of every other ingredient,
   with proved error bounds and **two independent algorithms** for the
   period;
3. an explicit, machine-checked guard against the single most likely
   error (the period convention);
4. a **precise statement** of the open remainder, in this file.

That is a real, checkable piece of mathematics — and it is a *special
case*, not a breakthrough.
