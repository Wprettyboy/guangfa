$ErrorActionPreference = "Stop"

$name = "guangfa-onlyoffice"
$image = "onlyoffice/documentserver:latest"

function Test-DockerReady {
  try {
    docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (!(Test-DockerReady)) {
  $dockerDesktop = @(
    "C:\Program Files\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if (!$dockerDesktop) {
    throw "Docker Desktop was not found. OnlyOffice cannot start."
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null

  for ($i = 0; $i -lt 90; $i++) {
    if (Test-DockerReady) { break }
    Start-Sleep -Seconds 2
  }
}

if (!(Test-DockerReady)) {
  throw "Docker Desktop is not ready. OnlyOffice cannot start."
}

$root = Split-Path $PSScriptRoot -Parent
$localAiBaseUrl = "http://127.0.0.1:8129/v1"
$localAiModel = "qwen3.6-35b-a3b"
$localAiApiKey = "sk-local"
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^\s*LOCAL_LLM_BASE_URL\s*=\s*(.+?)\s*$") { $localAiBaseUrl = $Matches[1] }
    if ($line -match "^\s*LOCAL_LLM_MODEL\s*=\s*(.+?)\s*$") { $localAiModel = $Matches[1] }
    if ($line -match "^\s*LOCAL_LLM_API_KEY\s*=\s*(.+?)\s*$" -and $Matches[1]) { $localAiApiKey = $Matches[1] }
  }
}
$officeAiBaseUrl = $localAiBaseUrl -replace "^http://(?:127\.0\.0\.1|localhost)(:\d+)", 'http://host.docker.internal$1'

docker pull $image

$existing = docker ps -a --filter "name=^/$name$" --format "{{.Names}}"
if ($existing -eq $name) {
  docker start $name | Out-Null
} else {
  docker run -d --name $name -p 8080:80 -e JWT_ENABLED=false --restart unless-stopped $image | Out-Null
}

$fontDir = "/usr/share/fonts/truetype/guangfa"
$fontFiles = @(
  "simfang.ttf",
  "simhei.ttf",
  "simkai.ttf",
  "simsun.ttc",
  "simsunb.ttf",
  "msyh.ttc",
  "msyhbd.ttc",
  "STFANGSO.TTF",
  "STKAITI.TTF",
  "STSONG.TTF",
  "STXIHEI.TTF"
)
docker exec $name bash -lc "mkdir -p '$fontDir'"
foreach ($fontFile in $fontFiles) {
  $fontPath = Join-Path "C:\Windows\Fonts" $fontFile
  if (Test-Path $fontPath) {
    docker cp $fontPath "${name}:$fontDir/$fontFile" | Out-Null
  }
}
docker exec $name bash -lc "fc-cache -f '$fontDir' && /usr/bin/documentserver-generate-allfonts.sh"

$outlineProbe = Join-Path $PSScriptRoot "onlyoffice-outline-probe.js"
if (Test-Path $outlineProbe) {
  docker cp $outlineProbe "${name}:/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/guangfa-outline-probe.js" | Out-Null
}

$placeholderProbe = Join-Path $PSScriptRoot "onlyoffice-placeholder-fields.js"
if (Test-Path $placeholderProbe) {
  docker cp $placeholderProbe "${name}:/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/guangfa-placeholder-fields.js" | Out-Null
}

docker exec `
  -e LOCAL_AI_BASE_URL="$officeAiBaseUrl" `
  -e LOCAL_AI_MODEL="$localAiModel" `
  -e LOCAL_AI_API_KEY="$localAiApiKey" `
  $name bash -lc @'
python3 - <<'PY'
import json
import os
path='/etc/onlyoffice/documentserver/local.json'
with open(path, encoding='utf-8') as f:
    data=json.load(f)
co=data.setdefault('services',{}).setdefault('CoAuthoring',{})
co.setdefault('request-filtering-agent',{})['allowPrivateIPAddress']=True
co.setdefault('request-filtering-agent',{})['allowMetaIPAddress']=True
base_url=os.environ.get('LOCAL_AI_BASE_URL','http://host.docker.internal:8129/v1').rstrip('/')
provider_url=base_url[:-3] if base_url.lower().endswith('/v1') else base_url
model=os.environ.get('LOCAL_AI_MODEL','qwen3.6-35b-a3b')
api_key=os.environ.get('LOCAL_AI_API_KEY') or 'sk-local'
data['aiSettings']={
  'version':3,
  'timeout':'5m',
  'proxy':'',
  'allowedCorsOrigins':['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8080','http://localhost:8080'],
  'providers':{
    'OpenAI':{
      'name':'OpenAI',
      'url':provider_url,
      'key':api_key,
      'models':[{'id':model,'name':model,'endpoints':[1],'options':{'max_input_tokens':128000}}],
    }
  },
  'models':[{'name':f'Local Qwen [{model}]','id':model,'provider':'OpenAI','capabilities':1}],
  'actions':{
    'Chat':{'model':model},
    'Summarization':{'model':model},
    'Translation':{'model':model},
    'TextAnalyze':{'model':model},
  },
  'customProviders':{},
}
with open(path,'w',encoding='utf-8') as f:
    json.dump(data,f,ensure_ascii=False,indent=2)
PY
'@

$patchScript = Join-Path $PSScriptRoot "patch-onlyoffice.py"
docker cp $patchScript "${name}:/tmp/guangfa-patch-onlyoffice.py" | Out-Null
docker exec $name python3 /tmp/guangfa-patch-onlyoffice.py
docker restart $name | Out-Null

for ($i = 0; $i -lt 90; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/healthcheck" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      Write-Host "OnlyOffice ready: http://127.0.0.1:8080"
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 4
}

throw "OnlyOffice did not become ready on http://127.0.0.1:8080"
