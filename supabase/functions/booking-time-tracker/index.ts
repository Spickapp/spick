// supabase/functions/booking-time-tracker/index.ts
// ──────────────────────────────────────────────────────────────────
// SPICK: Booking Time Tracker
//
// POST /functions/v1/booking-time-tracker
// Body: { booking_id: string, action: 'start' | 'end' }
//
// Sätter actual_start_at vid 'start', actual_end_at + beräknar
// actual_hours vid 'end'. Krävs av Skatteverket för RUT-ansökan.
//
// Säkerhet:
// - JWT-validering via auth.getUser()
// - Cleaner måste vara tilldelad bokningen (match via email)
// - 5 historiska testbokningar med overlap-problem blockeras
//   (P1-1 i TODOLIST — rensas senare)
// ──────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Historiska testbokningar med overlap-problem — blockera UPDATE
// Verifierat 18 april 2026
const BLOCKED_BOOKINGS = new Set([
  '4e95e170-e369-4a50-bc7f-f69723b4a9b1',
  '5604230a-6950-4d54-8a22-04e987950861',
  '33d6b42c-a69e-4a73-904e-ed3a9ba74ebe',
  'b8d208de-daaf-4eb0-84b9-53364d8b95eb',
  'd4f25bd0-b9ab-45dc-b321-2bc252178e68',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { booking_id, action } = await req.json();

    if (!booking_id || !['start', 'end'].includes(action)) {
      return json({ error: 'invalid_params' }, 400);
    }

    if (BLOCKED_BOOKINGS.has(booking_id)) {
      return json(
        {
          error: 'booking_locked',
          message: 'Denna bokning är historisk testdata och kan inte uppdateras',
        },
        403,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'no_auth' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Validera JWT och hämta användaren
    const { data: { user }, error: userErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !user) return json({ error: 'invalid_token' }, 401);

    // Hämta bokningen
    const { data: booking, error: bErr } = await sb
      .from('bookings')
      .select('id, cleaner_id, actual_start_at, actual_end_at, status')
      .eq('id', booking_id)
      .single();

    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);

    // Säkerhetskontroll: städaren måste vara tilldelad bokningen
    const { data: cleaner } = await sb
      .from('cleaners')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!cleaner || cleaner.id !== booking.cleaner_id) {
      return json({ error: 'not_assigned' }, 403);
    }

    // Action: start
    if (action === 'start') {
      if (booking.actual_start_at) {
        return json(
          { error: 'already_started', started_at: booking.actual_start_at },
          409,
        );
      }

      const { data, error } = await sb
        .from('bookings')
        .update({ actual_start_at: new Date().toISOString() })
        .eq('id', booking_id)
        .select('actual_start_at')
        .single();

      if (error) return json({ error: 'update_failed', details: error.message }, 500);
      return json({ ok: true, actual_start_at: data.actual_start_at });
    }

    // Action: end
    if (action === 'end') {
      if (!booking.actual_start_at) {
        return json({ error: 'not_started' }, 409);
      }
      if (booking.actual_end_at) {
        return json(
          { error: 'already_ended', ended_at: booking.actual_end_at },
          409,
        );
      }

      const endAt = new Date();
      const startAt = new Date(booking.actual_start_at);
      const hours = Math.round(
        ((endAt.getTime() - startAt.getTime()) / 3600000) * 100,
      ) / 100;

      const { data, error } = await sb
        .from('bookings')
        .update({
          actual_end_at: endAt.toISOString(),
          actual_hours: hours,
        })
        .eq('id', booking_id)
        .select('actual_end_at, actual_hours')
        .single();

      if (error) return json({ error: 'update_failed', details: error.message }, 500);
      return json({
        ok: true,
        actual_end_at: data.actual_end_at,
        actual_hours: data.actual_hours,
      });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: 'internal_error', details: (e as Error).message }, 500);
  }
});
