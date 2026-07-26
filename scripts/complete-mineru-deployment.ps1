param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogFile = "C:\llm\guangfa-mineru-deployment.log"
$Downloads = @(
  @{ Name = "guangfa-mineru-hipblaslt"; File = "hipblaslt_1.2.2.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/h/hipblaslt/hipblaslt_1.2.2.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rocblas"; File = "rocblas_5.2.0.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rocblas/rocblas_5.2.0.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rocrand"; File = "rocrand_4.2.0.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rocrand/rocrand_4.2.0.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-miopen"; File = "miopen-hip_3.5.1.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/m/miopen-hip/miopen-hip_3.5.1.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rocsolver"; File = "rocsolver_3.32.0.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rocsolver/rocsolver_3.32.0.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rccl"; File = "rccl_2.27.7.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rccl/rccl_2.27.7.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rocsparse"; File = "rocsparse_4.2.0.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rocsparse/rocsparse_4.2.0.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-rocfft"; File = "rocfft_1.0.36.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/r/rocfft/rocfft_1.0.36.70201-81~24.04_amd64.deb" },
  @{ Name = "guangfa-mineru-hipsparselt"; File = "hipsparselt_0.2.6.70201-81~24.04_amd64.deb"; Url = "https://repo.radeon.com/rocm/apt/7.2.1/pool/main/h/hipsparselt/hipsparselt_0.2.6.70201-81~24.04_amd64.deb" }
)

Start-Transcript -Path $LogFile -Append | Out-Null
try {
  & wsl.exe -d $Distro -- bash -lc "command -v aria2c >/dev/null"
  if ($LASTEXITCODE -ne 0) {
    & wsl.exe -d $Distro -- sudo apt-get update
    if ($LASTEXITCODE -ne 0) { throw "Failed to refresh WSL package metadata." }
    & wsl.exe -d $Distro -- sudo apt-get install -y aria2
    if ($LASTEXITCODE -ne 0) { throw "Failed to install aria2 in WSL." }
  }

  foreach ($download in $Downloads) {
    $destination = Join-Path "C:\llm" $download.File
    if (Test-Path $destination) { continue }
    $partial = "$destination.part"
    & wsl.exe -d $Distro -- aria2c `
      --continue=true `
      --max-connection-per-server=16 `
      --split=16 `
      --min-split-size=1M `
      --file-allocation=none `
      --retry-wait=5 `
      --max-tries=0 `
      --summary-interval=10 `
      --dir=/mnt/c/llm `
      --out="$($download.File).part" `
      $download.Url
    if ($LASTEXITCODE -ne 0) { throw "Segmented download failed for $($download.File)." }
    Move-Item -LiteralPath $partial -Destination $destination -Force
  }

  foreach ($download in $Downloads) {
    $source = Join-Path "C:\llm" $download.File
    if (!(Test-Path $source)) { throw "Downloaded ROCm package is missing: $source" }
    & wsl.exe -d $Distro -- bash -lc "sudo cp '/mnt/c/llm/$($download.File)' /var/cache/apt/archives/"
    if ($LASTEXITCODE -ne 0) { throw "Failed to stage $($download.File) in WSL apt cache." }
  }

  $RepoLink = "C:\llm\guangfa-repo"
  if (!(Test-Path $RepoLink)) {
    New-Item -ItemType Junction -Path $RepoLink -Target $Root | Out-Null
  }
  if (!(Test-Path (Join-Path $RepoLink "scripts\bootstrap-mineru-wsl.sh"))) {
    throw "The stable ASCII repository junction does not point to this project: $RepoLink"
  }

  & wsl.exe -d $Distro -- bash "/mnt/c/llm/guangfa-repo/scripts/bootstrap-mineru-wsl.sh"
  if ($LASTEXITCODE -ne 0) { throw "MinerU runtime bootstrap failed. Check /opt/guangfa-mineru/logs/bootstrap.log." }

  & (Join-Path $Root "scripts\start-mineru-docker-amd.ps1") -WithVlm
  if ($LASTEXITCODE -ne 0) { throw "MinerU Docker services failed to start." }

  $Health = Invoke-RestMethod "http://127.0.0.1:8010/health" -TimeoutSec 15
  if ($Health.status -ne "healthy") { throw "MinerU API health check returned an unexpected result." }

  $SamplePdf = $env:MINERU_SMOKE_PDF
  if (!$SamplePdf) {
    $SamplePdfs = @(Get-ChildItem -LiteralPath (Join-Path $Root "output") -Filter "*.pdf" -File |
      Where-Object Name -Like "*OnlyOffice*")
    if ($SamplePdfs.Count -ne 1) {
      throw "Set MINERU_SMOKE_PDF or keep exactly one *OnlyOffice*.pdf fixture in the output directory."
    }
    $SamplePdf = $SamplePdfs[0].FullName
  }
  if (!(Test-Path -LiteralPath $SamplePdf)) { throw "MinerU smoke-test fixture is missing: $SamplePdf" }
  $SmokePdf = "C:\llm\guangfa-mineru-smoke.pdf"
  Copy-Item -LiteralPath $SamplePdf -Destination $SmokePdf -Force
  $VlmUrl = if ($env:MINERU_VLM_URL) { $env:MINERU_VLM_URL } else { "http://mineru-vlm:30000" }
  $Task = curl.exe -fsS -X POST "http://127.0.0.1:8010/tasks" `
    -F "files=@$SmokePdf" `
    -F "backend=hybrid-http-client" `
    -F "server_url=$VlmUrl" `
    -F "effort=medium" `
    -F "parse_method=auto" `
    -F "lang_list=ch" `
    -F "return_md=true" `
    -F "return_middle_json=true" `
    -F "return_content_list=true" `
    -F "return_images=true" `
    -F "response_format_zip=true" | ConvertFrom-Json
  if (!$Task.task_id) { throw "MinerU smoke test did not return task_id." }

  for ($i = 0; $i -lt 720; $i++) {
    $Status = Invoke-RestMethod "http://127.0.0.1:8010/tasks/$($Task.task_id)" -TimeoutSec 15
    if ($Status.status -eq "completed") { break }
    if ($Status.status -eq "failed") { throw "MinerU smoke test failed: $($Status.error)" }
    Start-Sleep -Seconds 5
  }
  if ($Status.status -ne "completed") { throw "MinerU smoke test timed out." }

  $ResultZip = Join-Path $env:TEMP "guangfa-mineru-smoke-$($Task.task_id).zip"
  curl.exe -fsS "http://127.0.0.1:8010/tasks/$($Task.task_id)/result" -o $ResultZip
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = [System.IO.Compression.ZipFile]::OpenRead($ResultZip)
  try {
    if (!(($Archive.Entries | Where-Object Name -match "_content_list(_v2)?\.json$").Count -gt 0)) {
      throw "MinerU smoke test ZIP does not contain a content list."
    }
  } finally {
    $Archive.Dispose()
  }
  Write-Host "MinerU AMD deployment and PDF smoke test completed successfully."
} finally {
  Stop-Transcript | Out-Null
}
