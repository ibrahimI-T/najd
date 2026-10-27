import { expect, it } from 'vitest'
import { installingPhase } from './PackSettings'

it('M3-I020: an install waiting on main shows its phase, so Cancel is available from the start', () => {
  expect(installingPhase(null, 'install')).toBe('downloading')
  expect(installingPhase({ state: 'not-installed' } as NajdPackStatus, 'install')).toBe('downloading')
  expect(installingPhase({ state: 'ready', installing: 'verifying' } as NajdPackStatus, 'install')).toBe('verifying')
  expect(installingPhase({ state: 'ready' } as NajdPackStatus, 'check')).toBeUndefined()
  expect(installingPhase(null, null)).toBeUndefined()
})
