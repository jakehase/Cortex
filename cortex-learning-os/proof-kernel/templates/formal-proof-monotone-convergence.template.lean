import Mathlib

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_monotone_convergence
    {α : Type*} [MeasurableSpace α]
    (μ : MeasureTheory.Measure α)
    (f : Nat → α → ENNReal)
    (measurable_f : ∀ n, Measurable (f n))
    (monotone_f : Monotone f) :
    ∫⁻ a, ⨆ n, f n a ∂μ = ⨆ n, ∫⁻ a, f n a ∂μ := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
