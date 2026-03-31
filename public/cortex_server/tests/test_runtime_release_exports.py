from __future__ import annotations

from cortex_server.runtime import (
    ReleaseRollbackFencepost,
    ReleaseWorkflowHistoryRecord,
    ReleaseWorkflowState,
    ReleaseWorkflowStore,
    advance_release_workflow,
    apply_release_rollback_restore,
    capture_release_rollback_fencepost,
    compile_release_handoff,
    compile_release_repair_plan,
    evaluate_release_promotion_gate,
    record_release_fencepost,
    record_release_handoff,
    repair_release_workflow,
    rollback_release_workflow,
)



def test_runtime_package_exports_release_workflow_helpers():
    assert ReleaseRollbackFencepost is not None
    assert ReleaseWorkflowHistoryRecord is not None
    assert ReleaseWorkflowState is not None
    assert ReleaseWorkflowStore is not None
    assert callable(advance_release_workflow)
    assert callable(apply_release_rollback_restore)
    assert callable(capture_release_rollback_fencepost)
    assert callable(compile_release_handoff)
    assert callable(compile_release_repair_plan)
    assert callable(evaluate_release_promotion_gate)
    assert callable(record_release_fencepost)
    assert callable(record_release_handoff)
    assert callable(repair_release_workflow)
    assert callable(rollback_release_workflow)
