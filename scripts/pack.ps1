# ==============================================================================
# Google AI Studio 汉化助手 - 扩展自动化打包脚本 (pack.ps1)
# ==============================================================================
# 功能：
# 1. 自动定位项目根目录并解析 manifest.json 获取版本号
# 2. 排除开发与勘察目录 (dist/, recon/, docs/, .git/, node_modules/, scripts/ 等)
# 3. 将生产所需扩展文件打包为 dist/google-ai-studio-zh-<version>.zip
# 4. 打印最终 Zip 绝对路径、文件大小 (KB/MB) 及包含的文件清单摘要
# ==============================================================================

[CmdletBinding()]
param(
    [string]$CustomVersion = ""
)

# 确保控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$distDir = Join-Path $projectRoot "dist"
$manifestPath = Join-Path $projectRoot "manifest.json"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Google AI Studio 汉化助手 - 扩展自动化打包工具" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "项目根目录: $projectRoot"

# 1. 获取扩展版本号
$version = "1.0.0"
if ($CustomVersion -ne "") {
    $version = $CustomVersion
    Write-Host "[版本] 使用指定版本: $version" -ForegroundColor Yellow
} elseif (Test-Path $manifestPath) {
    try {
        $manifestContent = Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifestContent.version) {
            $version = $manifestContent.version
            Write-Host "[版本] 从 manifest.json 读取版本号: $version" -ForegroundColor Green
        } else {
            Write-Host "[警告] manifest.json 中未找到 version 字段，使用默认版本 $version" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[警告] 解析 manifest.json 失败 ($_)，使用默认版本 $version" -ForegroundColor Yellow
    }
} else {
    Write-Host "[提示] 未检测到 manifest.json，采用预设基线版本: $version" -ForegroundColor Yellow
}

# 2. 准备输出目录与文件路径
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    Write-Host "[目录] 创建输出目录: $distDir"
}

$zipFileName = "google-ai-studio-zh-$version.zip"
$zipFilePath = Join-Path $distDir $zipFileName

# 如果已存在同名旧包，先安全移除
if (Test-Path $zipFilePath) {
    Remove-Item -Path $zipFilePath -Force
    Write-Host "[清理] 已移除旧版本包: $zipFileName"
}

# 3. 收集需打包的文件与目录
# 排除项规则：dist, recon, docs, .git, node_modules, scripts, fixtures, CONTRACT.md, .gitignore, *.log, *.psd, *.tmp, .DS_Store, Thumbs.db
$excludePatterns = @(
    "dist",
    "recon",
    "docs",
    ".git",
    "node_modules",
    "scripts",
    "fixtures",
    "CONTRACT.md",
    ".gitignore",
    "*.log",
    "*.psd",
    "*.tmp",
    ".DS_Store",
    "Thumbs.db",
    "*.zip"
)

# 使用临时打包暂存区 staging 目录，确保 zip 根目录结构干净且符合 Chrome Web Store 规范
$stagingDir = Join-Path $distDir "staging_$([System.Guid]::NewGuid().ToString('N'))"
if (Test-Path $stagingDir) {
    Remove-Item -Path $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

try {
    Write-Host "[打包] 正在收集扩展生产文件..."
    
    # 扫描根目录下所有文件及目录
    $rootItems = Get-ChildItem -Path $projectRoot -Force | Where-Object {
        $itemName = $_.Name
        $skip = $false
        foreach ($pattern in $excludePatterns) {
            if ($itemName -like $pattern) {
                $skip = $true
                break
            }
        }
        -not $skip
    }

    foreach ($item in $rootItems) {
        $destPath = Join-Path $stagingDir $item.Name
        if ($item.PSIsContainer) {
            Copy-Item -Path $item.FullName -Destination $destPath -Recurse -Force
        } else {
            Copy-Item -Path $item.FullName -Destination $destPath -Force
        }
    }

    # 4. 执行 Zip 压缩打包
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagingDir,
        $zipFilePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    # 5. 校验与输出结果
    if (Test-Path $zipFilePath) {
        $zipItem = Get-Item $zipFilePath
        $fileBytes = $zipItem.Length
        $fileKB = [math]::Round($fileBytes / 1024, 2)
        $fileMB = [math]::Round($fileBytes / (1024 * 1024), 2)

        Write-Host "============================================================" -ForegroundColor Green
        Write-Host " 扩展打包成功！" -ForegroundColor Green
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "Zip 文件名: $zipFileName"
        Write-Host "绝对路径  : $($zipItem.FullName)"
        Write-Host "文件大小  : $fileBytes 字节 ($fileKB KB / $fileMB MB)"
        
        # 打印包内文件清单
        $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($zipFilePath)
        Write-Host "`n[包内条目摘要 (共 $($zipArchive.Entries.Count) 项)]:"
        foreach ($entry in $zipArchive.Entries) {
            Write-Host "  - $($entry.FullName) ($($entry.Length) 字节)"
        }
        $zipArchive.Dispose()
    } else {
        Write-Error "打包失败: 目标 zip 文件未能生成！"
        exit 1
    }
}
finally {
    # 清理 staging 目录
    if (Test-Path $stagingDir) {
        Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
