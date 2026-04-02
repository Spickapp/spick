# Supabase Secrets som måste sättas manuellt

Gå till: Supabase Dashboard → Settings → Vault → New Secret

| Secret namn | Var du hittar den | Används av |
|---|---|---|
| ANTHROPIC_API_KEY | console.anthropic.com → API Keys | claude EF (AI-chat) |
| STRIPE_SECRET_KEY | dashboard.stripe.com → Developers → API keys | stripe-webhook, stripe-checkout, stripe-refund |
| STRIPE_WEBHOOK_SECRET | dashboard.stripe.com → Webhooks → din endpoint → Signing secret | stripe-webhook |
| RESEND_API_KEY | resend.com → API Keys | notify, auto-remind, rut-claim |
| ELKS_API_USER | 46elks.com → Account | sms, auto-remind |
| ELKS_API_PASSWORD | 46elks.com → Account | sms, auto-remind |
| SKV_API_KEY | skatteverket.se → ROT och RUT digitala tjänster | rut-claim |

## Status
- [x] ANTHROPIC_API_KEY — ✅ Satt
- [x] STRIPE_SECRET_KEY — ✅ Satt (live)
- [x] STRIPE_WEBHOOK_SECRET — ✅ Satt (live, uppdaterad 2026-03-26)
- [x] RESEND_API_KEY — ✅ Satt
- [ ] ELKS_API_USER / ELKS_API_PASSWORD — saknas (SMS inaktivt)
- [ ] SKV_API_KEY — saknas (RUT-ansökan manuell)
