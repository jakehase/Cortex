import Mathlib

namespace CortexLearningOS.ProofKernel.Candidate

theorem candidate_first_isomorphism
    (G H : Type*) [Group G] [Group H] (f : G →* H) :
    Nonempty ((G ⧸ MonoidHom.ker f) ≃* MonoidHom.range f) := ({{CORTEX_PROOF_HOLE}})

end CortexLearningOS.ProofKernel.Candidate
