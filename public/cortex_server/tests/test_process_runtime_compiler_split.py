from __future__ import annotations

from cortex_server.modules import explain_compiler



def test_explain_compiler_facade_exports_split_runtime_and_surface_functions():
    assert callable(explain_compiler.compile_policy_surface_sections)
    assert callable(explain_compiler.compile_runtime_process_sections)
    assert callable(explain_compiler.compile_control_plane_summary)
    assert callable(explain_compiler.compile_step_belief_influences)
