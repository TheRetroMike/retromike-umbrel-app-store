import os, json, datetime
from pathlib import Path
from flask import Flask, request, render_template, send_from_directory, redirect, url_for, flash
import requests
from werkzeug.utils import secure_filename

RPC_USER = os.environ.get("RPC_USER", "pooluser")
RPC_PASS = os.environ.get("RPC_PASS", "poolpassword")
POOLS_DIR = Path(os.environ.get("POOLS_DIR", "/miningcore/pools.d"))
BACKUPS_DIR = Path(os.environ.get("BACKUPS_DIR", "/backups"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "200"))

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "umbrel-wallet-tools")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

def load_pools():
    pools = []
    if not POOLS_DIR.exists():
        return pools
    for f in sorted(POOLS_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text())
            daemon = (d.get("daemons") or [{}])[0]
            pools.append({
                "pool_id": d.get("id") or f.stem,
                "coin": d.get("coin", ""),
                "rpc_host": daemon.get("host", ""),
                "rpc_port": int(daemon.get("port", 0) or 0),
            })
        except Exception:
            continue
    return pools

def rpc_url(pool, wallet=None):
    host = pool["rpc_host"]
    port = pool["rpc_port"]
    if wallet:
        return f"http://{host}:{port}/wallet/{wallet}"
    return f"http://{host}:{port}/"

def rpc_call(pool, method, params=None, wallet=None):
    if params is None:
        params = []
    url = rpc_url(pool, wallet=wallet)
    payload = {"jsonrpc":"1.0","id":"wallet-tools","method":method,"params":params}
    r = requests.post(url, auth=(RPC_USER, RPC_PASS), json=payload, timeout=10)
    r.raise_for_status()
    data = r.json()
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data.get("result")

def list_backups(pool_id):
    p = BACKUPS_DIR / pool_id
    if not p.exists():
        return []
    files = []
    for f in sorted(p.glob("*")):
        if f.is_file():
            files.append(f.name)
    return files

@app.get("/")
def index():
    pools = load_pools()
    selected = request.args.get("pool_id") or (pools[0]["pool_id"] if pools else "")
    wallet = request.args.get("wallet", "pool")
    backups = {p["pool_id"]: list_backups(p["pool_id"]) for p in pools}
    return render_template("index.html", pools=pools, selected=selected, wallet=wallet, backups=backups)

@app.post("/init-wallet")
def init_wallet():
    pool_id = request.form.get("pool_id","")
    wallet = request.form.get("wallet","pool").strip()
    pools = {p["pool_id"]: p for p in load_pools()}
    if pool_id not in pools:
        flash("Unknown pool", "err")
        return redirect(url_for("index"))

    pool = pools[pool_id]
    try:
        # createwallet/loadwallet must be called on root endpoint (no /wallet/<name>)
        try:
            rpc_call(pool, "createwallet", [wallet])
        except Exception:
            pass
        try:
            rpc_call(pool, "loadwallet", [wallet])
        except Exception:
            pass
        flash(f"Wallet '{wallet}' created/loaded (if supported).", "ok")
    except Exception as e:
        flash(f"Init wallet failed: {e}", "err")

    return redirect(url_for("index", pool_id=pool_id, wallet=wallet))

@app.post("/backup")
def backup():
    pool_id = request.form.get("pool_id","")
    wallet = request.form.get("wallet","").strip()
    pools = {p["pool_id"]: p for p in load_pools()}
    if pool_id not in pools:
        flash("Unknown pool", "err")
        return redirect(url_for("index"))

    pool = pools[pool_id]
    ts = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    dest_dir = BACKUPS_DIR / pool_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{wallet or 'default'}-{ts}.dat"

    try:
        # backupwallet is a wallet RPC in most bitcoin-core forks -> use wallet endpoint if wallet is set
        if wallet:
            rpc_call(pool, "backupwallet", [str(dest)], wallet=wallet)
        else:
            rpc_call(pool, "backupwallet", [str(dest)], wallet=None)
        flash(f"Backup created: {dest}", "ok")
    except Exception as e:
        flash(f"Backup failed: {e}", "err")

    return redirect(url_for("index", pool_id=pool_id, wallet=wallet or "pool"))

@app.post("/upload")
def upload():
    pool_id = request.form.get("pool_id","")
    wallet = request.form.get("wallet","pool").strip()
    file = request.files.get("file")
    if not file or file.filename.strip() == "":
        flash("No file selected", "err")
        return redirect(url_for("index", pool_id=pool_id, wallet=wallet))

    filename = secure_filename(file.filename)
    up_dir = BACKUPS_DIR / "uploads" / pool_id
    up_dir.mkdir(parents=True, exist_ok=True)
    dest = up_dir / filename
    file.save(dest)

    # show SSH commands (generic + uses docker inspect to locate datadir)
    pools = {p["pool_id"]: p for p in load_pools()}
    pool = pools.get(pool_id)
    daemon_host = pool["rpc_host"] if pool else "<NODE_CONTAINER_NAME>"
    rpc_port = pool["rpc_port"] if pool else "<RPC_PORT>"

    cmds = f"""# 1) Stop node container
sudo docker stop {daemon_host}

# 2) Find datadir source on host (look for /data or /root/.<coin> destination)
sudo docker inspect -f '{{{{range .Mounts}}}}{{{{println .Destination "->" .Source}}}}{{{{end}}}}' {daemon_host}

# 3) Copy uploaded wallet file into the wallet location
# Uploaded file:
#   {dest}
#
# Typical multiwallet path:
#   <DATADIR_SOURCE>/wallets/{wallet}/wallet.dat
#
# If your daemon uses single wallet.dat:
#   <DATADIR_SOURCE>/wallet.dat

# Example (multiwallet):
sudo mkdir -p "<DATADIR_SOURCE>/wallets/{wallet}"
sudo cp "{dest}" "<DATADIR_SOURCE>/wallets/{wallet}/wallet.dat"

# 4) Start node container
sudo docker start {daemon_host}

# 5) Load wallet (if supported):
curl --user {RPC_USER}:{RPC_PASS} -H 'content-type: text/plain;' \\
  --data-binary '{{"jsonrpc":"1.0","id":"lw","method":"loadwallet","params":["{wallet}"]}}' \\
  http://127.0.0.1:{rpc_port}/
"""
    return render_template("upload_done.html", pool_id=pool_id, wallet=wallet, filename=filename, dest=str(dest), cmds=cmds)

@app.get("/download/<pool_id>/<path:filename>")
def download(pool_id, filename):
    d = BACKUPS_DIR / pool_id
    return send_from_directory(d, filename, as_attachment=True)
