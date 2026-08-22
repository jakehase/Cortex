import Mathlib

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_compact_image
    {X Y : Type*} [TopologicalSpace X] [TopologicalSpace Y]
    {K : Set X} (compact_K : IsCompact K) (f : X → Y) (continuous_f : Continuous f) :
    IsCompact (f '' K) := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
