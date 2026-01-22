# syntax=docker/dockerfile:1.7

# Miningcore (patched for MFLEX) - linux/amd64 build
ARG MC_REPO=https://github.com/xiaolin1579/miningcore.git
ARG MC_BRANCH=dev

FROM mcr.microsoft.com/dotnet/sdk:6.0-jammy AS build
ARG MC_REPO
ARG MC_BRANCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip \
    libssl-dev pkg-config libboost-all-dev libsodium-dev build-essential cmake \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "${MC_BRANCH}" "${MC_REPO}" miningcore

# Apply MFLEX patch (overwrites files under src/Miningcore/...)
COPY Miningcore-src.zip /tmp/Miningcore-src.zip
RUN unzip -o /tmp/Miningcore-src.zip -d /src/miningcore

WORKDIR /src/miningcore/src/Miningcore
RUN dotnet publish -c Release -o /app/build

FROM mcr.microsoft.com/dotnet/runtime:6.0-jammy AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsodium23 libssl3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/build
COPY --from=build /app/build/ /app/build/

# Config is mounted at /app/config.json, coins.json is mounted at /app/build/coins.json
ENTRYPOINT ["/app/build/Miningcore","-c","/app/config.json"]
