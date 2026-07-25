param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"

function Test-VolumeMarker([string]$Volume) {
  docker run --rm -v "${Volume}:/target" ubuntu:24.04 test -f /target/.guangfa-import-complete *> $null
  return $LASTEXITCODE -eq 0
}

function Import-WslDirectory([string]$Volume, [string]$Source, [string[]]$Entries) {
  if (Test-VolumeMarker $Volume) {
    Write-Host "Docker volume is ready: $Volume"
    return
  }

  docker volume rm $Volume *> $null
  docker volume create $Volume *> $null
  $entryList = $Entries -join " "
  $command = "wsl.exe -d $Distro -- tar -C $Source -cf - $entryList | docker run --rm -i -v ${Volume}:/target ubuntu:24.04 tar -C /target -xf -"
  Write-Host "Importing $Source into Docker volume $Volume..."
  & cmd.exe /d /s /c $command
  if ($LASTEXITCODE -ne 0) { throw "Failed to import Docker volume: $Volume" }

  docker run --rm -v "${Volume}:/target" ubuntu:24.04 touch /target/.guangfa-import-complete
  if ($LASTEXITCODE -ne 0) { throw "Failed to mark Docker volume ready: $Volume" }
}

Import-WslDirectory "guangfa-mineru-rocm" "/opt/rocm-7.2.1" @(".")
Import-WslDirectory "guangfa-mineru-runtime" "/opt/guangfa-mineru" @("venv", "models", "mineru.json")
Import-WslDirectory "guangfa-mineru-modelscope" "/root/.cache/modelscope" @(".")
