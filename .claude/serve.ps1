$root = (Resolve-Path "$PSScriptRoot\..").Path
$port = 8421
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$port/"

$mime = @{
  ".html" = "text/html"; ".htm" = "text/html"; ".css" = "text/css"; ".js" = "application/javascript";
  ".json" = "application/json"; ".svg" = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg";
  ".jpeg" = "image/jpeg"; ".gif" = "image/gif"; ".ico" = "image/x-icon"; ".txt" = "text/plain"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  try {
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }
    $fsPath = Join-Path $root ($path.TrimStart("/"))
    if (Test-Path $fsPath -PathType Container) {
      $fsPath = Join-Path $fsPath "index.html"
    }
    if (Test-Path $fsPath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($fsPath).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($fsPath)
      $res.ContentType = $ct
      $res.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
