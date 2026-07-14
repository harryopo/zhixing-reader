# 知行读书 API 测试脚本
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  知行读书 - API 功能测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查应用是否正在运行
$appRunning = Get-Process | Where-Object { $_.ProcessName -like "*electron*" }

if (-not $appRunning) {
    Write-Host "错误: 知行读书应用未运行" -ForegroundColor Red
    Write-Host "请先启动应用: npm run dev" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ 应用正在运行" -ForegroundColor Green
Write-Host ""

# 显示测试说明
Write-Host "测试说明:" -ForegroundColor Yellow
Write-Host "1. 打开知行读书应用" -ForegroundColor White
Write-Host "2. 点击左侧菜单的 '设置'" -ForegroundColor White
Write-Host "3. 在设置页面配置API参数:" -ForegroundColor White
Write-Host "   - 微信读书: 输入Cookies字符串" -ForegroundColor White
Write-Host "   - AI服务: 选择提供商，输入API Key" -ForegroundColor White
Write-Host "4. 点击 '测试连接' 按钮验证配置" -ForegroundColor White
Write-Host "5. 测试成功后点击 '保存配置'" -ForegroundColor White
Write-Host ""
Write-Host "功能测试步骤:" -ForegroundColor Yellow
Write-Host "1. 书架页面: 点击 '同步微信读书书架'" -ForegroundColor White
Write-Host "2. 选择书籍: 点击 '导入微信读书笔记'" -ForegroundColor White
Write-Host "3. AI助手: 输入问题测试对话功能" -ForegroundColor White
Write-Host ""

Read-Host "按 Enter 键继续..."
