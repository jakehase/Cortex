from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

@router.get("/", response_class=HTMLResponse)
async def get_dashboard():
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>◈ THE MIRROR v2.1 ◈</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            background: #000;
            color: #00ff41;
            font-family: 'Courier New', Courier, monospace;
            min-height: 100vh;
            padding: 40px 20px;
            overflow-x: hidden;
        }
        
        /* SCANLINE EFFECT */
        body::before {
            content: "";
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: repeating-linear-gradient(
                0deg,
                rgba(0, 0, 0, 0.15),
                rgba(0, 0, 0, 0.15) 1px,
                transparent 1px,
                transparent 2px
            );
            pointer-events: none;
            z-index: 1000;
        }
        
        /* HEADER */
        .header {
            text-align: center;
            margin-bottom: 50px;
            position: relative;
        }
        
        .header h1 {
            font-size: 3rem;
            letter-spacing: 15px;
            text-shadow: 
                0 0 10px #00ff41,
                0 0 20px #00ff41,
                0 0 40px #00ff41;
            animation: flicker 4s infinite;
        }
        
        .header::after {
            content: "═══════════════════════════════════════";
            display: block;
            margin-top: 20px;
            color: #00ff41;
            opacity: 0.5;
            letter-spacing: 5px;
        }
        
        @keyframes flicker {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.95; }
            52% { opacity: 0.5; }
            54% { opacity: 0.95; }
        }
        
        /* GRID */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 30px;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        /* CARDS */
        .card {
            background: rgba(0, 20, 0, 0.8);
            border: 2px solid #003b00;
            padding: 30px;
            position: relative;
            transition: all 0.3s ease;
        }
        
        .card::before {
            content: "◢";
            position: absolute;
            top: 10px;
            left: 15px;
            color: #00ff41;
            opacity: 0.3;
            font-size: 12px;
        }
        
        .card::after {
            content: "◣";
            position: absolute;
            bottom: 10px;
            right: 15px;
            color: #00ff41;
            opacity: 0.3;
            font-size: 12px;
        }
        
        .card h2 {
            font-size: 14px;
            letter-spacing: 4px;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 1px solid #003b00;
            text-transform: uppercase;
        }
        
        /* STATUS */
        .status-large {
            font-size: 2.5rem;
            font-weight: bold;
            margin: 20px 0;
            text-shadow: 0 0 10px currentColor;
            transition: all 0.3s ease;
        }
        
        .status-online { color: #00ff41; }
        .status-offline { color: #ff0040; text-shadow: 0 0 10px #ff0040; }
        .status-thinking { color: #fff; text-shadow: 0 0 20px #fff; }
        
        /* META */
        .meta {
            font-size: 12px;
            color: #008f11;
            letter-spacing: 2px;
            display: flex;
            justify-content: space-between;
            border-top: 1px solid #003b00;
            padding-top: 15px;
            margin-top: 15px;
        }
        
        /* PULSING ANIMATION */
        .pulsing {
            border-color: #00ff41 !important;
            box-shadow: 
                0 0 20px rgba(0, 255, 65, 0.5),
                0 0 40px rgba(0, 255, 65, 0.3),
                inset 0 0 20px rgba(0, 255, 65, 0.1);
            animation: breathe 1.5s ease-in-out infinite alternate;
        }
        
        @keyframes breathe {
            from {
                box-shadow: 
                    0 0 10px rgba(0, 255, 65, 0.3),
                    0 0 20px rgba(0, 255, 65, 0.1),
                    inset 0 0 10px rgba(0, 255, 65, 0.05);
            }
            to {
                box-shadow: 
                    0 0 30px rgba(0, 255, 65, 0.8),
                    0 0 60px rgba(0, 255, 65, 0.4),
                    inset 0 0 30px rgba(0, 255, 65, 0.2);
            }
        }
        
        /* FOOTER */
        .footer {
            text-align: center;
            margin-top: 50px;
            color: #003b00;
            font-size: 12px;
            letter-spacing: 3px;
        }
        
        .blink {
            animation: blink 1s infinite;
        }
        
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>◈ THE MIRROR ◈</h1>
    </div>
    
    <div class="grid">
        <!-- BRAIN (ORACLE) -->
        <div id="card-brain" class="card">
            <h2>◉ BRAIN (ORACLE)</h2>
            <div id="status-brain" class="status-large status-offline">OFFLINE</div>
            <div class="meta">
                <span>MODEL</span>
                <span id="meta-brain">--</span>
            </div>
        </div>
        
        <!-- MEMORY (LIBRARIAN) -->
        <div id="card-memory" class="card">
            <h2>◉ MEMORY (LIBRARIAN)</h2>
            <div id="status-memory" class="status-large status-online">0</div>
            <div class="meta">
                <span>VECTORS</span>
                <span>ACTIVE</span>
            </div>
        </div>
        
        <!-- QUEUE (JOBS) -->
        <div id="card-queue" class="card">
            <h2>◉ QUEUE (JOBS)</h2>
            <div id="status-queue" class="status-large status-offline">OFFLINE</div>
            <div class="meta">
                <span>ACTIVE JOBS</span>
                <span id="meta-queue">0</span>
            </div>
        </div>
        
        <!-- SCHEDULER (CRON) -->
        <div id="card-cron" class="card">
            <h2>◉ SCHEDULER (CRON)</h2>
            <div id="status-cron" class="status-large status-online">0</div>
            <div class="meta">
                <span>JOBS</span>
                <span>SCHEDULED</span>
            </div>
        </div>
    </div>
    
    <div class="footer">
        <span class="blink">◈</span> CORTEX SYSTEM DASHBOARD v2.1 <span class="blink">◈</span>
    </div>
    
    <script>
        // Failure counters for stability
        const fails = { brain: 0, memory: 0, queue: 0, cron: 0 };
        
        function updateDashboard() {
            // 1. BRAIN (Oracle) - PULSES when is_busy
            fetch('/oracle/status')
                .then(r => r.json())
                .then(data => {
                    fails.brain = 0;
                    const card = document.getElementById('card-brain');
                    const text = document.getElementById('status-brain');
                    
                    document.getElementById('meta-brain').innerText = data.default_model?.toUpperCase() || '--';
                    
                    if (data.is_busy) {
                        card.classList.add('pulsing');
                        text.innerText = 'THINKING...';
                        text.className = 'status-large status-thinking';
                    } else {
                        card.classList.remove('pulsing');
                        text.innerText = 'ONLINE';
                        text.className = 'status-large status-online';
                    }
                })
                .catch(() => {
                    fails.brain++;
                    if (fails.brain > 3) {
                        const card = document.getElementById('card-brain');
                        const text = document.getElementById('status-brain');
                        card.classList.remove('pulsing');
                        text.innerText = 'OFFLINE';
                        text.className = 'status-large status-offline';
                    }
                });
            
            // 2. QUEUE (Jobs) - PULSES when active_jobs > 0
            fetch('/queue/status')
                .then(r => r.json())
                .then(data => {
                    fails.queue = 0;
                    const card = document.getElementById('card-queue');
                    const text = document.getElementById('status-queue');
                    
                    document.getElementById('meta-queue').innerText = data.active_jobs || 0;
                    
                    if (data.active_jobs > 0) {
                        card.classList.add('pulsing');
                        text.innerText = 'ACTIVE (' + data.active_jobs + ')';
                        text.className = 'status-large status-online';
                    } else if (data.status === 'online') {
                        card.classList.remove('pulsing');
                        text.innerText = 'IDLE';
                        text.className = 'status-large status-online';
                    } else {
                        card.classList.remove('pulsing');
                        text.innerText = 'OFFLINE';
                        text.className = 'status-large status-offline';
                    }
                })
                .catch(() => {
                    fails.queue++;
                    if (fails.queue > 3) {
                        const card = document.getElementById('card-queue');
                        const text = document.getElementById('status-queue');
                        card.classList.remove('pulsing');
                        text.innerText = 'OFFLINE';
                        text.className = 'status-large status-offline';
                    }
                });
            
            // 3. MEMORY (Librarian)
            fetch('/librarian/stats')
                .then(r => r.json())
                .then(data => {
                    fails.memory = 0;
                    document.getElementById('status-memory').innerText = data.total_memories || 0;
                })
                .catch(() => {
                    fails.memory++;
                    if (fails.memory > 3) {
                        document.getElementById('status-memory').innerText = 'ERR';
                    }
                });
            
            // 4. SCHEDULER (Cron)
            fetch('/cron/jobs')
                .then(r => r.json())
                .then(data => {
                    fails.cron = 0;
                    document.getElementById('status-cron').innerText = data.jobs ? data.jobs.length : 0;
                })
                .catch(() => {
                    fails.cron++;
                    if (fails.cron > 3) {
                        document.getElementById('status-cron').innerText = 'ERR';
                    }
                });
        }
        
        // Poll every 1000ms
        setInterval(updateDashboard, 1000);
        updateDashboard();
    </script>
</body>
</html>"""

@router.get("/status")
async def mirror_status():
    return {"status": "active", "version": "2.1"}
