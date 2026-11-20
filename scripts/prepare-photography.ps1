param(
  [ValidateRange(400,2400)][int]$MaximumEdge = 1600,
  [ValidateRange(50,95)][int]$Quality = 84
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectDirectory = Split-Path -Parent $PSScriptRoot
$originalsDirectory = Join-Path $projectDirectory 'assets/photography/originals'
$outputDirectory = Join-Path $projectDirectory 'public/assets/photos'
$photoManifest = Get-Content -LiteralPath (Join-Path $projectDirectory 'config/photography.public.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality,[long]$Quality)
$originalFiles = @(Get-ChildItem -LiteralPath $originalsDirectory -File)
$sourceBytes = 0L
$webBytes = 0L
try {
  foreach ($photo in $photoManifest) {
    if ($photo.url -notmatch '^/assets/photos/img-(\d{4})\.jpg$') { throw 'Ruta de fotografía no admitida.' }
    $code = $Matches[1]
    $matchingFiles = @($originalFiles | Where-Object { $_.Name -match ('^IMG_' + $code + '\.') -and $_.Extension.ToLowerInvariant() -in @('.jpeg','.jpg','.png') })
    if ($matchingFiles.Count -ne 1) { throw ('Se necesita un original único para IMG_{0}.' -f $code) }
    $originalFile = $matchingFiles[0]
    $outputFile = Join-Path $outputDirectory ('img-' + $code + '.jpg')
    $sourceImage = [System.Drawing.Image]::FromFile($originalFile.FullName,$true)
    try {
      if ($sourceImage.PropertyIdList -contains 274) {
        $orientation = [BitConverter]::ToUInt16($sourceImage.GetPropertyItem(274).Value,0)
        $rotation = switch ($orientation) {
          2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
          3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
          4 { [System.Drawing.RotateFlipType]::Rotate180FlipX }
          5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
          6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
          7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
          8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
          default { [System.Drawing.RotateFlipType]::RotateNoneFlipNone }
        }
        $sourceImage.RotateFlip($rotation)
      }
      $ratio = [Math]::Min(1.0,$MaximumEdge / [double][Math]::Max($sourceImage.Width,$sourceImage.Height))
      $webImage = [System.Drawing.Bitmap]::new([int][Math]::Round($sourceImage.Width*$ratio),[int][Math]::Round($sourceImage.Height*$ratio))
      $graphics = [System.Drawing.Graphics]::FromImage($webImage)
      try {
        $graphics.Clear([System.Drawing.Color]::Black)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage,0,0,$webImage.Width,$webImage.Height)
        # A fresh bitmap omits EXIF/location metadata from the web copy.
        $webImage.Save($outputFile + '.tmp',$codec,$encoderParameters)
        Move-Item -LiteralPath ($outputFile + '.tmp') -Destination $outputFile -Force
      } finally { $graphics.Dispose(); $webImage.Dispose() }
      $sourceBytes += $originalFile.Length
      $webBytes += (Get-Item -LiteralPath $outputFile).Length
    } finally { $sourceImage.Dispose() }
  }
} finally { $encoderParameters.Dispose() }
Write-Output ('Preparadas {0} fotos: {1:N1} MB de originales -> {2:N1} MB web. Originales intactos.' -f $photoManifest.Count,($sourceBytes/1MB),($webBytes/1MB))
