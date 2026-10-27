export function buildModelHistory(messages: NajdMessage[]): Pick<NajdMessage, 'role' | 'text'>[] {
  const selected: Pick<NajdMessage, 'role' | 'text'>[] = []
  let size = 0
  for (let index = messages.length - 1; index >= 0 && selected.length < 500; index--) {
    const { role, text } = messages[index]
    if (size + text.length > 4000000) break
    selected.unshift({ role, text })
    size += text.length
  }
  return selected
}

export function selectChatAssetIds(messages: NajdMessage[], selected: Pick<NajdAsset, 'id'>[]): string[] {
  const current = selected.map(item => item.id)
  const recent = [...messages].reverse().flatMap(message => [...(message.attachments || [])].reverse().map(item => item.id))
  return [...new Set([...current, ...recent])].slice(0, 8)
}
