import os
import json
import socket
from pathlib import Path
from datetime import datetime

from cortex_server.modules.level_registry import get_level_registry

# Canonical LEVEL_MAP - derived from the shared registry to avoid count drift.
LEVEL_MAP = {int(row['level']): str(row['name']).split()[0].lower().replace('(browser)', '').strip() for row in get_level_registry()}
LEVEL_MAP[2] = 'ghost'
LEVEL_MAP[12] = 'hive'
LEVEL_MAP[36] = 'conductor'

# Reverse mapping for name lookups
NAME_TO_LEVEL = {v: k for k, v in LEVEL_MAP.items()}
NAME_TO_LEVEL.update({'browser':2,'parsers':3,'synthesist_api':32,'orchestrator':26,'conductor':36})

class Cartographer:
    '''Level 23: The Cartographer - Self-Discovery Module'''
    
    def __init__(self):
        # Use container paths or environment override
        base_path = Path(os.getenv('CORTEX_DATA_DIR', '/app'))
        self.modules_dir = Path('/app/cortex_server/modules')
        self.identity_path = base_path / 'identity.json'
        self.backup_path = base_path / 'identity.backup.json'
    
    def scan_cortex(self):
        '''Walk modules directory and find all .py files, mapping to Levels'''
        skills = []
        
        if not self.modules_dir.exists():
            return skills
        
        for py_file in self.modules_dir.glob('*.py'):
            if py_file.name.startswith('__'):
                continue
            
            skill_info = {
                'name': py_file.stem,
                'file': str(py_file),
                'level': None,
                'description': None
            }
            
            # Use LEVEL_MAP for level detection
            skill_info['level'] = NAME_TO_LEVEL.get(skill_info['name'], None)
            
            # Parse file for description
            try:
                content = py_file.read_text()
                lines = content.split('\n')
                
                for line in lines:
                    # Look for docstring or class description
                    if line.strip().startswith('"""') or line.strip().startswith("'''"):
                        desc = line.strip().strip('"').strip("'")
                        if len(desc) > 5 and not desc.startswith('Level'):
                            skill_info['description'] = desc
                
                # If no description found, use class name
                if not skill_info['description']:
                    for line in lines:
                        if 'class ' in line:
                            skill_info['description'] = line.strip()
                            break
            
            except Exception as e:
                skill_info['error'] = str(e)
            
            skills.append(skill_info)
        
        return skills
    
    def check_pulse(self):
        '''Check port 8888 (Oracle) and port 10200 (Piper TTS)'''
        # Check localhost instead of external IP
        services = {
            'oracle': {'port': 8888, 'status': 'unknown', 'host': '127.0.0.1'},
            'piper_tts': {'port': 10200, 'status': 'unknown', 'host': '127.0.0.1'}
        }
        
        for name, config in services.items():
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(2)
                result = sock.connect_ex((config['host'], config['port']))
                if result == 0:
                    services[name]['status'] = 'alive'
                else:
                    services[name]['status'] = 'down'
                sock.close()
            except Exception as e:
                services[name]['status'] = f'error: {str(e)}'
        
        return services
    
    def update_identity(self):
        '''Combine scan + pulse into JSON Identity Map'''
        # Archive existing identity if present
        if self.identity_path.exists():
            try:
                if self.backup_path.exists():
                    self.backup_path.unlink()
                self.identity_path.rename(self.backup_path)
            except Exception as e:
                print(f'[Cartographer] Warning: Could not archive identity: {e}')
        
        # Build identity map
        identity = {
            'name': 'The Cortex',
            'version': '1.0.0',
            'timestamp': datetime.now().isoformat(),
            'identity': {
                'role': 'Local Knowledge Graph and Tool Server',
                'designation': 'Level 23: The Cartographer',
                'awakening': 'Self-discovery module initialized'
            },
            'modules': self.scan_cortex(),
            'services': self.check_pulse(),
            'status': 'operational',
            'total_levels': len(LEVEL_MAP),
            'level_map': LEVEL_MAP
        }
        
        # Save identity
        try:
            with open(self.identity_path, 'w') as f:
                json.dump(identity, f, indent=2)
            print(f'[Cartographer] Identity map saved to {self.identity_path}')
        except Exception as e:
            print(f'[Cartographer] Error saving identity: {e}')
        
        return identity
    
    def get_all_levels(self):
        '''Return all registered levels'''
        return LEVEL_MAP
    
    def get_level_name(self, level_num):
        '''Get level name by number'''
        return LEVEL_MAP.get(level_num, 'unknown')
    
    def get_level_number(self, level_name):
        '''Get level number by name'''
        return NAME_TO_LEVEL.get(level_name, 0)
