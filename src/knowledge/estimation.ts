// ============================================================================
// Engram — PM Knowledge Base: Estimation Guidance
// ============================================================================
// PERT-based estimation with worked examples.
// Formula: E = (O + 4M + P) / 6 | Commit: M + σ where σ = (P - O) / 6

import type { EstimationGuide } from "./types.js";

/** PERT estimation guide. */
export const ESTIMATION_GUIDE: EstimationGuide = {
    method: "PERT",
    formula: "E = (O + 4M + P) / 6",
    commitFormula: "Commit = M + σ  where σ = (P - O) / 6",
    compact: "PERT: E=(O+4M+P)/6. Commit M+σ where σ=(P-O)/6. Never commit O.",
    full: `
**PERT Estimation Guide**

PERT (Program Evaluation and Review Technique) is a three-point estimation method that accounts for uncertainty.

**Variables:**
- O = Optimistic estimate (best case: everything goes right, no blockers)
- M = Most Likely estimate (realistic: accounts for typical friction, interruptions, review cycles)
- P = Pessimistic estimate (realistic worst case: common blockers materialise, rework needed)

**Formulas:**
- Expected duration: E = (O + 4M + P) / 6
- Uncertainty (std deviation): σ = (P - O) / 6
- **Commit to: M + σ** (the realistic case plus one standard deviation)

**Why M + σ, not E?**
E is the statistical mean — it will be beaten 50% of the time. M + σ gives you approximately 84% confidence you'll deliver on time. E is useful for portfolio planning. M + σ is what you tell stakeholders.

**Never commit O.** Optimistic estimates assume zero friction. Real projects always have friction.

**How to elicit three estimates:**
1. O: "What's the fastest this could go if nothing goes wrong?"
2. M: "What's the most realistic time given typical team and environment?"
3. P: "What if we hit the most common blockers — review delays, unclear requirements, dependencies?"

**Red flags:**
- O = M = P: The estimator is not thinking in distributions. Push for differentiation.
- P > 3× O: The task is not well-understood. Decompose before estimating.
- No σ calculation: The commitment has unknown variance. Require three-point estimates.
`.trim(),
    examples: [
        {
            scenario: "Build and test a new API endpoint (moderate complexity)",
            optimistic: 0.5,
            mostLikely: 1.5,
            pessimistic: 4,
            expected: parseFloat(((0.5 + 4 * 1.5 + 4) / 6).toFixed(2)),
            sigma: parseFloat(((4 - 0.5) / 6).toFixed(2)),
            commit: parseFloat((1.5 + (4 - 0.5) / 6).toFixed(2)),
        },
        {
            scenario: "Integrate third-party payment SDK (uncertain territory)",
            optimistic: 2,
            mostLikely: 5,
            pessimistic: 14,
            expected: parseFloat(((2 + 4 * 5 + 14) / 6).toFixed(2)),
            sigma: parseFloat(((14 - 2) / 6).toFixed(2)),
            commit: parseFloat((5 + (14 - 2) / 6).toFixed(2)),
        },
        {
            scenario: "Write unit tests for an existing feature (well-understood)",
            optimistic: 1,
            mostLikely: 2,
            pessimistic: 4,
            expected: parseFloat(((1 + 4 * 2 + 4) / 6).toFixed(2)),
            sigma: parseFloat(((4 - 1) / 6).toFixed(2)),
            commit: parseFloat((2 + (4 - 1) / 6).toFixed(2)),
        },
    ],
};
