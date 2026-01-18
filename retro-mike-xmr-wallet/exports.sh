mkdir -p /home/umbrel/umbrel/app-data/retro-mike-xmr-wallet/.monero
if [ ! -f /home/umbrel/umbrel/app-data/retro-mike-xmr-wallet/.monero/default.keys ]; then
    wget https://downloads.getmonero.org/cli/monero-linux-x64-v0.18.4.5.tar.bz2
    tar xf monero-linux-x64-v0.18.4.5.tar.bz2
    cd monero-x86_64-linux-gnu-v0.18.4.5
    ./monero-wallet-cli --password poolpassword --use-english-language-names --generate-new-wallet /home/umbrel/umbrel/retro-mike-xmr-wallet/.monero/default 2>/dev/null
fi