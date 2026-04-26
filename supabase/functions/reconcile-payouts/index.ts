// Fas 1.9: Edge Function for reconciliation cron
// Primarkalla: docs/architecture/fas-1-8-reconciliation-design.md
//              docs/runbooks/fas-1-9-activation.md
//
// Auth: service_role (Bearer token via pg_cron)
// Schedule: hourly (5 min efter varje hel timme) via pg_cron
//
// Self-governing features:
// - Dry_run-mode om money_layer_enabled='false'
// - Auto-rollback vid critical mismatches
// - Auto-activation efter 20 clean dry-runs (>20h)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { reconcilePayouts, isMoneyLayerEnabled } from '../_shared/money.ts';

const AUTO_ACTIVATION_CLEAN_RUNS_THRESHOLD = 20;  // ~20 timmar clean
const AUTO_ACTIVATION_HOURS_WINDOW = 24;

serve(async (req) => {
  // 1. Auth: verifiera JWT-role (service_role eller authenticated)
  // Byt fran strict env-match till JWT-decode for robusthet mot
  // Supabase API-generationsbyte (2026-04-20).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({
      error: 'Missing or invalid Authorization header'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Parse JWT payload (without signature verification — Supabase
  // gateway has already verified signature when verify_jwt=true)
  let jwtRole: string;
  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const payload = JSON.parse(atob(parts[1]));
    jwtRole = payload.role;
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Invalid JWT',
      detail: e.message
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Accept service_role or authenticated (admin) users
  if (jwtRole !== 'service_role' && jwtRole !== 'authenticated') {
    return new Response(JSON.stringify({
      error: 'Insufficient privileges',
      role: jwtRole,
      required: 'service_role or authenticated'
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey!
  );

  try {
    // 2. Determine mode: dry_run om !money_layer_enabled
    const isEnabled = await isMoneyLayerEnabled(supabase);

    // 3. Kor reconciliation
    const report = await reconcilePayouts(supabase, {
      since_days: 7,
      max_transfers: 100,
      max_api_calls: 50,
      dry_run: !isEnabled
    });

    // 4. Auto-rollback: critical mismatches → disable money_layer
    const criticals = report.mismatches.filter(m => m.severity === 'critical');
    if (isEnabled && criticals.length > 0) {
      await supabase
        .from('platform_settings')
        .update({
          value: 'false',
          updated_at: new Date().toISOString()
        })
        .eq('key', 'money_layer_enabled');

      await supabase.from('payout_audit_log').insert({
        action: 'auto_rollback_triggered',
        severity: 'critical',
        details: {
          run_id: report.run_id,
          critical_count: criticals.length,
          critical_types: criticals.map(c => c.type),
          reason: 'Automatic rollback: critical mismatches detected'
        },
        created_at: new Date().toISOString()
      });

      // Audit-fix P0-3 (2026-04-26): trigga admin-alert direkt så vi inte
      // upptäcker money_layer-rollback först nästa cron-tick (1h tyst).
      try {
        const { sendAdminAlert } = await import('../_shared/alerts.ts');
        await sendAdminAlert({
          severity: 'critical',
          title: 'Payout reconciliation: critical mismatch → money_layer auto-disabled',
          source: 'reconcile-payouts',
          message: `${criticals.length} kritisk(a) mismatch detected. money_layer disabled. Inspect payout_audit_log run_id=${report.run_id}`,
          metadata: {
            run_id: report.run_id,
            critical_count: criticals.length,
            critical_types: criticals.map(c => c.type),
          },
        });
      } catch (e) {
        console.error('[reconcile-payouts] sendAdminAlert failed:', (e as Error).message);
      }
    }

    // 5. Auto-activation: 20 clean dry-runs i 24h → enable
    if (!isEnabled && report.mismatches.length === 0) {
      const cutoff = new Date(
        Date.now() - AUTO_ACTIVATION_HOURS_WINDOW * 3600000
      ).toISOString();

      const { data: recentRuns } = await supabase
        .from('payout_audit_log')
        .select('id, details, created_at')
        .eq('action', 'reconciliation_completed')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false });

      const cleanRuns = (recentRuns ?? []).filter(r => {
        const mmCount = (r.details as any)?.mismatches_count;
        const mode = (r.details as any)?.mode;
        return typeof mmCount === 'number'
            && mmCount === 0
            && mode === 'dry_run';
      });

      if (cleanRuns.length >= AUTO_ACTIVATION_CLEAN_RUNS_THRESHOLD) {
        await supabase
          .from('platform_settings')
          .update({
            value: 'true',
            updated_at: new Date().toISOString()
          })
          .eq('key', 'money_layer_enabled');

        await supabase.from('payout_audit_log').insert({
          action: 'auto_activation_triggered',
          severity: 'info',
          details: {
            dry_run_count: cleanRuns.length,
            hours_window: AUTO_ACTIVATION_HOURS_WINDOW,
            threshold: AUTO_ACTIVATION_CLEAN_RUNS_THRESHOLD,
            first_clean_run: cleanRuns[cleanRuns.length - 1]?.created_at,
            activated_from_run_id: report.run_id
          },
          created_at: new Date().toISOString()
        });
      }
    }

    // 6. Return report
    return new Response(JSON.stringify({
      ...report,
      mode: isEnabled ? 'live' : 'dry_run',
      auto_rollback_triggered: isEnabled && criticals.length > 0
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Reconciliation error:', err);

    // Log kritiskt fel till audit
    try {
      await supabase.from('payout_audit_log').insert({
        action: 'reconciliation_error',
        severity: 'critical',
        details: {
          error: String(err),
          stack: (err as Error).stack ?? null
        },
        created_at: new Date().toISOString()
      });
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }

    return new Response(JSON.stringify({
      error: String(err),
      type: 'reconciliation_failure'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
