param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$Volume = "guangfa-retrieval-runtime"
$ExpectedVersion = "retrieval-runtime-v1"

function Test-VolumeReady {
  $existing = docker volume ls --quiet --filter "name=^${Volume}$"
  if ($existing -notcontains $Volume) { return $false }
  $actual = docker run --rm -v "${Volume}:/target" ubuntu:24.04 sh -c "test ! -f /target/.guangfa-retrieval-runtime-version || cat /target/.guangfa-retrieval-runtime-version"
  return $LASTEXITCODE -eq 0 -and "$actual".Trim() -eq $ExpectedVersion
}

if (Test-VolumeReady) {
  Write-Host "Docker volume is ready: $Volume"
  exit 0
}

$existing = docker volume ls --quiet --filter "name=^${Volume}$"
if ($existing -contains $Volume) {
  docker volume rm $Volume *> $null
}
docker volume create $Volume *> $null
$command = "wsl.exe -d $Distro -- tar -C /opt/guangfa-retrieval -cf - . | docker run --rm -i -v ${Volume}:/target ubuntu:24.04 tar -C /target -xf -"
Write-Host "Importing Retrieval runtime into Docker volume..."
& cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Failed to import Docker volume: $Volume" }
if (!(Test-VolumeReady)) { throw "Retrieval Docker volume marker is invalid." }
