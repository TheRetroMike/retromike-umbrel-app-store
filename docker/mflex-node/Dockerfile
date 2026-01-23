# syntax=docker/dockerfile:1.7
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG MFLEX_TAG=v1.11.0rc1-mflex2
ARG MFLEX_ASSET=multiflex-v1.11.0rc1-mflex2-linux-x86_64.tar.gz

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tar bash \
 && rm -rf /var/lib/apt/lists/*

# Download + extract release tarball
RUN set -eux; \
    mkdir -p /opt/mflex; \
    curl -fsSL "https://github.com/Aalnase/multiflexcoin/releases/download/${MFLEX_TAG}/${MFLEX_ASSET}" -o /tmp/mflex.tgz; \
    tar -xzf /tmp/mflex.tgz -C /opt/mflex; \
    rm -f /tmp/mflex.tgz; \
    MFLEXD="$(find /opt/mflex -type f -name multiflexd | head -n1)"; \
    MFLEXCLI="$(find /opt/mflex -type f -name multiflex-cli | head -n1 || true)"; \
    test -n "${MFLEXD}"; \
    ln -sf "${MFLEXD}" /usr/local/bin/multiflexd; \
    if [ -n "${MFLEXCLI}" ]; then ln -sf "${MFLEXCLI}" /usr/local/bin/multiflex-cli; fi

COPY entrypoint.sh /usr/local/bin/mflex-entrypoint.sh
RUN chmod +x /usr/local/bin/mflex-entrypoint.sh

VOLUME ["/data"]
EXPOSE 9010 7010 24200

ENTRYPOINT ["/usr/local/bin/mflex-entrypoint.sh"]
