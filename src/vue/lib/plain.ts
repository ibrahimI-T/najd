// Vue state is held in reactive proxies, which Electron's IPC cannot clone ("An object could not be cloned"): a value that came from
// component state is copied to plain data before it is sent to the main process (UI flows 2026-11-09: editing a dashboard and saving
// chat settings failed silently because of this).
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
