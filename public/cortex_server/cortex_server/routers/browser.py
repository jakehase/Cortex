from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import base64
import re

router = APIRouter()


class BrowseRequest(BaseModel):
    url: str


class ScreenshotRequest(BaseModel):
    url: str
    full_page: Optional[bool] = False


class SearchRequest(BaseModel):
    query: str


def _soup_to_markdown_text(html: str) -> str:
    """Basic cleanup to extract readable text and return as markdown-friendly text."""
    soup = BeautifulSoup(html, "html.parser")

    # Remove scripts/styles
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    # Get text and normalize whitespace
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    # Collapse multiple blank lines
    cleaned = "\n".join([line for line in lines if line])
    # Convert consecutive newlines to markdown paragraph spacing
    cleaned = re.sub(r"\n{2,}", "\n\n", cleaned)
    return cleaned.strip()


@router.post("/browse")
async def browser_browse(req: BrowseRequest) -> str:
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
            page = await browser.new_page()
            await page.goto(req.url, wait_until="networkidle", timeout=30000)
            html = await page.content()
            await browser.close()

        return _soup_to_markdown_text(html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Browse failed: {e}")


@router.post("/screenshot")
async def browser_screenshot(req: ScreenshotRequest) -> Dict[str, Any]:
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
            page = await browser.new_page()
            await page.goto(req.url, wait_until="networkidle", timeout=30000)
            screenshot_bytes = await page.screenshot(full_page=bool(req.full_page), type="png")
            await browser.close()

        encoded = base64.b64encode(screenshot_bytes).decode("utf-8")
        return {"success": True, "data": {"base64": encoded, "format": "png"}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Screenshot failed: {e}")


@router.post("/search")
async def browser_search(req: SearchRequest) -> List[Dict[str, str]]:
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
            # Set realistic browser context to avoid bot detection
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await context.new_page()
            
            # Add extra headers to look more like a real browser
            await page.set_extra_http_headers({
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
            
            # Use Startpage search (more bot-friendly HTML interface)
            search_url = f"https://www.startpage.com/sp/search?q={req.query.replace(' ', '+')}"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            
            # Wait a moment for results to load
            await page.wait_for_timeout(3000)

            # Get page content for parsing
            html = await page.content()
            soup = BeautifulSoup(html, "html.parser")
            
            results = []
            
            # Startpage result selectors
            result_containers = soup.select(".result")
            
            for container in result_containers:
                if len(results) >= 5:
                    break
                
                # Try to find the link and title
                link_el = container.select_one("a.result-title") or container.select_one("h3 a") or container.select_one("a[href^='http']")
                if link_el:
                    title = link_el.get_text(strip=True)
                    href = link_el.get("href")
                    
                    # Filter out internal links and empty titles
                    if title and href and href.startswith('http') and 'startpage.com' not in href:
                        results.append({"title": title, "link": href})

            await browser.close()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")
