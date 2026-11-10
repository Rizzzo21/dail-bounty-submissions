# CLAIMS.md — every claim in this artefact, and its exact status

One row per claim. The **Status** column is the whole point of this file:
a reader must be able to tell, without reading the code, exactly which
statements are proved here, which are computed with certified bounds, which
are quoted from the literature, and which are open.

Legend:
- **PROVED** — self-contained argument in `PROOF.md`, checkable from this
  repository alone.
- **COMPUTED** — produced by a script in `src/`, with a proved error bound,
  and cross-checked against at least one independent implementation.
- **CITED** — a classical published result, quoted with its reference; not
  re-proved here.
- **OPEN** — not established here, and (in the general case) not known.

---

## A. The curve

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| A1 | `E : y² = x³ − x` has minimal model `[0,0,0,-1,0]` | PROVED | direct | PARI `ellidentify` → `32a2`; Cremona `allcurves` |
| A2 | `E` is Cremona **32a2**, LMFDB **32.a3** | COMPUTED | `data/ecdata-32a2.txt` | PARI `ellidentify`; Cremona `alllabels` |
| A3 | `Δ_min = 64`, `c₄ = 48`, `c₆ = 0`, `j = 1728`, `N = 32` | PROVED | `src/tate.py` (exact integers) | PARI `ellglobalred`, `ellminimalmodel`; Cremona `curvedata` |
| A4 | 2 is the only bad prime | PROVED | `Δ_min = 64 = 2⁶` | PARI `ellglobalred` |

> Note on A2: **LMFDB's label for this curve is `32.a3`, not `32.a2`.**
> LMFDB and Cremona order isogeny classes differently, so LMFDB's `32.a2`
> is the *different* curve `[0,0,0,-11,14]` (Cremona 32a4). Getting this
> label wrong points a reader at the wrong curve.

## B. The arithmetic side

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| B1 | `E(ℚ) = {O,(0,0),(1,0),(−1,0)}` | **PROVED** | `PROOF.md` §2 (Fermat's infinite descent, in full) | PARI `ellrank` → `[0,0,0,[]]`, `elltors` → `[4,[2,2],…]`; Cremona `allcurves` |
| B2 | `rank E(ℚ) = 0` | PROVED (from B1) | `PROOF.md` §2 | PARI `ellrank` (r = R = 0) |
| B3 | `E(ℚ)_tors ≅ (ℤ/2)²`, `#E(ℚ)_tors = 4` | PROVED (from B1) | `PROOF.md` §2 | PARI `elltors`; Cremona `allcurves` |
| B4 | No rational right triangle has area 1 | PROVED | `PROOF.md` §2.1 | classical (Fermat) |

## C. The local side

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| C1 | Kodaira type at 2 is **III** | COMPUTED | `src/tate.py` | PARI `elllocalred` code `3` = III; Ogg's formula gives `m = 2` components, which is III, whereas `I_0*` has 5 and would force conductor 4 |
| C2 | `c₂ = 2`, hence `∏ₚ cₚ = 2` | COMPUTED | `src/tate.py` | PARI `elllocalred(E,2)[3] = 2`, `ellglobalred` `[[5,3,0,2]]`; Cremona `allbsd` Tamagawa product `2` |
| C3 | `f₂ = 5` | COMPUTED | `src/tate.py` | PARI `elllocalred(E,2)[0] = 5` |

> Note on C1: the label `I_0*` appears in some tables for this curve and is
> **inconsistent with Ogg's formula** here (it would force conductor 4, not
> 32). The Tamagawa number — the only quantity entering the BSD identity —
> is 2 under either label.

