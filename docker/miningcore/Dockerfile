# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:6.0-jammy AS build

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    NUGET_XMLDOC_MODE=skip

RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip ca-certificates \
    cmake clang ninja-build build-essential \
    libssl-dev pkg-config libboost-all-dev \
    libsodium-dev libzmq5 libzmq3-dev \
    golang-go libgmp-dev libc++-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

# NuGet: Source + Timeout (fix für NU1100 und Timeouts)
RUN mkdir -p /root/.nuget/NuGet && cat > /root/.nuget/NuGet/NuGet.Config <<'NUGET'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
  <config>
    <add key="httpTimeout" value="600" />
    <add key="maxHttpRequestsPerSource" value="4" />
  </config>
</configuration>
NUGET

WORKDIR /src

# Base Miningcore (dev)
RUN git clone https://github.com/blackmennewstyle/miningcore.git miningcore
WORKDIR /src/miningcore
RUN git fetch --tags --force || true

# Patch ZIP drüber (vor dem Kompilieren)
COPY Miningcore-src.zip /tmp/Miningcore-src.zip
RUN unzip -o /tmp/Miningcore-src.zip -d /src/miningcore && rm -f /tmp/Miningcore-src.zip

WORKDIR /src/miningcore/src/Miningcore

# Restore (mit Cache) + Publish ohne Restore
ENV NUGET_PACKAGES=/root/.nuget/packages

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore Miningcore.csproj --disable-parallel \
 && dotnet publish Miningcore.csproj -c Release --framework net6.0 -o /app/build --no-restore

# Runtime
FROM mcr.microsoft.com/dotnet/aspnet:6.0-jammy AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libzmq5 libsodium23 libgmp10 zlib1g libc++1 \
 && ln -sf /usr/lib/x86_64-linux-gnu/libzmq.so.5 /usr/lib/x86_64-linux-gnu/libzmq.so \
 && ln -sf /usr/lib/x86_64-linux-gnu/libsodium.so.23 /usr/lib/x86_64-linux-gnu/libsodium.so \
 && ldconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/build
COPY --from=build /app/build/ /app/build/

ENTRYPOINT ["dotnet","/app/build/Miningcore.dll","-c","/app/config.json"]
