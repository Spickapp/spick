#!/usr/bin/env python3
"""
Spick UI Monitor – kör Playwright och laddar varje kritisk sida i en riktig 
webbläsare. Fångar vita sidor, JS-fel och saknade element INNAN Farhad ser dem.
Skickar varningsmail om något är fel.
"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

SITE     = "https://spick.se"
SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co"
ANON_KEY = os.environ.get("SUPA_ANON", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0")
RESEND   = os.environ.get("RESEND_API_KEY", "")
ADMIN    = "hello@spick.se"

results = []

def log_ok(test, detail=""):
    results.append(("✅", test, detail))
    print(f"  ✅ {test}" + (f" – {detail}" if detail else ""))

def log_fail(test, detail=""):
    results.append(("❌", test, detail))
    print(f"  ❌ {test}" + (f" – {detail}" if detail else ""), file=sys.stderr)

def send_alert(failures):
    if not RESEND:
        print("  [ALERT SKIP – ingen RESEND_KEY]")
        return
    rows = "".join(f"<li><strong>{t}</strong>: {d}</li>" for _, t, d in failures)
    html = f"""
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#DC2626;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">🚨 Spick UI Monitor – FEL HITTADE</h2>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <p><strong>{len(failures)} test misslyckades</strong> på spick.se:</p>
        <ul style="color:#DC2626;line-height:2">{rows}</ul>
        <p style="color:#6b7280;font-size:13px">Kör automatiskt vid varje deploy.<br>
        Loggar: github.com/Spickapp/spick/actions</p>
      </div>
    </div>
    """
    body = json.dumps({
        "from": "Spick Monitor <hello@spick.se>",
        "to": ADMIN,
        "subject": f"🚨 UI-fel hittade på spick.se ({len(failures)} st)",
        "html": html
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails", body,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {RESEND}",
        },
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"  📧 Varningsmail skickat till {ADMIN}")
    except Exception as e:
        print(f"  ⚠️ Kunde inte skicka mail: {e}")

# ─── Testkonfiguration ────────────────────────────────────────────────────────
# Varje test: (url, beskrivning, check_fn)
# check_fn får (page, console_errors) och returnerar (ok, detalj)

PAGES = [
    {
        "url": f"{SITE}/",
        "name": "Startsida – hero laddas",
        "wait_for": ".hero",                      # Hero-sektionen måste finnas
        "must_visible": ".hero",                   # Och vara synlig
        "must_not_blank": True,
        "max_console_errors": 1,                   # pwa.js-felet är känt – tillåt max 1
    },
    {
        "url": f"{SITE}/stadare-dashboard.html",
        "name": "Städarportal – login-skärm visas",
        "wait_for": "#screen-login",
        "must_visible": "#screen-login",          # DETTA hade fångat den vita sidan
        "must_not_blank": True,
        "max_console_errors": 2,
        "extra_wait": 5000,   # Vänta på getSession timeout (3s)
    },
    {
        "url": f"{SITE}/boka.html",
        "name": "Bokningssida – step 1 synlig",
        "wait_for": "#step1",
        "must_visible": "#step1",
        "must_not_blank": True,
        "max_console_errors": 2,
    },
    {
        "url": f"{SITE}/stadare.html",
        "name": "Städarlista – redirect till boka.html",
        "must_not_blank": True,
        "wait_for": "#step1",                     # Redirectar till boka.html som har #step1
        "must_visible": "#step1",
        "max_console_errors": 2,
        "extra_wait": 3000,   # Vänta på redirect
    },
    {
        "url": f"{SITE}/priser.html",
        "name": "Prissida – kalkylator finns",
        "wait_for": "#rate",
        "must_visible": "#rate",
        "must_not_blank": True,
        "max_console_errors": 2,
    },
    {
        "url": f"{SITE}/admin.html",
        "name": "Admin – lösenordsskärm visas",
        "wait_for": "#login-screen, #app",
        "must_visible": "#login-screen",
        "must_not_blank": True,
        "max_console_errors": 3,
    },
]

async def run_tests():
    print("\n" + "="*55)
    print("  SPICK UI MONITOR – Playwright headless browser")
    print("="*55)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="SpickUIMonitor/1.0"
        )

        for test in PAGES:
            print(f"\n🌐 {test['name']}")
            print(f"   {test['url']}")

            page = await context.new_page()
            console_errors = []

            # Fånga alla JS-konsolfel
            page.on("console", lambda msg: console_errors.append(msg.text)
                    if msg.type == "error" else None)
            page.on("pageerror", lambda err: console_errors.append(f"PAGEERROR: {err}"))

            try:
                # Ladda sidan
                await page.goto(test["url"], wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(test.get('extra_wait', 4000))

                # Test 1: Blank sida?
                if test.get("must_not_blank"):
                    body_text = await page.evaluate("document.body?.innerText?.trim() || ''")
                    body_len  = await page.evaluate("document.body?.innerHTML?.length || 0")
                    if body_len < 500:
                        log_fail(f"{test['name']} – TOM SIDA", f"body innehåller bara {body_len} tecken")
                        await page.close()
                        continue
                    log_ok("Sidan inte tom", f"{body_len} tecken HTML")

                # Test 2: Nödvändigt element finns?
                if "wait_for" in test:
                    try:
                        el = await page.wait_for_selector(test["wait_for"], timeout=5000)
                        log_ok(f"Element finns: {test['wait_for']}")
                    except Exception:
                        log_fail(f"{test['name']} – ELEMENT SAKNAS", test["wait_for"])
                        await page.close()
                        continue

                # Test 3: Element synligt (inte display:none)?
                if "must_visible" in test:
                    sel = test["must_visible"]
                    try:
                        visible = await page.is_visible(sel)
                        if visible:
                            log_ok(f"Element synligt: {sel}")
                        else:
                            # Kolla computed style
                            display = await page.evaluate(
                                f"getComputedStyle(document.querySelector('{sel}') || document.body).display"
                            )
                            log_fail(
                                f"{test['name']} – ELEMENT DOLT",
                                f"{sel} har display:{display} – VIT SIDA-BUG"
                            )
                    except Exception as e:
                        log_fail(f"{test['name']} – visibility-kontroll", str(e)[:100])

                # Test 4: För många JS-fel?
                max_err = test.get("max_console_errors", 0)
                critical = [e for e in console_errors
                           if "supabase is not defined" in e or
                              "SyntaxError" in e or
                              "TypeError" in e.lower() and "undefined" in e.lower()]
                if len(critical) > max_err:
                    log_fail(
                        f"{test['name']} – JS-FEL",
                        f"{len(critical)} kritiska fel: {critical[0][:120]}"
                    )
                elif console_errors:
                    log_ok(f"JS-fel OK ({len(console_errors)} varningar, inga kritiska)")
                else:
                    log_ok("Inga JS-fel")

            except Exception as e:
                log_fail(f"{test['name']} – LADDNINGSFEL", str(e)[:200])

            await page.close()

        await browser.close()

    # ─── Sammanfattning ───────────────────────────────────────────────────
    print("\n" + "="*55)
    failures = [r for r in results if r[0] == "❌"]
    passes   = [r for r in results if r[0] == "✅"]
    print(f"  RESULTAT: {len(passes)} OK  |  {len(failures)} FEL")
    print("="*55)

    if failures:
        print("\nFEL:")
        for _, t, d in failures:
            print(f"  ❌ {t}: {d}")
        send_alert(failures)
        sys.exit(1)
    else:
        print("\n✅ Alla UI-tester gröna! Spick.se ser bra ut.")
        sys.exit(0)

asyncio.run(run_tests())
