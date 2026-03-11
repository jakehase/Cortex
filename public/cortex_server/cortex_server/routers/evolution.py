"""Evolution Router - API endpoints for The Proactive Dreamer.

Level 13: Triggers skill evolution cycles via the Dreamer engine.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
from pathlib import Path
import json
import requests
import re

from cortex_server.modules.dreamer import Dreamer
from cortex_server.modules.ghost import Ghost
from cortex_server.modules.academy import get_academy
from cortex_server.modules.diplomat import get_diplomat
from cortex_server.modules.geneticist import get_geneticist

router = APIRouter()


class DreamResponse(BaseModel):
    status: str
    proposal: Dict[str, Any]


class MaterializeRequest(BaseModel):
    skill_id: str = Field(default="latest", description="Skill ID to materialize, or 'latest' for most recent")


class MaterializeResponse(BaseModel):
    status: str
    skill_name: str
    file_path: str
    code_preview: str


@router.post("/dream", response_model=DreamResponse)
async def trigger_dream() -> DreamResponse:
    """Trigger the Dreamer evolution cycle.
    
    Executes:
    1. Scan logs for failures/gaps
    2. Analyze gaps with Oracle
    3. Propose new skill
    4. Save to evolution registry
    
    Returns the proposal generated.
    """
    try:
        dreamer = Dreamer()
        result = dreamer.dream()
        
        # Parse the result to extract proposal data
        if hasattr(dreamer, '_last_proposal') and dreamer._last_proposal:
            proposal = dreamer._last_proposal
        else:
            # Build proposal from gaps found
            proposal = {
                "gaps_detected": len(dreamer.gaps_found),
                "analysis": result,
                "status": "dream_complete"
            }
        
        return DreamResponse(
            status="dream_complete",
            proposal=proposal
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dream cycle failed: {str(e)}")


@router.post("/materialize", response_model=MaterializeResponse)
async def materialize_skill(request: MaterializeRequest) -> MaterializeResponse:
    """Materialize a proposed skill into working code.
    
    The Flywheel:
    1. Load pending skill from registry
    2. Research libraries using Ghost (Level 2)
    3. Generate code using Oracle (Level 5)
    4. Write to modules/extensions/ (Level 9)
    5. Update registry status to 'Installed'
    """
    try:
        dreamer = Dreamer()
        registry_path = Path(dreamer.registry_path)
        
        # 1. Load skill from registry
        if not registry_path.exists():
            raise HTTPException(status_code=404, detail="Skill registry not found")
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        if not registry:
            raise HTTPException(status_code=404, detail="No skills in registry")
        
        # Find skill to materialize
        skill = None
        if request.skill_id == "latest":
            # Get most recent proposed skill
            for s in reversed(registry):
                if s.get("status") == "proposed":
                    skill = s
                    break
        else:
            # Find by ID
            for s in registry:
                if s.get("id") == request.skill_id:
                    skill = s
                    break
        
        if not skill:
            raise HTTPException(status_code=404, detail="No pending skill found to materialize")
        
        skill_name = skill.get("proposed_module", "generic_handler")
        gap_summary = skill.get("gap_summary", "")
        
        # Step 1: Pre-computation - Consult The Academy (Level 16)
        academy = get_academy()
        skill_plan = f"{skill_name} {gap_summary}"
        examples = academy.consult(skill_plan, top_n=2)
        
        # Format examples for Oracle prompt
        examples_text = ""
        if examples:
            examples_text = "\n\nREFERENCE THESE PAST SUCCESSFUL MODULES FOR STYLE AND STRUCTURE:\n\n"
            for i, ex in enumerate(examples, 1):
                examples_text += f"--- Example {i}: {ex.get('module', 'unknown')} ---\n"
                # Include first 800 chars of code as reference
                code_sample = ex.get('code', '')[:800]
                examples_text += f"{code_sample}\n...\n\n"
        
        # 2. Research (Level 2) - Use Ghost to find library examples
        ghost = Ghost()
        research_notes = []
        
        # Detect libraries from gap and proposed module
        library_keywords = {
            "finance": "yfinance python stock price example",
            "stock": "yfinance python stock price example",
            "price": "yfinance python stock price example",
            "youtube": "youtube_dl python download video example",
            "pdf": "pypdf2 python extract text example",
            "database": "sqlalchemy python orm example",
            "api": "requests python rest api client example",
            "scrape": "beautifulsoup4 python web scraping example",
            "download": "requests python file download example"
        }
        
        search_query = None
        for keyword, query in library_keywords.items():
            if keyword in skill_name.lower() or keyword in gap_summary.lower():
                search_query = query
                break
        
        if search_query:
            try:
                search_results = ghost.search(search_query, max_results=3)
                research_notes = [f"{r['title']}: {r['link']}" for r in search_results]
            except Exception as e:
                research_notes = [f"Research note: Could not search: {e}"]
        else:
            research_notes = ["Generic Python class implementation"]
        
        # 3. Code Generation (Level 5) - Use Oracle
        ORACLE_URL = "http://localhost:8888/oracle/chat"
        
        prompt = f"""You are the Architect. Write a Python class named {skill_name.title()} that solves this gap:
{gap_summary}

