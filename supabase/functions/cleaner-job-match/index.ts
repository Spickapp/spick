import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// ── MATCHNINGSVIKTER (totalt 100%) ───────────────────
const WEIGHTS = {
  availability: 0.25,  // Tillgänglighet: kan städaren jobba denna dag/tid?
  geography:    0.20,  // Geografi: avstånd inom radie?
  jobType:      0.15,  // Tjänstetyp: matchar städarens preferenser?
  hourlyRate:   0.15,  // Timlön: effektiv timlön efter restid
  quality:      0.10,  // Kvalitet: betyg + repeat rate
  preferences:  0.10,  // Preferenser: husdjur, hiss, material, kväll/helg
  history:      0.05,  // Historik: har städaren jobbat för denna kund förut?
};

const MIN_SCORE = 40; // Jobb under detta döljs

// ── HJÄLPFUNKTIONER ──────────────────────────────────

function dayOfWeek(dateStr: string): number {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=sön, 1=mån...
  return day === 0 ? 6 : day - 1; // 0=mån, 6=sön
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── SCORER-FUNKTIONER (0.0 – 1.0) ───────────────────

function scoreAvailability(cleaner: any, booking: any): number {
  const dow = dayOfWeek(booking.date);
  const schedule = cleaner.availability_schedule;
  
  // Kolla cleaner_availability-tabell om den finns
  if (cleaner._availability) {
    const daySlot = cleaner._availability.find((a: any) => a.day_of_week === dow && a.is_active);
    if (!daySlot) return 0;
    
    const bookStart = booking.time || "09:00";
    const bookEnd = addHours(bookStart, booking.hours || 3);
    if (bookStart < daySlot.start_time || bookEnd > daySlot.end_time) return 0.5;
    return 1.0;
  }
  
  // Fallback: JSON-schema
  if (schedule && typeof schedule === 'object') {
    const days = ['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'];
    const dayData = schedule[days[dow]];
    if (!dayData || dayData.active === false) return 0;
    return 1.0;
  }
  
  return 0.7; // Inget schema = antar tillgänglig med lägre konfidens
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMins = h * 60 + m + hours * 60;
  const newH = Math.floor(totalMins / 60);
  const newM = totalMins % 60;
  return `${String(newH).padStart(2,'0')}:${String(newM).padStart(2,'0')}`;
}

function scoreGeography(cleaner: any, booking: any): number {
  const area = cleaner.service_area || {};
  const maxRadius = area.max_radius_km || cleaner.max_travel_km || 15;
  
  // Om vi har koordinater
  if (cleaner.latitude && cleaner.longitude && booking.latitude && booking.longitude) {
    const dist = distanceKm(cleaner.latitude, cleaner.longitude, booking.latitude, booking.longitude);
    if (dist > maxRadius) return 0;
    if (dist <= 3) return 1.0;
    if (dist <= 5) return 0.9;
    if (dist <= 10) return 0.7;
    return Math.max(0.3, 1 - (dist / maxRadius));
  }
  
  // Fallback: jämför stad/zon
  const zones = area.zones || [];
  const bookCity = (booking.city || '').toLowerCase();
  const cleanerCity = (cleaner.city || '').toLowerCase();
  
  if (zones.length && bookCity) {
    if (zones.some((z: string) => bookCity.includes(z.toLowerCase()))) return 0.9;
  }
  if (cleanerCity && bookCity && cleanerCity === bookCity) return 0.8;
  if (cleanerCity && bookCity && cleanerCity.includes(bookCity)) return 0.6;
  
  return 0.4; // Okänd geografi
}

function scoreJobType(cleaner: any, booking: any): number {
  const prefs = cleaner.work_preferences || {};
  const serviceTypes = prefs.service_types || [];
  const bookService = (booking.service || 'Hemstädning').toLowerCase();
  
  const typeMap: Record<string, string> = {
    'hemstädning': 'hem', 'storstädning': 'stor', 'flyttstädning': 'flytt',
    'fönsterputs': 'fonster', 'kontorsstädning': 'kontor'
  };
  
  const typeKey = typeMap[bookService] || 'hem';
  
  if (serviceTypes.length === 0) return 0.8; // Inga preferenser = accepterar allt
  if (serviceTypes.includes(typeKey)) return 1.0;
  return 0.1; // Matchar inte
}

function scoreHourlyRate(cleaner: any, booking: any): number {
  const rate = cleaner.hourly_rate || 350;
  const bookHours = booking.hours || 3;
  const bookPrice = booking.total_price || (rate * bookHours);
  const effectiveRate = bookPrice / bookHours;
  
  // Effektiv timlön vs städarens önskade
  const ratio = effectiveRate / rate;
  if (ratio >= 1.0) return 1.0;
  if (ratio >= 0.9) return 0.8;
  if (ratio >= 0.8) return 0.6;
  if (ratio >= 0.7) return 0.3;
  return 0.1;
}

function scoreQuality(cleaner: any): number {
  const rating = parseFloat(cleaner.avg_rating || "0");
  const reviews = cleaner.review_count || 0;
  const repeatRate = cleaner.repeat_rate || 0;
  
  let score = 0.5; // default
  
  // Betyg (0-5 → 0-0.7)
  if (reviews >= 3) {
    score = Math.min(0.7, rating / 5 * 0.7);
  }
  
  // Repeat rate bonus (0-0.3)
  score += repeatRate * 0.3;
  
  return Math.min(1.0, score);
}

function scorePreferences(cleaner: any, booking: any): number {
  const prefs = cleaner.work_preferences || {};
  let score = 1.0;
  let checks = 0;
  let matches = 0;
  
  // Husdjur
  if (booking.has_pets !== undefined) {
    checks++;
    if (booking.has_pets && prefs.pets_ok) matches++;
    else if (!booking.has_pets) matches++;
    else score -= 0.3;
  }
  
  // Hiss
  if (booking.floor && booking.floor > 2 && prefs.elevator_required) {
    checks++;
    if (booking.has_elevator) matches++;
    else score -= 0.4;
  }
  
  // Kväll/helg
  const bookTime = booking.time || "09:00";
  const isEvening = parseInt(bookTime.split(':')[0]) >= 17;
  if (isEvening) {
    checks++;
    if (prefs.evening_ok) matches++; else score -= 0.3;
  }
  
  const dow = dayOfWeek(booking.date);
  const isWeekend = dow >= 5;
  if (isWeekend) {
    checks++;
    if (prefs.weekend_ok) matches++; else score -= 0.3;
  }
  
  // Min uppdragslängd
  if (prefs.min_hours && booking.hours && booking.hours < prefs.min_hours) {
    score -= 0.2;
  }
  
  return Math.max(0, Math.min(1.0, score));
}

function scoreHistory(cleaner: any, booking: any): number {
  const history = cleaner._booking_history || [];
  const customerEmail = booking.customer_email || '';
  
  if (!customerEmail || !history.length) return 0.5;
  
  const previousJobs = history.filter((h: any) => h.customer_email === customerEmail);
  if (previousJobs.length >= 3) return 1.0;
  if (previousJobs.length >= 1) return 0.8;
  return 0.5;
}

// ── HUVUDLOGIK ───────────────────────────────────────

interface MatchResult {
  cleaner_id: string;
  cleaner_name: string;
  score: number;
  breakdown: Record<string, number>;
  effective_hourly_rate: number;
  distance_km: number | null;
  tier: string;
}

function calculateMatch(cleaner: any, booking: any): MatchResult {
  const scores = {
    availability: scoreAvailability(cleaner, booking),
    geography:    scoreGeography(cleaner, booking),
    jobType:      scoreJobType(cleaner, booking),
    hourlyRate:   scoreHourlyRate(cleaner, booking),
    quality:      scoreQuality(cleaner),
    preferences:  scorePreferences(cleaner, booking),
    history:      scoreHistory(cleaner, booking),
  };
  
  // Disqualifiers: 0 i availability eller jobType = blockerare
  if (scores.availability === 0 || scores.jobType <= 0.1) {
    return {
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.full_name || 'Städare',
      score: 0,
      breakdown: scores,
      effective_hourly_rate: 0,
      distance_km: null,
      tier: cleaner.commission_tier || 'new',
    };
  }
  
  // Viktad totalpoäng
  const total = Math.round(
    Object.entries(WEIGHTS).reduce((sum, [key, weight]) => {
      return sum + (scores[key as keyof typeof scores] || 0) * weight;
    }, 0) * 100
  );
  
  // Effektiv timlön
  const bookHours = booking.hours || 3;
  const bookPrice = booking.total_price || ((cleaner.hourly_rate || 350) * bookHours);
  const effectiveRate = Math.round(bookPrice / bookHours);
  
  // Avstånd
  let dist: number | null = null;
  if (cleaner.latitude && cleaner.longitude && booking.latitude && booking.longitude) {
    dist = Math.round(distanceKm(cleaner.latitude, cleaner.longitude, booking.latitude, booking.longitude) * 10) / 10;
  }
  
  return {
    cleaner_id: cleaner.id,
    cleaner_name: cleaner.full_name || 'Städare',
    score: total,
    breakdown: scores,
    effective_hourly_rate: effectiveRate,
    distance_km: dist,
    tier: cleaner.commission_tier || 'new',
  };
}

// ── SERVE ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json();
    const { booking, limit = 10, include_below_threshold = false } = body;

    if (!booking || !booking.date) {
      return new Response(JSON.stringify({ error: "booking med date krävs" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // Hämta alla godkända städare
    const { data: cleaners, error: cErr } = await sb.from("cleaners")
      .select("*")
      .eq("is_approved", true)
      .not("status", "eq", "avstängd")
      .not("status", "eq", "pausad");

    if (cErr) throw cErr;
    if (!cleaners || !cleaners.length) {
      return new Response(JSON.stringify({ matches: [], total_cleaners: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // Hämta tillgänglighet för alla städare
    const cleanerIds = cleaners.map(c => c.id);
    const { data: availability } = await sb.from("cleaner_availability")
      .select("*")
      .in("cleaner_id", cleanerIds);

    // Hämta senaste bokningshistorik (för history-score)
    const { data: recentBookings } = await sb.from("bookings")
      .select("cleaner_id, customer_email")
      .in("cleaner_id", cleanerIds)
      .eq("payment_status", "paid")
      .order("created_at", { ascending: false })
      .limit(500);

    // Koppla ihop data
    const enriched = cleaners.map(c => ({
      ...c,
      _availability: (availability || []).filter(a => a.cleaner_id === c.id),
      _booking_history: (recentBookings || []).filter(b => b.cleaner_id === c.id),
    }));

    // Kör matchning
    let matches = enriched.map(c => calculateMatch(c, booking));

    // Filtrera bort under threshold (om inte explicit inkluderade)
    if (!include_below_threshold) {
      matches = matches.filter(m => m.score >= MIN_SCORE);
    }

    // Sortera: högst poäng först
    matches.sort((a, b) => b.score - a.score);

    // Limita
    const limited = matches.slice(0, limit);

    return new Response(JSON.stringify({
      matches: limited,
      total_cleaners: cleaners.length,
      total_matches: matches.length,
      threshold: MIN_SCORE,
      weights: WEIGHTS,
    }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("cleaner-job-match error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