## D. The analytic side

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| D1 | `f(z) = η(4z)²η(8z)²` is the newform of level 32 for `E` | CITED + COMPUTED | `src/a_n.py` | coefficients computed **twice** (point counting vs eta product) and asserted equal for all `n ≤ 400` |
| D2 | Fricke eigenvalue `λ = −1` | PROVED (from the CITED eta transformation) | `PROOF.md` §5.1 | PARI `ellrootno = 1` and `λ = −w`; and the resulting `L(E,1)` matches PARI `ellL1` |
| D3 | `L(E,1) = 0.65551438857302995261620989747277985342068873785…` | COMPUTED | `src/lvalue.py`, certified interval of width 4.02e-48 | PARI `ellL1` at 60 digits — agrees to 47 digits |
| D4 | `Ω_E = ∫_{E(ℝ)}|ω| = 5.2441151085842396209296791797822388273655099028…` | COMPUTED | `src/period.py`, **three independent routes** (AGM, hypergeometric series, theta series), certified width 9.98e-48 | PARI `Γ(1/4)²/√(2π)` at 60 digits; Cremona `curvedata` real period |
| D5 | `Ω_E` is the period over the **full real locus** (both components), i.e. `= 2 ×` the identity-component period | PROVED + COMPUTED | `PROOF.md` §1.1 | PARI `ellbsd` = `ellL1`; Cremona `allbsd` real period `5.244…` vs 32a1's `2.622…` |
| D6 | `Ω_E = Γ(1/4)²/√(2π)`, `L(E,1) = Γ(1/4)²/(8√(2π)) = Ω_E/8` | CITED | classical CM | both certified routes agree to 45+ digits; PARI at 60 digits |

## E. The identity

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| E1 | `L(E,1)·4²/(Ω_E·2) = 1` to within `10⁻⁴⁵` | COMPUTED | `src/identity.py`, certified interval | PARI `ellbsd` returns exactly `ellL1`; Cremona `allbsd` BSD ratio `1.00000000000000` |
| E2 | Using the identity-component period instead would give `2`, not `1` | COMPUTED | `src/identity.py` **asserts** this | — (it is a deliberate control) |
| E3 | The BSD leading-coefficient identity holds for `E` given `#Sha(E) = 1` | PROVED + COMPUTED | E1 + B3 + C2 + D3/D4 | three independent implementations agree |

## F. The Tate–Shafarevich group

| # | Claim | Status | Where | Cross-check |
|---|---|---|---|---|
| F1 | The **2-primary part** of `Sha(E)` is trivial | COMPUTED | `src/sha2.py`, from PARI `ellrank`'s rank bounds via `S = R_upper − R_true` (see `PROOF.md` §7.1) | the inference is validated on PARI's own worked example `ellinit([-113²,0])`, where it predicts the manual's stated answer (2-rank 2); classical descent for the congruent-number curve `E_1` |
| F2 | `#Sha(E) = 1` | **CITED** | Cremona `ecdata` (`allbsd`, `curvedata`) | PARI `ellrank` for the 2-part; `ellbsd` consistency |

> **F2 is a citation, not a proof.** We did not re-prove that the
> odd-primary part of `Sha(E)` is trivial. See `OPEN_REMAINDER.md`.

## G. What this artefact is NOT

| # | Claim | Status |
|---|---|---|
| G1 | The general BSD conjecture | **OPEN** |
| G2 | Any advance toward the general BSD conjecture | **NOT CLAIMED** — this is a verification of one special case |
| G3 | A solution of the Millennium Prize Problem | **NOT CLAIMED** — the Prize Problems are about the Birch–Swinnerton-Dyer conjecture in general; a single verified curve does not touch it |
| G4 | The odd-primary part of `Sha(E)` | **OPEN here** (cited) |
| G5 | The closed forms `Ω_E = Γ(1/4)²/√(2π)`, `L(E,1) = Ω_E/8` | **CITED**, not derived here (numerically verified to 45+ digits) |
| G6 | That `32.a2` (LMFDB) is this curve | **FALSE** — LMFDB's `32.a2` is `[0,0,0,-11,14]`; this curve is LMFDB `32.a3` |

---

## The one-sentence honest summary

> For the single curve `E : y² = x³ − x` (Cremona 32a2), every ingredient of
> the BSD leading-coefficient identity — the Mordell–Weil group, the
> Tamagawa number, the real period and the L-value — is established, the
> first by a self-contained infinite descent and the rest by certified
> computations with proved error bounds and three independent
> cross-checks; the identity then reduces to the single cited input
> `#Sha(E) = 1`, and holds numerically to ~45 digits. **The general BSD
> conjecture remains open, and nothing here bears on it.**
