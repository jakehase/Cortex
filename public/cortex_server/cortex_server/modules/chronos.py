"""Chronos - The Night Shift Scheduler for The Cortex.

Level 19: Self-Evolving System
Runs the Dreamer → Council → Materializer → Diplomat → Geneticist pipeline every night at 03:00.
"""
import asyncio
from datetime import datetime
from pathlib import Path
import json

from cortex_server.modules.dreamer import Dreamer
from cortex_server.modules.council import get_council
from cortex_server.modules.diplomat import get_diplomat
from cortex_server.modules.geneticist import get_geneticist


class Chronos:
    """Automated scheduler for nightly evolution cycles.
    
    The Night Shift (Level 19):
    1. 03:00 - Dream: Scan logs, detect gaps, propose skills
    2. 03:05 - Council: Adversarial safety review (The Critic + The Judge)
    3. 03:10 - Build: Materialize approved skills into code
    4. 03:15 - Diplomat: Send briefing via WhatsApp
    5. 03:20 - Geneticist: Evolve system prompt DNA
    """
    
    def __init__(self, changelog_path: str = "cortex_server/knowledge/evolution/changelog.txt"):
        self.changelog_path = Path(changelog_path)
        self.running = False
        self.last_run_date = None
        
    async def start_scheduler(self):
        """Start the async scheduler loop."""
        self.running = True
        self._log("🕐 Chronos started. Watching for 03:00...")
        
        while self.running:
            now = datetime.now()
            current_time = now.strftime("%H:%M")
            current_date = now.strftime("%Y-%m-%d")
            
            # Check if it's 03:00 and we haven't run today
            if current_time == "03:00" and self.last_run_date != current_date:
                self.last_run_date = current_date
                await self.run_night_shift()
            
            # Sleep for 60 seconds before next check
            await asyncio.sleep(60)
    
    async def run_night_shift(self):
        """Execute the full evolution cycle."""
        timestamp = datetime.now().isoformat()
        self._log(f"\n{'='*60}")
        self._log(f"🌙 NIGHT SHIFT STARTED: {timestamp}")
        self._log(f"{'='*60}")
        
        try:
            # Step 1: Dream - Detect gaps and propose skills
            self._log("\n🔮 Step 1: Dreaming...")
            dreamer = Dreamer()
            dream_result = dreamer.dream()
            
            proposal = getattr(dreamer, '_last_proposal', None)
            
            if proposal and proposal.get('status') != 'no_gaps':
                gaps_found = proposal.get('gaps_detected', 0)
                skill_name = proposal.get('proposed_module', 'unknown')
                self._log(f"   ✓ Detected {gaps_found} gaps")
                self._log(f"   ✓ Proposed skill: {skill_name}")
                
                # Step 2: The Council Review (Level 15)
                self._log("\n⚖️ Step 2: Council Review...")
                council = get_council()
                approved = council.review_proposal(proposal)
                
                if not approved:
                    self._log(f"   ✗ Proposal REJECTED by The Council")
                    self._log(f"   ✗ Aborting materialization")
                    # Log the critique
                    last_review = council.get_last_review()
                    if last_review:
                        self._log(f"   Critique: {last_review.get('critique', 'N/A')[:100]}...")
                    return  # Abort night shift
                
                self._log(f"   ✓ Proposal APPROVED by The Council")
                
                # Step 3: Build - Materialize the skill
                self._log("\n🔨 Step 3: Building...")
                build_result = await self._materialize_skill(proposal)
                
                if build_result.get('success'):
                    self._log(f"   ✓ Skill materialized: {build_result.get('file_path')}")
                    
                    # Update proposal status
                    proposal['status'] = 'installed'
                    proposal['installed_at'] = timestamp
                    proposal['file_path'] = build_result.get('file_path')
                    
                    # Save to registry
                    dreamer.save_to_registry(proposal)
                else:
                    self._log(f"   ✗ Build failed: {build_result.get('error')}")
            else:
                self._log("   ✓ No gaps detected. System healthy.")
            
            # Step 4: Log - Record activity
            self._log("\n📝 Step 4: Logging...")
            self._log(f"   ✓ Night shift complete")
            
        except Exception as e:
            self._log(f"   ✗ Night shift failed: {str(e)}")
        
        # Send briefing via The Diplomat (Level 18)
        diplomat = get_diplomat()
        changelog_summary = self._get_changelog_summary()
        diplomat.send_briefing(
            message=changelog_summary,
            title="🌙 Night Shift Complete"
        )
        
        # Step 5: Geneticist - Self-modifying prompt evolution (Level 19)
        self._log("\n🧬 Step 5: Geneticist - Evolving DNA...")
        try:
            geneticist = get_geneticist()
            weakness = geneticist.evaluate_fitness()
            
            if weakness:
                self._log(f"   ⚠️ Weakness detected: {weakness}")
                
                # Generate mutation
                new_persona = geneticist.mutate_persona(weakness)
                
                if new_persona:
                    # Council review for safety
                    council = get_council()
                    mutation_proposal = {
                        'proposed_module': 'persona_mutation',
                        'gap_summary': f"DNA mutation to fix: {weakness}",
                        'detected_from': 'Geneticist fitness evaluation'
                    }
                    
                    # Level 20: Test in Simulator, then Council
                    result = geneticist.test_and_apply_mutation(new_persona, weakness)
                    
                    if result.get("success"):
                        self._log(f"   ✓ {result.get('message', 'DNA Mutated')}")
                        diplomat.send_briefing(
                            message=f"🧬 {result.get('message')}",
                            title="🧬 DNA Mutation Applied"
                        )
                    else:
                        stage = result.get('stage', 'unknown')
                        if stage == 'simulated':
                            self._log(f"   ✗ Simulator rejected (Score: {result.get('score')}/10)")
                        elif stage == 'council_reviewed':
                            self._log(f"   ✗ Council rejected mutation")
                        else:
                            self._log(f"   ✗ Mutation failed: {result.get('message')}")
                else:
                    self._log(f"   ✗ Mutation generation failed")
            else:
                self._log(f"   ✓ No weaknesses detected. DNA stable.")
                
        except Exception as e:
            self._log(f"   ✗ Geneticist error: {str(e)}")
        
        self._log(f"\n{'='*60}")
        self._log(f"🌅 NIGHT SHIFT COMPLETE: {datetime.now().isoformat()}")
        self._log(f"{'='*60}\n")
    
    async def _materialize_skill(self, proposal: dict) -> dict:
        """Materialize a skill proposal into code.
        
        Simplified version that creates basic skill structure.
        Full implementation would use Ghost + Oracle.
        """
        try:
            skill_name = proposal.get('proposed_module', 'auto_skill')
            gap_summary = proposal.get('gap_summary', '')
            
            # Determine skill type from name/gap
            if 'finance' in skill_name.lower() or 'price' in gap_summary.lower():
                template = self._finance_template()
            elif 'youtube' in skill_name.lower():
                template = self._youtube_template()
            elif 'pdf' in skill_name.lower():
                template = self._pdf_template()
            else:
                template = self._generic_template(skill_name)
            
            # Write to extensions
            extensions_dir = Path("cortex_server/modules/extensions")
            extensions_dir.mkdir(parents=True, exist_ok=True)
            
            file_path = extensions_dir / f"{skill_name}.py"
            
            header = f"""# Auto-generated by Chronos Night Shift
# Skill: {skill_name}
# Generated: {datetime.now().isoformat()}
# Gap: {gap_summary[:80]}...
# Status: Auto-installed

"""
            
            with open(file_path, 'w') as f:
                f.write(header + template)
            
            return {
                'success': True,
                'file_path': str(file_path),
                'skill_name': skill_name
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def _finance_template(self) -> str:
        """Template for finance handler."""
        return '''"""Finance Handler - Auto-generated by Chronos."""
import requests


class FinanceHandler:
    """Handle financial data queries."""
    
    def __init__(self):
        self.session = requests.Session()
    
    def get_price(self, symbol: str) -> dict:
        """Get price for stock or crypto."""
        try:
            # Try crypto first
            url = "https://api.coingecko.com/api/v3/simple/price"
            resp = self.session.get(url, params={
                "ids": symbol.lower(),
                "vs_currencies": "usd"
            }, timeout=10)
            data = resp.json()
            if data:
                return {
                    "symbol": symbol,
                    "price": data.get(symbol.lower(), {}).get("usd", 0),
                    "status": "success"
                }
        except:
            pass
        
        return {"symbol": symbol, "error": "Price lookup failed", "status": "failed"}
'''
    
    def _youtube_template(self) -> str:
        """Template for YouTube handler."""
        return '''"""YouTube Handler - Auto-generated by Chronos."""
import subprocess


class YouTubeHandler:
    """Handle YouTube video operations."""
    
    def __init__(self):
        pass
    
    def download(self, url: str, output_dir: str = "/tmp") -> dict:
        """Download video using yt-dlp."""
        try:
            result = subprocess.run(
                ["yt-dlp", "-o", f"{output_dir}/%(title)s.%(ext)s", url],
                capture_output=True,
                text=True,
                timeout=300
            )
            return {
                "url": url,
                "success": result.returncode == 0,
                "output": result.stdout[-500:] if len(result.stdout) > 500 else result.stdout
            }
        except Exception as e:
            return {"url": url, "success": False, "error": str(e)}
'''
    
    def _pdf_template(self) -> str:
        """Template for PDF handler."""
        return '''"""PDF Handler - Auto-generated by Chronos."""
from pathlib import Path


class PDFHandler:
    """Handle PDF extraction operations."""
    
    def __init__(self):
        pass
    
    def extract_text(self, file_path: str) -> dict:
        """Extract text from PDF file."""
        try:
            # Placeholder for PyPDF2 or pdfplumber
            return {
                "file": file_path,
                "text": "PDF extraction not yet implemented",
                "status": "placeholder"
            }
        except Exception as e:
            return {"file": file_path, "error": str(e), "status": "failed"}
'''
    
    def _generic_template(self, skill_name: str) -> str:
        """Generic template for unknown skills."""
        class_name = ''.join(word.capitalize() for word in skill_name.split('_'))
        return f'''"""{class_name} - Auto-generated by Chronos."""


class {class_name}:
    """Auto-generated skill handler."""
    
    def __init__(self):
        pass
    
    def handle(self, query: str) -> dict:
        """Handle the query."""
        return {{
            "query": query,
            "status": "placeholder",
            "message": "This skill was auto-generated and needs implementation"
        }}
'''
    
    def _get_changelog_summary(self) -> str:
        """Get a summary of the changelog for briefing."""
        try:
            if not self.changelog_path.exists():
                return "No activity logged."
            
            # Read last 50 lines
            with open(self.changelog_path, 'r') as f:
                lines = f.readlines()[-50:]
            
            # Extract key events
            events = []
            for line in lines:
                if any(keyword in line for keyword in [
                    "NIGHT SHIFT", "gaps", "Proposed skill", 
                    "Council", "APPROVED", "REJECTED", "materialized"
                ]):
                    # Clean up the line
                    clean_line = line.strip()
                    if clean_line and not clean_line.startswith('='):
                        events.append(clean_line)
            
            if not events:
                return "Night shift ran. No new skills generated."
            
            # Format summary
            summary = "\\n".join(events[-10:])  # Last 10 events
            return summary
            
        except Exception as e:
            return f"Could not read changelog: {e}"
    
    def _log(self, message: str):
        """Write to changelog."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{timestamp}] {message}\n"
        
        # Ensure directory exists
        self.changelog_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Append to changelog
        with open(self.changelog_path, 'a') as f:
            f.write(log_line)
        
        # Also print for visibility
        print(f"[CHRONOS] {message}")
    
    def stop(self):
        """Stop the scheduler."""
        self.running = False
        self._log("🛑 Chronos stopped.")


# Singleton instance
_chronos_instance = None


def get_chronos() -> Chronos:
    """Get or create Chronos singleton."""
    global _chronos_instance
    if _chronos_instance is None:
        _chronos_instance = Chronos()
    return _chronos_instance
