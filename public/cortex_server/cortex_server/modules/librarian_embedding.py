from __future__ import annotations

from functools import cached_property
from typing import Any, Dict, List, Optional

from chromadb.utils import embedding_functions
from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import ONNXMiniLM_L6_V2

from cortex_server.modules import runtime_pressure


class PersistentONNXMiniLMEmbeddingFunction(ONNXMiniLM_L6_V2):
    """Stable Chroma embedding function with a persistent ONNX session.

    Chroma's DefaultEmbeddingFunction delegates to a fresh ONNXMiniLM_L6_V2()
    instance on each call, which recreates the ONNX Runtime session every time.
    In this host/container layout that repeatedly triggers pthread affinity warnings
    and adds avoidable latency. This wrapper keeps one model instance alive and,
    by default, configures explicit thread counts so ONNX Runtime avoids affinity
    pinning guesses.
    """

    def __init__(
        self,
        preferred_providers: Optional[List[str]] = None,
        *,
        explicit_threads: bool = True,
        intra_op_threads: Optional[int] = None,
        inter_op_threads: Optional[int] = None,
        allow_spinning: bool = False,
    ) -> None:
        super().__init__(preferred_providers=preferred_providers)
        self._explicit_threads = bool(explicit_threads)
        self._intra_op_threads = int(intra_op_threads or 0) or None
        self._inter_op_threads = int(inter_op_threads or 0) or None
        self._allow_spinning = bool(allow_spinning)

    @cached_property
    def model(self) -> Any:
        if self._preferred_providers is None or len(self._preferred_providers) == 0:
            providers = list(self.ort.get_available_providers())
        else:
            providers = list(self._preferred_providers)
        if not set(providers).issubset(set(self.ort.get_available_providers())):
            raise ValueError(
                f"Preferred providers must be subset of available providers: {self.ort.get_available_providers()}"
            )

        if "CoreMLExecutionProvider" in providers:
            providers = [provider for provider in providers if provider != "CoreMLExecutionProvider"]

        so = self.ort.SessionOptions()
        so.log_severity_level = 3
        so.graph_optimization_level = self.ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if self._explicit_threads:
            if self._intra_op_threads:
                so.intra_op_num_threads = int(self._intra_op_threads)
            if self._inter_op_threads:
                so.inter_op_num_threads = int(self._inter_op_threads)
            spin = "1" if self._allow_spinning else "0"
            try:
                so.add_session_config_entry("session.intra_op.allow_spinning", spin)
            except Exception:
                pass
            try:
                so.add_session_config_entry("session.inter_op.allow_spinning", spin)
            except Exception:
                pass

        model = self.ort.InferenceSession(
            self.DOWNLOAD_PATH / self.EXTRACTED_FOLDER_NAME / "model.onnx",
            providers=providers,
            sess_options=so,
        )
        runtime_pressure.record_onnx_session_init(
            source="librarian_embedding",
            explicit_threads=self._explicit_threads,
            intra_op_threads=self._intra_op_threads,
            inter_op_threads=self._inter_op_threads,
            providers=providers,
        )
        return model

    def __call__(self, input):  # type: ignore[override]
        runtime_pressure.record_embedding_call(source="librarian_embedding")
        return super().__call__(input)

    @staticmethod
    def name() -> str:
        # Reuse Chroma's persisted "default" collection configuration so existing
        # collections can adopt the durable runtime wrapper without destructive migration.
        return "default"

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "PersistentONNXMiniLMEmbeddingFunction":
        providers = config.get("preferred_providers")
        return PersistentONNXMiniLMEmbeddingFunction(
            preferred_providers=providers,
            explicit_threads=bool(config.get("explicit_threads", True)),
            intra_op_threads=config.get("intra_op_threads"),
            inter_op_threads=config.get("inter_op_threads"),
            allow_spinning=bool(config.get("allow_spinning", False)),
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "preferred_providers": self._preferred_providers,
            "explicit_threads": self._explicit_threads,
            "intra_op_threads": self._intra_op_threads,
            "inter_op_threads": self._inter_op_threads,
            "allow_spinning": self._allow_spinning,
        }


def build_embedding_function():
    mode = runtime_pressure.configured_embedding_mode()
    if mode == "default":
        return embedding_functions.DefaultEmbeddingFunction()
    return PersistentONNXMiniLMEmbeddingFunction(
        preferred_providers=runtime_pressure.runtime_configuration().get("preferred_providers") or ["CPUExecutionProvider"],
        explicit_threads=runtime_pressure.configured_explicit_threads(),
        intra_op_threads=runtime_pressure.configured_intra_op_threads() if runtime_pressure.configured_explicit_threads() else None,
        inter_op_threads=runtime_pressure.configured_inter_op_threads() if runtime_pressure.configured_explicit_threads() else None,
        allow_spinning=runtime_pressure.configured_allow_spinning() if runtime_pressure.configured_explicit_threads() else False,
    )
