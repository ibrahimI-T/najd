// Windows Credential Manager access for NAJD's authorized accounts (R-063).
// Secrets live only in the user's Windows Credential Manager (generic credentials, user scope). They are written and read by a
// short PowerShell process that receives them on stdin as base64, never in the command line, an environment variable, a file or a log.
// The vault (credential-vault.cjs) owns the policy; this module only stores, reads and deletes by target name.
const { spawn } = require('node:child_process')

const error = (code, details = {}) => Object.assign(new Error(code), { code, ...details })
const TARGET = /^NAJD AGENT[A-Za-z0-9 ./:_-]{1,200}$/
const MAX_SECRET_CHARS = 1000 // the blob limit is 2560 bytes (UTF-16)

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class NajdCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL c, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, uint type, uint flags, out IntPtr c);
  [DllImport("advapi32.dll", SetLastError = true)] static extern void CredFree(IntPtr c);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string target, uint type, uint flags);
  public static void Write(string target, string user, string secret) {
    byte[] bytes = Encoding.Unicode.GetBytes(secret);
    IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.UserName = user; c.CredentialBlobSize = (uint)bytes.Length; c.CredentialBlob = blob; c.Persist = 2;
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeCoTaskMem(blob); }
  }
  public static string[] Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null; // ERROR_NOT_FOUND: there is no such credential
      throw new System.ComponentModel.Win32Exception(error); // any other failure is a failure, never "not found"
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] bytes = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
      return new string[] { c.UserName, Encoding.Unicode.GetString(bytes) };
    } finally { CredFree(p); }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, 1, 0)) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == 1168) return false; // ERROR_NOT_FOUND: already gone
    throw new System.ComponentModel.Win32Exception(error);
  }
}
"@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$utf8 = New-Object System.Text.UTF8Encoding($false)
$target = $utf8.GetString([Convert]::FromBase64String($request.target))
if ($request.op -eq 'write') {
  [NajdCred]::Write($target, $utf8.GetString([Convert]::FromBase64String($request.user)), $utf8.GetString([Convert]::FromBase64String($request.secret)))
  '{"ok":true}'
} elseif ($request.op -eq 'read') {
  $found = [NajdCred]::Read($target)
  if ($null -eq $found) { '{"ok":true,"found":false}' }
  else { '{"ok":true,"found":true,"user":"' + [Convert]::ToBase64String($utf8.GetBytes($found[0])) + '","secret":"' + [Convert]::ToBase64String($utf8.GetBytes($found[1])) + '"}' }
} elseif ($request.op -eq 'delete') {
  $deleted = [NajdCred]::Delete($target)
  '{"ok":true,"deleted":' + $(if ($deleted) { 'true' } else { 'false' }) + '}'
} else { throw 'BAD_OP' }
`

const b64 = value => Buffer.from(String(value ?? ''), 'utf8').toString('base64')
const unb64 = value => Buffer.from(String(value ?? ''), 'base64').toString('utf8')

function createWindowsCredentialStore({ powershell = 'powershell.exe', timeoutMs = 20000, spawnImpl = spawn } = {}) {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  function run(request) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32' && spawnImpl === spawn) return reject(error('CREDENTIAL_STORE_UNAVAILABLE'))
      let child
      try { child = spawnImpl(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) }
      catch { return reject(error('CREDENTIAL_STORE_UNAVAILABLE')) }
      let out = ''
      const timer = setTimeout(() => { try { child.kill() } catch {} reject(error('CREDENTIAL_STORE_TIMEOUT')) }, timeoutMs)
      child.stdout.on('data', chunk => { out += chunk; if (out.length > 20000) { try { child.kill() } catch {} } })
      // stderr is drained and discarded: it could echo script text, and it never carries anything the app needs.
      child.stderr.on('data', () => {})
      child.on('error', () => { clearTimeout(timer); reject(error('CREDENTIAL_STORE_UNAVAILABLE')) })
      child.on('close', () => {
        clearTimeout(timer)
        const line = out.trim().split(/\r?\n/).pop() || ''
        try { const parsed = JSON.parse(line); parsed.ok ? resolve(parsed) : reject(error('CREDENTIAL_STORE_FAILED')) } catch { reject(error('CREDENTIAL_STORE_FAILED')) }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(request))
    })
  }
  const checked = target => { if (typeof target !== 'string' || !TARGET.test(target)) throw error('INVALID_INPUT'); return target }
  return {
    kind: 'windows-credential-manager',
    async write(target, username, secret) {
      checked(target)
      if (typeof username !== 'string' || username.length > 320 || typeof secret !== 'string' || !secret || secret.length > MAX_SECRET_CHARS) throw error('INVALID_INPUT')
      await run({ op: 'write', target: b64(target), user: b64(username), secret: b64(secret) })
    },
    async read(target) {
      checked(target)
      const result = await run({ op: 'read', target: b64(target) })
      return result.found ? { username: unb64(result.user), secret: unb64(result.secret) } : null
    },
    async remove(target) {
      checked(target)
      return (await run({ op: 'delete', target: b64(target) })).deleted === true
    }
  }
}

module.exports = { createWindowsCredentialStore, MAX_SECRET_CHARS }
