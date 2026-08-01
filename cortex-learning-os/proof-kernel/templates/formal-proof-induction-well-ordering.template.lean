import Mathlib

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_induction_well_ordering
    (P : Nat → Prop)
    (step : ∀ n, (∀ m < n, P m) → P n) :
    ∀ n, P n := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
