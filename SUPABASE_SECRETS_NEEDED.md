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
- [ ] ANTHROPIC_API_KEY — saknas (AI-chat fungerar ej)
- [ ] STRIPE_SECRET_KEY — live-nycklar ej satta (Stripe i testläge)
- [ ] STRIPE_WEBHOOK_SECRET — live-nyckel ej satt
- [ ] RESEND_API_KEY — kontrollera att den är satt
- [ ] ELKS_API_USER / ELKS_API_PASSWORD — saknas (SMS inaktivt)
- [ ] SKV_API_KEY — saknas (RUT-ansökan manuell)
