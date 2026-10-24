# 模拟 Edge 扩展连接桥接，应答桥接发来的命令（无需浏览器即可自测桥接）
param([string]$Url = "ws://127.0.0.1:8766/ws")

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$Url, $ct).Wait()
Write-Host "[fake-ext] connected"

function Send-Json([string]$text) {
    try {
        $b = [Text.Encoding]::UTF8.GetBytes($text)
        $ws.SendAsync([ArraySegment[byte]]::new($b), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
    } catch { Write-Host "[fake-ext] send failed: $_" }
}

# 1x1 紫色 PNG
$tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

Send-Json '{"id":1,"method":"hello","params":{"extVersion":"fake-1.0.0","userAgent":"fake-ext"}}'

$buf = New-Object byte[] 1048576
function Recv-Json {
    $sb = New-Object System.Text.StringBuilder
    do {
        $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct).Result
        if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { return $null }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
    } while (-not $r.EndOfMessage)
    $sb.ToString()
}

while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    $raw = Recv-Json
    if (-not $raw) { break }
    $o = $raw | ConvertFrom-Json
    if (-not $o.method) { continue }   # 响应类消息忽略

    $resp = $null
    switch ($o.method) {
        "ping"        { $resp = '{"pong":true}' }
        "listTabs"    { $resp = '[{"tabId":101,"index":0,"windowId":1,"active":true,"title":"Fake One","url":"https://example.com/","favIconUrl":""},{"tabId":102,"index":1,"windowId":1,"active":false,"title":"Fake Two","url":"https://example.org/","favIconUrl":""}]' }
        "newTab"      { $resp = ('{"tabId":201,"url":"' + $o.params.url + '","title":"New Fake"}') }
        "activateTab" { $resp = '{"ok":true}' }
        "closeTab"    { $resp = '{"ok":true}' }
        "navigate"    { $resp = ('{"tabId":' + $o.params.tabId + ',"url":"' + $o.params.url + '"}') }
        "attachToTab" { $resp = '{"targetId":"fake","attached":true}' }
        "cdpCommand"  {
            $m = $o.params.method
            if ($m -eq "Runtime.enable" -or $m -eq "Page.enable") { $resp = '{}' }
            elseif ($m -eq "Runtime.evaluate") {
                if ($o.params.expression -match "readyState") { $resp = '{"result":{"type":"string","value":"complete"}}' }
                elseif ($o.params.expression -match "location.href") { $resp = '{"result":{"type":"string","value":"https://example.com/|complete"}}' }
                else { $resp = '{"result":{"type":"string","value":"fake-value"}}' }
            }
            elseif ($m -eq "Page.captureScreenshot") { $resp = ('{"data":"' + $tinyPng + '","mimeType":"image/png"}') }
            elseif ($m -eq "Page.getLayoutMetrics") { $resp = '{"cssLayoutViewport":{"clientWidth":1280,"clientHeight":720},"cssContentSize":{"width":1280,"height":720}}' }
            else { $resp = '{"result":"fake-cdp-ok"}' }
        }
        default       { $resp = '{"result":"ignored"}' }
    }

    $payload = '{"id":' + $o.id + ',"result":' + $resp + '}'
    Send-Json $payload
    Write-Host ("[fake-ext] {0} -> ok" -f $o.method)
}

Write-Host "[fake-ext] closed"
