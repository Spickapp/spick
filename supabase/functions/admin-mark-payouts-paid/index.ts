// Fas 1.10.2: Admin-trigger av payout-flode (ersatter direkt DB-PATCH)
// Primarkalla: docs/planning/spick-arkitekturplan-v3.md Fas 1.10
//
// Flode per booking:
//   1. triggerStripeTransfer → payout_attempts + Stripe + audit
//   2. markPayoutPaid → booking.payout_status='paid' + audit
//
// Auth: JWT-role (service_role eller authenticated admin)
// Input: { cleaner_id: uuid, booking_ids?: uuid[] }
// Output: { total, success, failed, results, run_id }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  triggerStripeTransfer,
  markPayoutPaid,
  isMoneyLayerEnabled
} from '../_shared/money.ts';

const ADMIN_EMAILS = ['hello@spick.se']; // TODO: flytta till DB-rollbased (ej i v3, framtida fas)

interface BookingResult {
  booking_id: string;
  status: 'success' | 'failed' | 'skipped';
  amount_sek?: number;
  error?: string;
  error_code?: string;
  message?: string;
}

serve(async (req) => {
  const runId = crypto.randomUUID().replaceAll('-', '').substring(0, 16);

  // 1. Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization' }, 401);
  }

  let jwtRole: string;
  let jwtEmail: string | null = null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');
    const payload = JSON.parse(atob(parts[1]));
    jwtRole = payload.role;
    jwtEmail = payload.email ?? null;
  } catch (e) {
    return json({ error: 'Invalid JWT', detail: (e as Error).message }, 401);
  }

  // Service_role ar alltid OK. Authenticated kraver admin-email.
  if (jwtRole === 'authenticated') {
    if (!jwtEmail || !ADMIN_EMAILS.includes(jwtEmail)) {
      return json({
        error: 'Insufficient privileges',
        required: 'admin email',
        your_email: jwtEmail
      }, 403);
    }
  } else if (jwtRole !== 'service_role') {
    return json({
      error: 'Insufficient privileges',
      role: jwtRole
    }, 403);
  }

  // 2. Parse body
  let body: { cleaner_id?: string; booking_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.cleaner_id) {
    return json({ error: 'cleaner_id required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 3. Money-layer check
  const enabled = await isMoneyLayerEnabled(supabase);
  if (!enabled) {
    return json({
      error: 'MoneyLayerDisabled',
      message: 'money_layer_enabled=false. Aktivera via platform_settings innan anrop.',
      run_id: runId
    }, 412);
  }

  // 4. Resolve booking_ids (om tom: hamta alla kvalificerade)
  let bookingIds: string[];
  if (body.booking_ids && body.booking_ids.length > 0) {
    bookingIds = body.booking_ids;
  } else {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id')
      .eq('cleaner_id', body.cleaner_id)
      .eq('payment_status', 'paid')
      .or('payout_status.is.null,payout_status.eq.failed');

    if (error) {
      return json({
        error: 'Failed to fetch bookings',
        detail: error.message,
        run_id: runId
      }, 500);
    }

    bookingIds = (bookings ?? []).map(b => b.id);
  }

  if (bookingIds.length === 0) {
    return json({
      total_bookings: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
      run_id: runId,
      message: 'Inga kvalificerade bookings hittades'
    }, 200);
  }

  // 5. Processa varje booking
  const results: BookingResult[] = [];

  for (const bookingId of bookingIds) {
    try {
      // Step A: trigger Stripe transfer
      await triggerStripeTransfer(supabase, bookingId);

      // Step B: mark as paid
      const audit = await markPayoutPaid(supabase, bookingId, {
        admin_user_id: jwtEmail ?? 'service_role_caller'
      });

      results.push({
        booking_id: bookingId,
        status: 'success',
        amount_sek: audit.amount_sek ?? undefined,
        message: 'Transfer + mark-paid klar'
      });
    } catch (e) {
      const err = e as Error;
      const errorName = err.constructor.name;

      // Idempotency: om redan paid, marker som skipped
      if (errorName === 'PayoutPreconditionError' &&
          err.message.includes('already paid')) {
        results.push({
          booking_id: bookingId,
          status: 'skipped',
          message: 'Redan paid (idempotency)'
        });
      } else {
        results.push({
          booking_id: bookingId,
          status: 'failed',
          error: errorName,
          error_code: (err as any).code ?? null,
          message: err.message
        });
      }
    }
  }

  // 6. Sammanstall rapport
  const summary = {
    total_bookings: bookingIds.length,
    success: results.filter(r => r.status === 'success').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
    run_id: runId,
    cleaner_id: body.cleaner_id,
    admin_user: jwtEmail ?? 'service_role'
  };

  // 7. Audit-log batch-operationen
  try {
    await supabase.from('payout_audit_log').insert({
      action: 'admin_batch_markpaid',
      severity: summary.failed > 0 ? 'alert' : 'info',
      details: {
        run_id: runId,
        cleaner_id: body.cleaner_id,
        admin_user: summary.admin_user,
        total: summary.total_bookings,
        success: summary.success,
        failed: summary.failed,
        skipped: summary.skipped
      },
      created_at: new Date().toISOString()
    });
  } catch (e) {
    // swallow — EF ska returnera 200 aven om audit failar
    console.error('[admin-mark-payouts-paid] audit-log insert failed:', e);
  }

  return json(summary, 200);
});

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
