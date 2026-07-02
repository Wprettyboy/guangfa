$ErrorActionPreference = "Stop"

$Runtime = "C:\llm\llama-b9827-vulkan\llama-server.exe"
$Model = "C:\llm\qwen3.6-35b-a3b-mtp\Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"
$LogDir = "C:\llm\qwen3.6-35b-a3b-mtp"

$variants = @(
  @{ Name = "fa-off"; Args = @("-ngl", "99", "-fa", "off") },
  @{ Name = "no-op-offload"; Args = @("-ngl", "99", "-fa", "off", "--no-op-offload") },
  @{ Name = "no-repack"; Args = @("-ngl", "99", "-fa", "off", "--no-repack") },
  @{ Name = "no-kv-offload"; Args = @("-ngl", "99", "-fa", "off", "--no-kv-offload") },
  @{ Name = "ngl-20"; Args = @("-ngl", "20", "-fa", "off") },
  @{ Name = "ngl-10"; Args = @("-ngl", "10", "-fa", "off") },
  @{ Name = "ngl-1"; Args = @("-ngl", "1", "-fa", "off") }
)

function Stop-Llama {
  Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

$results = @()
$basePort = 8120

foreach ($variant in $variants) {
  Stop-Llama
  $port = $basePort
  $basePort += 1
  $out = Join-Path $LogDir ("variant-{0}.out.log" -f $variant.Name)
  $err = Join-Path $LogDir ("variant-{0}.err.log" -f $variant.Name)
  Remove-Item $out, $err -ErrorAction SilentlyContinue

  $args = @(
    "-m", $Model,
    "--host", "127.0.0.1",
    "--port", "$port",
    "-c", "2048",
    "-np", "1",
    "--cache-ram", "0",
    "--jinja",
    "--reasoning", "off"
  ) + $variant.Args

  $proc = Start-Process -FilePath $Runtime -ArgumentList $args -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden

  $ready = $false
  for ($i = 0; $i -lt 75; $i++) {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch {
      if ((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -eq $null) { break }
      Start-Sleep -Seconds 2
    }
  }

  $ok = $false
  $elapsed = $null
  $content = ""
  $errorText = ""

  if ($ready) {
    $body = @{
      model = "qwen-test"
      messages = @(
        @{ role = "system"; content = "You are a concise document generation assistant." },
        @{ role = "user"; content = "Write one formal project overview sentence for a construction tender document." }
      )
      temperature = 0.2
      max_tokens = 32
      stream = $false
    } | ConvertTo-Json -Depth 6

    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
      $res = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/v1/chat/completions" -ContentType "application/json" -Body $body -TimeoutSec 120
      $sw.Stop()
      $ok = $true
      $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 2)
      $content = $res.choices[0].message.content
    } catch {
      $sw.Stop()
      $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 2)
      $errorText = $_.Exception.Message
    }
  } else {
    $errorText = "server not ready"
  }

  $timing = ""
  if (Test-Path $err) {
    $timing = (Select-String -Path $err -Pattern "prompt eval time|eval time|total time" | Select-Object -Last 3 | ForEach-Object { $_.Line }) -join "`n"
  }

  $alive = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null
  $results += [pscustomobject]@{
    Variant = $variant.Name
    Ready = $ready
    Ok = $ok
    AliveAfterRequest = $alive
    ElapsedSec = $elapsed
    Error = $errorText
    Timing = $timing
    Content = $content
  }
}

Stop-Llama
$results | ConvertTo-Json -Depth 4
