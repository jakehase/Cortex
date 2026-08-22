"""Ghost Module - Native Browser Automation for Celery Workers.

Provides synchronous browser automation using Playwright.
This allows Celery workers to browse the web directly without API calls.
"""
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import re
from typing import List, Dict, Optional


class Ghost:
    """Synchronous web browser for Celery task workers."""
    
    def __init__(self, headless: bool = True):
        self.headless = headless
        self._playwright = None
        self._browser = None
    
    def _init_browser(self):
        """Initialize Playwright browser if not already running."""
        if self._playwright is None:
            self._playwright = sync_playwright().start()
        if self._browser is None:
            self._browser = self._playwright.chromium.launch(
                headless=self.headless,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
    
    def _close(self):
        """Close browser and playwright."""
        if self._browser:
            self._browser.close()
            self._browser = None
        if self._playwright:
            self._playwright.stop()
            self._playwright = None
    
    def browse(self, url: str) -> str:
        """Browse a URL and return markdown-friendly text content."""
        self._init_browser()
        try:
            page = self._browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            html = page.content()
            page.close()
            return self._html_to_text(html)
        finally:
            self._close()
    
    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        """Search the web using Startpage and return results."""
        self._init_browser()
        try:
            # Set realistic browser context to avoid bot detection
            context = self._browser.new_context(
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = context.new_page()
            
            # Add extra headers to look more like a real browser
            page.set_extra_http_headers({
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
            })
            
            # Use Startpage search
            search_url = f"https://www.startpage.com/sp/search?q={query.replace(' ', '+')}"
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)  # Wait for results
            
            # Parse results
            html = page.content()
            soup = BeautifulSoup(html, "html.parser")
            
            results = []
            result_containers = soup.select(".result")
            
            for container in result_containers:
                if len(results) >= max_results:
                    break
                
                link_el = container.select_one("a.result-title") or container.select_one("h3 a") or container.select_one("a[href^='http']")
                if link_el:
                    title = link_el.get_text(strip=True)
                    href = link_el.get("href")
                    
                    if title and href and href.startswith('http') and 'startpage.com' not in href:
                        results.append({"title": title, "link": href})
            
            context.close()
            return results
        finally:
            self._close()
    
    def screenshot(self, url: str, full_page: bool = False) -> bytes:
        """Take a screenshot of a URL and return raw bytes."""
        self._init_browser()
        try:
            page = self._browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            screenshot_bytes = page.screenshot(full_page=full_page, type="png")
            page.close()
            return screenshot_bytes
        finally:
            self._close()
    
    @staticmethod
    def _html_to_text(html: str) -> str:
        """Convert HTML to readable markdown-friendly text."""
        soup = BeautifulSoup(html, "html.parser")
        
        # Remove scripts/styles
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        
        # Get text and normalize whitespace
        text = soup.get_text(separator="\n")
        lines = [line.strip() for line in text.splitlines()]
        cleaned = "\n".join([line for line in lines if line])
        cleaned = re.sub(r"\n{2,}", "\n\n", cleaned)
        return cleaned.strip()