Use these research notes for implementation guidance:
{chr(10).join(research_notes)}
{examples_text}

Requirements:
1. Create a complete, working Python class
2. Include a __init__ method
3. Include at least one main method that solves the gap
4. Add docstrings explaining what each method does
5. Use proper error handling with try/except
6. Follow the style and patterns from the examples above
7. Output ONLY the Python code - no markdown, no explanations

The class should be ready to use in modules/extensions/{skill_name}.py"""

        oracle_payload = {
            "prompt": prompt,
            "system": "You are an expert Python programmer. Write clean, production-ready code. Output ONLY valid Python code.",
            "model": "tinyllama"
        }
        
        try:
            oracle_resp = requests.post(ORACLE_URL, json=oracle_payload, timeout=120)
            oracle_data = oracle_resp.json()
            generated_code = oracle_data.get("response", "")
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Oracle code generation failed: {str(e)}")
        
        # Clean up generated code (remove markdown if present)
        generated_code = generated_code.strip()
        if generated_code.startswith("```python"):
            generated_code = generated_code[9:]
        if generated_code.startswith("```"):
            generated_code = generated_code[3:]
        if generated_code.endswith("```"):
            generated_code = generated_code[:-3]
        generated_code = generated_code.strip()
        
        # 4. Build (Level 9) - Write to modules/extensions/
        extensions_dir = Path("/app/cortex_server/modules/extensions")
        extensions_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = extensions_dir / f"{skill_name}.py"
        
        # Add header comment
        header = f"""# Auto-generated skill: {skill_name}
# Generated: {Path(dreamer.registry_path).stat().st_mtime if dreamer.registry_path.exists() else 'now'}
# Gap: {gap_summary[:100]}...
# Status: Materialized

