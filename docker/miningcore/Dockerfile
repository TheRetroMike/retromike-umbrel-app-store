# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:6.0-jammy AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip ca-certificates \
    cmake clang ninja-build build-essential \
    libssl-dev pkg-config libboost-all-dev \
    libsodium-dev libzmq5 libzmq3-dev \
    golang-go libgmp-dev libc++-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Base Miningcore (dev) + Patch ZIP drüber
RUN git clone --branch dev https://github.com/xiaolin1579/miningcore.git miningcore
WORKDIR /src/miningcore
RUN git fetch --tags --force || true

COPY Miningcore-src.zip /tmp/Miningcore-src.zip
RUN unzip -o /tmp/Miningcore-src.zip -d /src/miningcore && rm -f /tmp/Miningcore-src.zip

WORKDIR /src/miningcore/src/Miningcore
RUN dotnet publish -c Release --framework net6.0 -o /app/build

# ✅ IMPORTANT: aspnet runtime includes Microsoft.AspNetCore.App
FROM mcr.microsoft.com/dotnet/aspnet:6.0-jammy AS runtime

# native runtime libs + symlinks for zmq/sodium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzmq5 libsodium23 libgmp10 zlib1g libc++1 \
 && ln -sf /usr/lib/x86_64-linux-gnu/libzmq.so.5 /usr/lib/x86_64-linux-gnu/libzmq.so \
 && ln -sf /usr/lib/x86_64-linux-gnu/libzmq.so.5 /usr/lib/x86_64-linux-gnu/liblibzmq.so \
 && ln -sf /usr/lib/x86_64-linux-gnu/libsodium.so.23 /usr/lib/x86_64-linux-gnu/libsodium.so \
 && ln -sf /usr/lib/x86_64-linux-gnu/libsodium.so.23 /usr/lib/x86_64-linux-gnu/liblibsodium.so \
 && ldconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/build
COPY --from=build /app/build/ /app/build/

ENTRYPOINT ["dotnet","/app/build/Miningcore.dll","-c","/app/config.json"]

