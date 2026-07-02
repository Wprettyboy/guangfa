$ErrorActionPreference = "Stop"

$BaseUrl = "https://htsfwb.samr.gov.cn"
$OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) "data\samr-contracts"
$JsonPath = Join-Path $OutDir "samr-contract-template-manifest.json"
$CsvPath = Join-Path $OutDir "samr-contract-template-manifest.csv"
$MdPath = Join-Path $OutDir "samr-contract-template-manifest.md"

$typeMap = @{
  1 = "Consumer"
  2 = "Agriculture"
  3 = "Business"
  4 = "Construction"
  5 = "Other"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-TemplatePage {
  param(
    [bool]$Local,
    [int]$Page
  )
  $uri = "$BaseUrl/api/content/SearchTemplates?loc=$($Local.ToString().ToLower())&p=$Page"
  Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 30
}

function Get-AllTemplates {
  param([bool]$Local)
  $first = Get-TemplatePage -Local $Local -Page 1
  $items = @($first.Data)
  for ($page = 2; $page -le [int]$first.TotalPage; $page++) {
    Start-Sleep -Milliseconds 150
    $items += @(Get-TemplatePage -Local $Local -Page $page).Data
  }
  $items | ForEach-Object {
    [pscustomobject]@{
      id = $_.Id
      title = $_.Title
      sourceScope = if ($Local) { "Local" } else { "National" }
      year = $_.PublishedOn
      region = $_.Region
      department = $_.Department
      typeCode = $_.Type
      typeName = $typeMap[[int]$_.Type]
      tags = $_.Tags
      brief = ($_.Brief -replace "\s+", " ").Trim()
      detailUrl = "$BaseUrl/View?id=$($_.Id)"
      modifiedOn = $_.ModifiedOn
    }
  }
}

$all = @(Get-AllTemplates -Local $false) + @(Get-AllTemplates -Local $true)
$all = $all | Sort-Object sourceScope, typeCode, year, title

$all | ConvertTo-Json -Depth 5 | Set-Content -Path $JsonPath -Encoding UTF8
$all | Export-Csv -Path $CsvPath -NoTypeInformation -Encoding UTF8

$summary = $all | Group-Object sourceScope, typeName | Sort-Object Name
$lines = @(
  "# SAMR contract template download manifest",
  "",
  "- Source: $BaseUrl",
  "- Generated at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "- Total: $($all.Count)",
  "",
  "## Summary",
  "",
  "| Scope | Type | Count |",
  "|---|---:|---:|"
)
foreach ($group in $summary) {
  $parts = $group.Name -split ", "
  $lines += "| $($parts[0]) | $($parts[1]) | $($group.Count) |"
}
$lines += @("", "## Items", "", "| Scope | Type | Year | Region/Department | Title | Link |", "|---|---|---:|---|---|---|")
foreach ($item in $all) {
  $owner = if ($item.region) { $item.region } elseif ($item.department) { $item.department } else { "-" }
  $title = $item.title.Replace("|", "/")
  $lines += "| $($item.sourceScope) | $($item.typeName) | $($item.year) | $owner | $title | [view]($($item.detailUrl)) |"
}
$lines | Set-Content -Path $MdPath -Encoding UTF8

Write-Host "Manifest generated:"
Write-Host "  $JsonPath"
Write-Host "  $CsvPath"
Write-Host "  $MdPath"
Write-Host "Total: $($all.Count)"
