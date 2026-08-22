import Mathlib

open scoped MeasureTheory

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_conditional_tower
    {Ω : Type*} (m m0 : MeasurableSpace Ω) (μ : @MeasureTheory.Measure Ω m)
    (hm : m0 ≤ m)
    (f : Ω → ℝ) (integrable_f : MeasureTheory.Integrable f μ) :
    μ[f | m0] =ᵐ[μ] μ[μ[f | m] | m0] := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
