// Sets AddSize in build/installer.nsh to the unpacked size of the staged runtime bundle (KB), the value
// tests/installer-config.test.cjs checks. Used after staging a bundle, locally or in the release workflow.
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'build/bundle/najd-runtime-packed/bundle.json'), 'utf8'))
const kb = Math.ceil(bundle.components.reduce((sum, row) => sum + row.bytes, 0) / 1024)
const file = path.join(root, 'build/installer.nsh')
const text = fs.readFileSync(file, 'utf8')
if (!/AddSize\s+\d+/.test(text)) throw new Error('AddSize line not found in build/installer.nsh')
fs.writeFileSync(file, text.replace(/AddSize\s+\d+/, 'AddSize ' + kb))
console.log('AddSize', kb)
