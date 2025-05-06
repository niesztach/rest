# test-create-user.ps1
$res = Invoke-WebRequest `
  -Method Post `
  -Uri "http://localhost:1234/users" `
  -ContentType "application/json" `
  -Body '{"name":"Jan Kowalski"}'

Write-Host "Status:" $res.StatusCode
Write-Host "Body:"   $res.Content
