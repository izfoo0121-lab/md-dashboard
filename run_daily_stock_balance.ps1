param(
    [string]$Date = ((Get-Date).AddDays(-1).ToString("yyyy-MM-dd"))
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:STOCK_BALANCE_DATE = $Date
$env:STOCK_SET_DATE = "1"

node "$repo\export_autocount_stock_balance.cjs"
