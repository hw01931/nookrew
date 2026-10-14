param([string]$Message, [string]$Title = "Moyo Office")
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
if ($Message) {
  [System.Windows.Forms.MessageBox]::Show($Message, $Title) | Out-Null
  exit
}
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'ko') { 'Codex에서 사용하는 프로젝트 폴더를 선택하세요.' } else { 'Select the project folder you use in Codex.' }
$picker.ShowNewFolderButton = $false
if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $picker.SelectedPath | ConvertTo-Json -Compress
}
$picker.Dispose()
