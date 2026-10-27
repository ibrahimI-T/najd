// An estimate of how many tokens a text costs a model, by script: Latin text and code are about four characters per token, Arabic
// about two and a half, Chinese/Japanese/Korean about one and a half. It is an ESTIMATE (there is no tokenizer here: the models differ
// and none is bundled); the exact figure for a finished run is the provider's own usage report in the run receipt.
function estimateTokens(text) {
  const value = String(text ?? '')
  let latin = 0, arabic = 0, cjk = 0, other = 0
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 0x250) latin++
    else if (code >= 0x600 && code <= 0x6ff || code >= 0x750 && code <= 0x77f || code >= 0xfb50 && code <= 0xfdff || code >= 0xfe70 && code <= 0xfeff) arabic++
    else if (code >= 0x3040 && code <= 0x9fff || code >= 0xac00 && code <= 0xd7af) cjk++
    else other++
  }
  return Math.ceil(latin / 4 + arabic / 2.4 + cjk / 1.5 + other / 3)
}
module.exports = { estimateTokens }
