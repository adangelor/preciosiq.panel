# deploy.ps1 -- PreciosIQ (preciosiq.panel) a preciosiq.com
# Uso:  pwsh .\deploy.ps1        (o)   powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#
# Compila el panel y lo sube por FTP a Hostinger. Toda la logica vive en
# ..\tools\Deploy-Panel.ps1 (compartida con el otro panel, a proposito).
#
# LA CLAVE: ponela en un archivo .ftp-password en ESTA carpeta (ya esta en .gitignore),
# o dejala vacia y el script te la pide por consola. No la escribas aca adentro.
#
# Opciones utiles:
#   .\deploy.ps1 -SkipBuild     sube el dist que ya esta (frena si hay fuentes mas nuevas)
#   .\deploy.ps1 -UseSsl        FTP sobre TLS, si Hostinger lo tiene habilitado en la cuenta
param([switch]$SkipBuild, [switch]$UseSsl, [switch]$Force, [string]$Password,
      # RemoteDir vacio A PROPOSITO (verificado el 27-ago-2026 contra el server): la cuenta
      # FTP de este dominio deja el login DIRECTAMENTE ADENTRO del web root -- el listado de
      # la raiz devuelve los chunk-*.js y la carpeta home del sitio publicado. Poner
      # 'public_html' apunta a public_html/public_html, que no existe, y el server contesta
      # 550 en el primer archivo. Si algun dia Hostinger cambia el layout de la cuenta, el
      # preflight lo detecta y te dice que correr.
      # (Tampoco hay FTPS en esta cuenta: con -UseSsl no llega ni a listar. FTP plano.)
      [string]$RemoteDir = '')

& (Join-Path $PSScriptRoot '..\tools\Deploy-Panel.ps1') `
    -PanelDir    $PSScriptRoot `
    -ProjectName 'preciosiq.panel' `
    -FtpHost     '147.79.84.183' `
    -FtpUser     'u351670056.preciosiq.com' `
    -FtpPort     21 `
    -RemoteDir   $RemoteDir `
    -SkipBuild:$SkipBuild -UseSsl:$UseSsl -Force:$Force -Password $Password
