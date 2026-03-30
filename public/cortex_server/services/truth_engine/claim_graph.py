from __future__ import annotations

from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def build_claim_graph(claims: Iterable[JsonDict]) -> JsonDict:
    nodes: List[JsonDict] = []
    edges: List[JsonDict] = []
    rows = [dict(row) for row in claims]
    for idx, row in enumerate(rows):
        claim_id = str(row.get('claim_id') or f'claim_{idx}')
        nodes.append({'claim_id': claim_id, 'text': row.get('text'), 'confidence': row.get('confidence', 0.0), 'evidence': list(row.get('evidence') or [])})
        for evidence_id in row.get('evidence') or []:
            edges.append({'source': claim_id, 'target': str(evidence_id), 'relation': 'supported_by'})
    return {'nodes': nodes, 'edges': edges}