"""
        
        with open(file_path, 'w') as f:
            f.write(header + generated_code)
        
        # 5. Update registry status
        skill["status"] = "installed"
        skill["installed_at"] = str(Path(dreamer.registry_path).stat().st_mtime if dreamer.registry_path.exists() else "now")
        skill["file_path"] = str(file_path)
        
        with open(registry_path, 'w') as f:
            json.dump(registry, f, indent=2)
        
        # Step 3: Post-success - Learn from this victory (Level 16)
        academy.learn(str(file_path))
        
        # Return preview (first 500 chars of code)
        code_preview = generated_code[:500] + "..." if len(generated_code) > 500 else generated_code
        
        return MaterializeResponse(
            status="materialized",
            skill_name=skill_name,
            file_path=str(file_path),
            code_preview=code_preview
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Materialization failed: {str(e)}")


@router.get("/registry")
async def get_registry() -> Dict:
    """Get the current skill evolution registry."""
    try:
        dreamer = Dreamer()
        
        registry_path = Path(dreamer.registry_path)
        if registry_path.exists():
            with open(registry_path, 'r') as f:
                registry = json.load(f)
        else:
            registry = []
        
        return {
            "status": "success",
            "registry_entries": len(registry),
            "skills": registry
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registry read failed: {str(e)}")


@router.get("/academy")
async def academy_status() -> Dict:
    """Get The Academy status and learned patterns."""
    try:
        academy = get_academy()
        stats = academy.get_stats()
        return {
            "status": "active",
            "level": 16,
            "name": "The Academy",
            "patterns_learned": stats.get("patterns_learned", 0),
            "modules": stats.get("modules", [])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Academy status failed: {str(e)}")


@router.get("/geneticist")
async def geneticist_status() -> Dict:
    """Get The Geneticist status and persona evolution."""
    try:
        from cortex_server.modules.geneticist import get_geneticist
        geneticist = get_geneticist()
        
        # Check persona file
        persona_exists = Path(geneticist.persona_path).exists()
        
        # Get fitness history
        fitness_history = geneticist.get_fitness_history()
        
        return {
            "status": "active",
            "level": 19,
            "name": "The Geneticist",
            "persona_externalized": persona_exists,
            "persona_path": str(geneticist.persona_path),
            "evaluations_count": len(fitness_history),
            "last_evaluations": fitness_history[-5:] if fitness_history else []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Geneticist status failed: {str(e)}")


@router.get("/simulator")
async def simulator_status() -> Dict:
    """Get The Simulator status."""
    try:
        from cortex_server.modules.simulator import get_simulator
        simulator = get_simulator()
        
        return {
            "status": "active",
            "level": 20,
            "name": "The Simulator",
            "test_scenarios": len(simulator.test_scenarios),
            "scenarios": simulator.test_scenarios
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulator status failed: {str(e)}")


class MutateRequest(BaseModel):
    force: bool = Field(default=False, description="Force mutation even if simulator rejects")
    simulation: str = Field(description="Description of desired mutation")


@router.post("/geneticist/mutate")
async def test_mutation(request: MutateRequest) -> Dict:
    """Test a persona mutation through the full pipeline (Simulator + Council).
    
    This is a TEST endpoint to demonstrate the safety layers.
    """
    try:
        geneticist = get_geneticist()
        
        # Generate the mutation
        new_persona = geneticist.mutate_persona(request.simulation)
        
        if not new_persona:
            return {
                "status": "failed",
                "stage": "generation",
                "message": "Failed to generate mutation"
            }
        
        # Run through test_and_apply_mutation (includes Simulator + Council)
        result = geneticist.test_and_apply_mutation(new_persona, request.simulation)
        
        # If force=True and simulator rejected, try Council anyway
        if request.force and result.get("stage") == "simulated" and not result.get("success"):
            from cortex_server.modules.council import get_council
            council = get_council()
            
            mutation_proposal = {
                'proposed_module': 'persona_mutation_forced',
                'gap_summary': f"FORCED mutation: {request.simulation}",
                'detected_from': f'Forced test (Score: {result.get("score")}/10)'
            }
            
            council_approved = council.review_proposal(mutation_proposal)
            
            if council_approved:
                # Apply anyway
                success = geneticist._apply_mutation_file(new_persona, request.simulation)
                return {
                    "status": "applied_forced",
                    "stage": "council_override",
                    "simulator_score": result.get("score"),
                    "council_approved": True,
                    "message": "FORCED: Mutation applied despite simulator rejection",
                    "preview": new_persona[:300]
                }
            else:
                return {
                    "status": "rejected",
                    "stage": "council_review",
                    "simulator_score": result.get("score"),
                    "council_approved": False,
                    "message": "Even Council rejected this mutation",
                    "preview": new_persona[:300]
                }
        
        return {
            "status": "completed",
            "success": result.get("success"),
            "stage": result.get("stage"),
            "score": result.get("score"),
            "message": result.get("message"),
            "preview": new_persona[:300] if new_persona else None
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mutation test failed: {str(e)}")


class DiplomatSendRequest(BaseModel):
    message: str
    title: str = Field(default="🧠 Cortex Update", description="Message header")


@router.post("/diplomat/send")
async def send_diplomat_message(request: DiplomatSendRequest) -> Dict:
    """Send a custom message via The Diplomat."""
    try:
        diplomat = get_diplomat()
        success = diplomat.send_briefing(
            message=request.message,
            title=request.title
        )
        return {
            "status": "sent" if success else "failed",
            "level": 18,
            "name": "The Diplomat",
            "message_sent": success
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diplomat send failed: {str(e)}")


@router.post("/diplomat/test")
async def test_diplomat() -> Dict:
    """Test The Diplomat messaging capability."""
    try:
        diplomat = get_diplomat()
        success = diplomat.send_briefing(
            message="🧪 Test message from The Cortex.\\n\\nThe Diplomat module is now active and can send autonomous notifications.",
            title="🤖 Level 18: The Diplomat"
        )
        return {
            "status": "active" if success else "failed",
            "level": 18,
            "name": "The Diplomat",
            "message_sent": success
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diplomat test failed: {str(e)}")


@router.get("/status")
async def evolution_status() -> Dict:
    """Get Dreamer system status."""
    try:
        dreamer = Dreamer()
        
        # Check if log file exists
        log_exists = dreamer.log_path.exists()
        
        # Check registry
        registry_exists = Path(dreamer.registry_path).exists()
        
        # Count proposed vs installed
        registry_path = Path(dreamer.registry_path)
        proposed_count = 0
        installed_count = 0
        if registry_path.exists():
            with open(registry_path, 'r') as f:
                registry = json.load(f)
                for skill in registry:
                    if skill.get("status") == "proposed":
                        proposed_count += 1
                    elif skill.get("status") == "installed":
                        installed_count += 1
        
        # Get Academy stats
        academy = get_academy()
        academy_stats = academy.get_stats()
        
        return {
            "status": "active",
            "level": 13,
            "name": "The Self-Optimizing Dreamer",
            "log_file_accessible": log_exists,
            "registry_accessible": registry_exists,
            "gap_keywords": dreamer.GAP_KEYWORDS,
            "skills_proposed": proposed_count,
            "skills_installed": installed_count,
            "academy_patterns": academy_stats.get("patterns_learned", 0),
            "diplomat_active": True,
            "geneticist_active": True,
            "simulator_active": True,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")
