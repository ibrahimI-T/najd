// Context tiers: how much of a model's window NAJD may spend on instructions, tools, memory and tool output.
// The tier follows the model's real window (a 16k local model, a 200k subscription model, a 1M API model alike), not
// the computer. A small window gets a lean start (few tools, one-line descriptions, short instructions) that grows on
// demand; a large window keeps the full setup. docs/SPEC-context-graphs.md.
const CHARS_PER_TOKEN = 3 // the provider input budget is the window in tokens times three characters

const TIERS = [
  // maxWindow is in tokens. startTools is how many tools a lean run starts with; maxTools is the most it may grow to.
  { name: 'tiny', maxWindow: 10000, lean: true, startTools: 8, maxTools: 12 },
  { name: 'small', maxWindow: 40000, lean: true, startTools: 9, maxTools: 16 },
  { name: 'medium', maxWindow: 150000, lean: false, startTools: 22, maxTools: 24 },
  { name: 'large', maxWindow: Infinity, lean: false, startTools: 22, maxTools: 24 }
]

// inputBudgetChars: the request's input budget in characters (0, missing or invalid means "unknown": the medium tier).
// mode: 'lean' or 'full' forces the choice (a setting); anything else follows the window.
// Three styles: lean (small windows: few tools, short text), balanced (every other window: the same abilities and the same
// wording where it matters, but only the instructions, tools and memory this request needs; nothing is withheld, everything is one
// step away) and full (everything, always; the setting that turns the savings off).
function tierOf(inputBudgetChars, mode) {
  const known = Number.isFinite(inputBudgetChars) && inputBudgetChars > 0
  const windowTokens = known ? Math.floor(inputBudgetChars / CHARS_PER_TOKEN) : null
  const base = known ? TIERS.find(tier => windowTokens <= tier.maxWindow) : TIERS[2]
  const lean = mode === 'lean' ? true : mode === 'full' ? false : base.lean
  const window = windowTokens ?? 64000
  // A tool result may take about 12% of the window (2,000 tokens of a 16k window), never less than 3,000 characters.
  // Large windows are left to the room check alone.
  // The full setting turns every saving off, including this cap (the room check of the request still applies).
  const outputCapChars = mode === 'full' ? Infinity : lean || window <= 150000 ? Math.max(3000, Math.floor(window * 0.12 * CHARS_PER_TOKEN)) : Infinity
  // An unknown window (no input budget at all) keeps the full setup, as before; every real run knows its window.
  const balanced = !lean && mode !== 'full' && known
  return { ...base, lean, balanced, style: lean ? 'lean' : balanced ? 'balanced' : 'full', windowTokens: window, outputCapChars, startTools: lean ? base.startTools : 22, maxTools: lean ? Math.min(base.maxTools, 24) : 24,
    // Older tool results are condensed once the request passes this share of the budget.
    condenseAt: 0.7, memoryChars: Math.max(600, Math.min(4000, Math.floor(window * CHARS_PER_TOKEN * 0.05))) }
}

module.exports = { tierOf, TIERS, CHARS_PER_TOKEN }
