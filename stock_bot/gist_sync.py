"""
gist_sync.py
============
Syncs stock logs to the existing MD Dashboard Gist (same one used by sales_dashboard).

Uses the same Gist ID Isaac already has configured, so stock.html can read the
logs using the same GistSync JS module the other pages already have.

Files pushed:
  stock_orders.json    ← orders_log.json
  stock_grn.json       ← grn_log.json
  stock_transfers.json ← transfers_log.json
  stock_unknown.json   ← unknown_skus.json

Strategy:
  • Debounced push — after a message is processed, wait N seconds, then push if no
    new message arrived. Avoids hammering GitHub API with every single Telegram msg.
  • On-demand push — called manually via /syncnow command.
  • Daily push — always pushes right before the digest at 8pm.

Env vars needed:
  GITHUB_GIST_ID    — existing gist id (default: Isaac's MD dashboard gist)
  GITHUB_TOKEN      — token with gist scope
"""
from __future__ import annotations
import os
import json
import time
import asyncio
import logging
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger('gist_sync')

DEFAULT_GIST_ID = 'ceb4064c9e2a6d37c6e52c3b02f04a1d'   # Isaac's existing gist

# Mapping local log files → gist filenames (prefixed 'stock_' to namespace)
FILE_MAP = {
    'orders_log.json':     'stock_orders.json',
    'grn_log.json':        'stock_grn.json',
    'transfers_log.json':  'stock_transfers.json',
    'unknown_skus.json':   'stock_unknown.json',
}


class GistSync:
    """Debounced, thread-safe Gist uploader for stock logs."""
    
    def __init__(self, base_dir: Path, gist_id: str | None = None, token: str | None = None,
                 debounce_seconds: int = 30):
        self.base_dir = Path(base_dir)
        self.gist_id  = gist_id or os.environ.get('GITHUB_GIST_ID') or DEFAULT_GIST_ID
        self.token    = token   or os.environ.get('GITHUB_TOKEN', '')
        self.debounce = debounce_seconds
        
        self._pending = False
        self._last_push_request = 0.0
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
    
    def is_configured(self) -> bool:
        return bool(self.gist_id and self.token)
    
    # ── Public API ───────────────────────────────────────────────────────
    def schedule(self) -> None:
        """Mark that a push is needed. Actual push happens after debounce window."""
        if not self.is_configured():
            return
        with self._lock:
            self._last_push_request = time.time()
            self._pending = True
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.debounce, self._push_if_due)
            self._timer.daemon = True
            self._timer.start()
    
    def push_now(self) -> dict:
        """Immediate synchronous push of all log files. Returns summary dict."""
        if not self.is_configured():
            return {'ok': False, 'error': 'not configured'}
        return self._push()
    
    def cancel(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None
    
    # ── Internal ─────────────────────────────────────────────────────────
    def _push_if_due(self) -> None:
        with self._lock:
            if not self._pending:
                return
            age = time.time() - self._last_push_request
            if age < self.debounce - 0.5:
                return  # another scheduling happened, let that one fire
            self._pending = False
        try:
            self._push()
        except Exception as e:
            log.exception(f"Debounced push failed: {e}")
    
    def _push(self) -> dict:
        """Build the Gist PATCH payload from all available log files."""
        try:
            import urllib.request
            import urllib.error
        except ImportError:
            return {'ok': False, 'error': 'urllib not available'}
        
        files: dict[str, dict] = {}
        for local_name, gist_name in FILE_MAP.items():
            path = self.base_dir / local_name
            if not path.exists():
                continue
            try:
                content = path.read_text(encoding='utf-8')
                # Ensure valid JSON — if file is corrupt, skip
                json.loads(content)
                files[gist_name] = {'content': content}
            except Exception as e:
                log.warning(f"Skipping {local_name}: {e}")
        
        if not files:
            return {'ok': True, 'pushed': 0, 'note': 'no files to push'}
        
        # Also push a tiny meta file so stock.html knows when data was last synced
        meta = {
            'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'file_count': len(files),
            'source': 'stock_bot_listener',
        }
        files['stock_meta.json'] = {'content': json.dumps(meta, indent=2)}
        
        payload = json.dumps({'files': files}).encode('utf-8')
        req = urllib.request.Request(
            f'https://api.github.com/gists/{self.gist_id}',
            data=payload,
            method='PATCH',
            headers={
                'Authorization': f'Bearer {self.token}',
                'Accept':        'application/vnd.github+json',
                'Content-Type':  'application/json',
                'User-Agent':    'miracle-stock-bot',
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                status = r.status
                ok = 200 <= status < 300
                if ok:
                    log.info(f"✓ Gist push OK ({len(files)} files)")
                else:
                    log.warning(f"Gist push returned {status}")
                return {'ok': ok, 'pushed': len(files), 'status': status}
        except urllib.error.HTTPError as e:
            log.error(f"Gist HTTP {e.code}: {e.reason}")
            return {'ok': False, 'error': f'HTTP {e.code}: {e.reason}'}
        except Exception as e:
            log.exception(f"Gist push exception: {e}")
            return {'ok': False, 'error': str(e)}
