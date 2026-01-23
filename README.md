# RetroMike Umbrel App Store (Auto-Configured MiningCore Fork)

This is a fork of RetroMike's Umbrel community app store with a focus on **MiningCore SOLO pool automation**. Without this Fork Multiflex will not work!

## What’s new

- MiningCore initializes its **Postgres role / database / schema** automatically
- Each supported coin node app automatically **registers / unregisters** itself in MiningCore
- MiningCore `config.json` is generated from a base template + `pools.d/*.json` fragments
- A default **0.3% fee recipient** can be configured/changed by the user

## Files on the Umbrel host

- `/home/umbrel/.miningcore/config.base.json` – base template (you can edit)
- `/home/umbrel/.miningcore/pools.d/*.json` – per-coin fragments (auto-managed)
- `/home/umbrel/.miningcore/config.json` – generated file used by MiningCore
- `/home/umbrel/.miningcore/fees.json` – fee recipient configuration (editable)

## Install order

1. Install **RetroMike Postgres**
2. Install **MiningCore**
3. Install one or more coin node apps (BTC/BCH/DOGE/…)
4. (Optional) Install **MiningCore WebUI**

## Fee configuration

Edit `/home/umbrel/.miningcore/fees.json` to change or remove the fee recipient.

## Multiflex (MFLEX)

The Multiflex node app is included, but you must publish a Multiflex docker image first and update `retro-mike-mflex-node/docker-compose.yml`.
