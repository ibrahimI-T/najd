# Model and subscription connection plan

Status: version 0.2.0 implements 13 independent routes: three subscription connections, nine APIs, and Ollama. Unit and desktop/archive fixtures pass. No real subscription/API credential was used in this increment; account eligibility/inference remains separate acceptance. NAJD does not run other assistants as hidden backends.

## Product rules

The interface distinguishes three routes: models handled on the user's machine, subscription use through an official authorization route when the provider allows it, and separately billed API keys. NAJD does not request website passwords, copy browser sessions or other apps' tokens, or send a chat to a provider the user did not select. Saved credentials stay in the main process and OS-protected storage, never in renderer persistence, Git, or diagnostic logs. A key typed into the settings input is sent once to main and cleared after saving. A connection is not labeled "connected" until a real request succeeds.

| Option | Intended connection | Current state |
|---|---|---|
| Ollama | Connect to the service on `127.0.0.1` and choose an available model | Implemented; Ollama must be running. A `:cloud` model may still route inference to Ollama Cloud. |
| ChatGPT plan | Official **Sign in with ChatGPT** OAuth flow, with consent for eligible plan use | Implemented: native local-app registration under NAJD's identity, verified PKCE/ID token/scope, encrypted accounts, refresh, revocation/sign-out, account-visible models, bounded Responses streams, usage disclosure, and Test model. Unit and isolated UI tests pass. A successful registration and user-authorized real request remain required; private Git visibility alone is not an established blocker. No Codex/Hermes credentials or client identities are borrowed. |
| OpenAI API | Separate developer key; Responses API | Implemented, dynamic model catalog and model-specific effort. API billing is separate. |
| Kimi Code | Membership key and coding endpoint, limited to the provider's supported coding-plan use | Implemented: protected key storage, bounded requests, coding-model selection, Console link, and Test model. Errors use stable codes. Not yet verified by a real request with the user's deliberately entered membership key; separate from Kimi Open Platform. |
| Kimi Open Platform | Developer API key with platform-based billing | Not implemented; consumer membership credits do not automatically become general API credits. |
| MiniMax M Plan | Plan key sk-cp-; documented OpenAI-compatible endpoint | Implemented, current plan model MiniMax-M3.1-Flash-Preview, low/medium/high/xhigh/max effort. Needs a real eligible plan request. |
| Claude API | Anthropic key; Models and Messages REST | Implemented; not Claude Free/Pro/Max login. Model default thinking. |
| Gemini API | Google API key header; Models and generateContent REST | Implemented; not consumer Google AI Pro/Ultra login. Model default thinking. |
| OpenRouter API | Separate OpenRouter API key; OpenAI-compatible chat | Implemented, text-output model catalog, upstream fallbacks disabled. Browser PKCE is researched but not implemented. |
| DeepSeek, Mistral, Groq | Independent developer keys; documented compatible chat endpoints | Implemented, dynamic text-model discovery; model default thinking. |
| xAI API | Independent developer key; Responses endpoint | Implemented; not consumer Grok subscription login. Model default thinking. |
| Z.AI API | Independent developer key; standard chat endpoint | Implemented, bounded configured GLM model list; not GLM Coding Plan. Model availability needs account acceptance. |

## Implementation and verification order

From the 2026-10-14 account and plan review: ChatGPT offers an independent browser plan-login path; Kimi and MiniMax use plan keys. Claude/Gemini consumer OAuth must not be repurposed. Z.AI's tool eligibility is not established for NAJD. OpenRouter browser linking belongs under API, and Copilot SDK would introduce an external agent engine requiring a separate user choice. New research is not implementation evidence.

1. Verify an actual Ollama model reply on the user's computer and confirm it reopens in the same saved chat.
2. ~~Introduce a small provider contract: explicit provider and model selection per chat, destination disclosure before text is sent, and tests preventing provider or credential mix-ups.~~ Done: the core validates an explicit `provider` per task, the composer chip shows the active provider and model before sending, and credentials never leave the main process.
3. **Sign in with ChatGPT** implementation and isolated verification are done. On 2026-10-14 the user reported their subscription connected and gave a real reply in NAJD. This is user-reported acceptance of a basic reply, not agent inspection of their account; precise model, effort, restart and failure-path checks remain in T26.
4. ~~Implement the Kimi Code membership route only within its documented coding-plan scope.~~ Done except the real-request check with the user's key. Keep Kimi Open Platform as a separate, pay-as-you-go API route.
5. The nine API routes and MiniMax connector now have isolated protocol/storage/UI tests. Complete real requests only after the user supplies keys/consent inside NAJD. "Every subscription" cannot be promised unless each provider supports third-party use. Kimi Open Platform, Qwen/Alibaba plans, OpenRouter browser linking, and optional Copilot SDK remain outside this increment.

Connected proof is bound to the protected account/key and last verified model. Saved keys, successful model discovery, and OAuth consent alone do not make the badge green. Replacing keys, reauthorization, signing out, or authentication rejection invalidates proof; cancellation cannot verify a replacement key. Restart persistence is tested using normal Electron shutdown. T40's isolated Windows kill fixture verifies fail-closed behavior if first-run termination precedes the OS key flush: encrypted records remain on disk but the lost key cannot decrypt them. Key re-entry works; a fresh ChatGPT sign-in moves its unreadable record aside. A forced stop after the key flush retains credentials. This is not real-account or clean-Windows acceptance.

Catalog discovery is bounded: at most 2,000 records, 8 MiB for compatible catalogs, and the current first page of provider-specific catalogs (Gemini requests up to 1,000). This does not promise every model ever published; account catalogs can contain models unavailable to a particular entitlement. Z.AI/MiniMax/Kimi use explicit reviewed mappings. Unknown effort capabilities use model defaults, not guessed request parameters. Long or partial completions fail instead of producing connection proof.

Primary sources: [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart), [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [OpenAI API authentication](https://developers.openai.com/api/reference/overview), [Kimi Code third-party agent guide](https://www.kimi.com/code/docs/en/third-party-tools/hermes.html), [Kimi API FAQ](https://www.kimi.com/en/help/kimi-api/api-troubleshooting), and [Kimi Code FAQ](https://www.kimi.com/en/help/kimi-code/faq). Recheck these sources when implementing each connector because availability and contracts can change.

Phase 08 now supports an explicit exact-file proposal test through ChatGPT/OpenAI API Responses and tool-capable local Ollama. `/ask-read` asks for one validated structured proposal, then NAJD requests separate file-read approval. Contents are a local temporary preview, not a model result upload; other routes remain text-only. Normal requests retain their existing payloads. Protocol fixtures pass; real provider/model/entitlement acceptance remains open. See SPEC-model-file-proposal.md.
