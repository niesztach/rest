# # test-create-user.ps1
# $res = Invoke-WebRequest `
#   -Method Post `
#   -Uri "http://localhost:1234/users" `
#   -ContentType "application/json" `
#   -Body '{"name":"Test juser"}'

# Write-Host "Status:" $res.StatusCode
# Write-Host "Body:"   $res.Content

$res = Invoke-WebRequest `
  -Uri "http://localhost:1234/users/93dbe0faaafa9aa4" `
  -UseBasicParsing
$res.StatusCode      # 200
$res.Headers["ETag"] # e.g. "abc123..."
$res.Content         # pełny JSON usera