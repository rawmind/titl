& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $base = if ($env:TITL_RELEASE_URL) { $env:TITL_RELEASE_URL } else { 'https://github.com/rawmind/titl/releases/latest/download' }
    $name = 'titl-windows-x64.exe'
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('titl-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        $exe = Join-Path $dir $name
        $sums = Join-Path $dir 'SHA256SUMS'
        Write-Host "Downloading $name..."
        Invoke-WebRequest -Uri "$base/$name" -OutFile $exe -UseBasicParsing
        Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing

        $line = Get-Content $sums | Where-Object { ($_ -split '\s+\*?')[1] -eq $name } | Select-Object -First 1
        if (-not $line) { throw "$name is not listed in SHA256SUMS" }
        $expected = ($line -split '\s+')[0]
        $actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw "checksum mismatch for ${name}: expected $expected, got $actual" }

        & $exe install @args
        if ($LASTEXITCODE -ne 0) { throw "titl install failed (exit code $LASTEXITCODE)" }
    } finally {
        Remove-Item -Recurse -Force -Path $dir -ErrorAction SilentlyContinue
    }
} @args
