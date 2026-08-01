import Mathlib

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_rank_nullity
    (K V W : Type*)
    [DivisionRing K]
    [AddCommGroup V] [Module K V]
    [AddCommGroup W] [Module K W]
    [FiniteDimensional K V]
    (f : V →ₗ[K] W) :
    Module.finrank K (LinearMap.ker f) + Module.finrank K (LinearMap.range f) =
      Module.finrank K V := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
