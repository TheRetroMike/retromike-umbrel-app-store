# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:6.0-jammy AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip \
    cmake clang ninja-build build-essential \
    libssl-dev pkg-config libboost-all-dev \
    libsodium-dev libzmq5 libzmq3-dev \
    golang-go libgmp-dev libc++-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# IMPORTANT: Full clone (GitVersion needs history/tags)
RUN git clone --branch dev https://github.com/xiaolin1579/miningcore.git miningcore

WORKDIR /src/miningcore

# Ensure tags exist (GitVersion uses them)
RUN git fetch --tags --force

# Apply your patch BEFORE compile (zip contains src/Miningcore/...)
COPY Miningcore-src.zip /tmp/Miningcore-src.zip
RUN unzip -o /tmp/Miningcore-src.zip -d /src/miningcore

WORKDIR /src/miningcore/src/Miningcore
RUN dotnet publish -c Release --framework net6.0 -o /app/build

FROM mcr.microsoft.com/dotnet/runtime:6.0-jammy
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzmq5 libsodium23 libgmp10 zlib1g libc++1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/build
COPY --from=build /app/build/ /app/build/

ENTRYPOINT ["/app/build/Miningcore","-c","/app/config.json"]
