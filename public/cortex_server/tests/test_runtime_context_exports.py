from __future__ import annotations

from cortex_server.runtime import HandoffContextView, WorkingContextView, compile_handoff_context_view, compile_working_context_view



def test_runtime_package_exports_context_view_types_and_compilers():
    assert HandoffContextView is not None
    assert WorkingContextView is not None
    assert callable(compile_handoff_context_view)
    assert callable(compile_working_context_view)
