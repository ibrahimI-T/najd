// Publisher-only tool. Never shipped or imported by the application.
const fs = require('node:fs/promises'), path = require('node:path')
const { generateKeyPairSync, createPrivateKey, createPublicKey } = require('node:crypto')
const { execFileSync } = require('node:child_process')
function protect(bytes, operation) {
  if (process.platform !== 'win32' || !['Protect','Unprotect'].includes(operation)) throw Error('Windows publisher key required')
  const code = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());$entropy=[Text.Encoding]::UTF8.GetBytes('NAJD UPDATE SIGNING V1');[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
  return Buffer.from(execFileSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',code],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:10000,maxBuffer:8192}).trim(),'base64')
}
async function publisherKey(initialize = false) {
  if (!path.isAbsolute(process.env.LOCALAPPDATA || '')) throw Error('Publisher profile unavailable')
  const directory = path.join(process.env.LOCALAPPDATA,'NAJD Agent Publisher')
  let filename = path.join(directory,'update-signing-v1.dpapi')
  let encrypted
  // A packaged (MSIX) tool such as the Codex app writes LocalAppData into its own virtualized
  // LocalCache. The same Windows user can still unprotect it, so use exactly one such record.
  try { await fs.lstat(filename) } catch (error) {
    if (error.code === 'ENOENT' && !initialize) {
      const packages = path.join(process.env.LOCALAPPDATA, 'Packages'), found = []
      for (const name of await fs.readdir(packages).catch(() => [])) {
        const candidate = path.join(packages, name, 'LocalCache/Local/NAJD Agent Publisher/update-signing-v1.dpapi')
        if (await fs.lstat(candidate).then(stat => stat.isFile() && !stat.isSymbolicLink(), () => false)) found.push(candidate)
      }
      if (found.length > 1) throw Error('Multiple publisher key records; refusing to guess')
      if (found.length === 1) filename = found[0]
    }
  }
  try { const stat = await fs.lstat(filename);if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error('Invalid key record');encrypted = await fs.readFile(filename) }
  catch (error) {
    if (error.code !== 'ENOENT' || !initialize) throw Error('Publisher key unavailable; preserve existing key')
    const pair = generateKeyPairSync('ed25519')
    const bytes = pair.privateKey.export({format:'der',type:'pkcs8'})
    encrypted = protect(bytes,'Protect');bytes.fill(0)
    await fs.mkdir(directory,{recursive:true});await fs.writeFile(filename,encrypted,{flag:'wx'})
  }
  const bytes = protect(encrypted,'Unprotect')
  try { return createPrivateKey({key:bytes,format:'der',type:'pkcs8'}) } finally { bytes.fill(0) }
}
async function initialize() {
  const key = await publisherKey(true), publicKey = createPublicKey(key).export({format:'pem',type:'spki'})
  const filename = path.resolve(__dirname,'../electron/update-config.json')
  try { const existing=JSON.parse(await fs.readFile(filename,'utf8'));if(existing.publicKey!==publicKey)throw Error('Existing trust root mismatch; refusing replacement') }
  catch(error) {
    if(error.code!=='ENOENT')throw error
    await fs.writeFile(filename,JSON.stringify({channel:'development',owner:'ibrahimI-T',repo:'najd-agent-releases',publicKey},null,2)+'\n',{flag:'wx'})
  }
  console.log('Publisher trust root initialized; private key is Windows-user protected outside Git.')
}
// Rotation (after the 2026-10-17 host incident), run on a clean device: the key record of this Windows user (created
// here when missing) becomes the trust root; only publicKey changes in update-config.json. Installations pinned to the
// old key do not accept updates signed by the new one, so each is reinstalled once from the new installer.
async function rotate() {
  const key = await publisherKey(true), publicKey = createPublicKey(key).export({format:'pem',type:'spki'})
  const filename = path.resolve(__dirname,'../electron/update-config.json')
  const existing = JSON.parse(await fs.readFile(filename,'utf8'))
  if (existing.publicKey === publicKey) { console.log('This device already holds the current trust root; nothing changed.'); return }
  await fs.writeFile(filename, JSON.stringify({...existing, publicKey}, null, 2) + '\n')
  const fingerprint = require('node:crypto').createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
  console.log('Trust root rotated (public key ' + fingerprint + '). Commit electron/update-config.json; the private key stays Windows-user protected outside Git.')
}
module.exports={publisherKey}
if(require.main===module)(process.argv.includes('--rotate')?rotate():initialize()).catch(()=>{console.error('Publisher key initialization failed; existing state preserved.');process.exitCode=1})
