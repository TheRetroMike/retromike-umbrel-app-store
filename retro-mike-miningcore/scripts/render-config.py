#!/usr/bin/env python3
"""Generate /home/umbrel/.miningcore/config.json from:
- /home/umbrel/.miningcore/config.base.json
- /home/umbrel/.miningcore/pools.d/*.json
- /home/umbrel/.miningcore/fees.json

Designed to be run on the Umbrel host from hooks.
"""

from __future__ import annotations

import glob
import json
import os
import sys
from typing import Any, Dict, List

BASE_DIR = os.environ.get("MININGCORE_HOME", "/home/umbrel/.miningcore")
BASE_CONFIG = os.path.join(BASE_DIR, "config.base.json")
POOLS_DIR = os.path.join(BASE_DIR, "pools.d")
OUT_CONFIG = os.path.join(BASE_DIR, "config.json")
FEES = os.path.join(BASE_DIR, "fees.json")


def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _atomic_write(path: str, content: str) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def main() -> int:
    if not os.path.exists(BASE_CONFIG):
        print(f"ERROR: base config missing: {BASE_CONFIG}", file=sys.stderr)
        return 2

    os.makedirs(POOLS_DIR, exist_ok=True)

    base: Dict[str, Any] = _load_json(BASE_CONFIG)

    # Load pool fragments
    pools: List[Dict[str, Any]] = []
    for p in sorted(glob.glob(os.path.join(POOLS_DIR, "*.json"))):
        try:
            pool = _load_json(p)
            if isinstance(pool, dict) and pool.get("id") and pool.get("coin"):
                pools.append(pool)
        except Exception as e:
            print(f"WARN: failed to parse pool fragment {p}: {e}", file=sys.stderr)

    # Apply fee recipients (optional)
    fee_conf: Dict[str, Any] = {}
    if os.path.exists(FEES):
        try:
            fee_conf = _load_json(FEES)
        except Exception as e:
            print(f"WARN: failed to parse fees.json: {e}", file=sys.stderr)

    default_fee = fee_conf.get("default", {}) if isinstance(fee_conf, dict) else {}
    try:
        fee_pct = float(default_fee.get("percentage", 0))
    except Exception:
        fee_pct = 0

    fee_addr_default = default_fee.get("address")
    per_pool_addrs = fee_conf.get("addresses", {}) if isinstance(fee_conf, dict) else {}

    def _append_fee(pool_obj: Dict[str, Any]) -> None:
        if fee_pct <= 0:
            return
        pool_id = pool_obj.get("id")
        fee_addr = None
        if isinstance(per_pool_addrs, dict) and pool_id in per_pool_addrs:
            fee_addr = per_pool_addrs.get(pool_id)
        if not fee_addr:
            fee_addr = fee_addr_default
        if not fee_addr or str(fee_addr).startswith("CHANGE_ME"):
            return

        rr = pool_obj.get("rewardRecipients")
        if rr is None:
            rr = []
            pool_obj["rewardRecipients"] = rr

        if not isinstance(rr, list):
            return

        # Avoid duplicates
        if any(isinstance(r, dict) and r.get("address") == fee_addr for r in rr):
            return

        rr.append({"address": fee_addr, "percentage": fee_pct})

    for pool in pools:
        _append_fee(pool)

    base["pools"] = pools

    rendered = json.dumps(base, indent=2, sort_keys=False)
    _atomic_write(OUT_CONFIG, rendered + "\n")
    print(f"Wrote {OUT_CONFIG} with {len(pools)} pool(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
