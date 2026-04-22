-- =========================================================
-- Fas 2 §2.1.1 utökning — alla §2.1.1-policies konsoliderade
-- =========================================================
-- Primärkälla: respektive tabell-migration innan denna refaktor
-- (se commits 4f77d2a, 2f88dab, 6eb2fc8, e284c22, 72588f9, d3bc4c2,
-- 92df927, 27d5db5, e532395).
--
-- SCOPE: Alla ~60 policies för KRITISKA tabeller + cleaner_applications.
--
-- SKÄL FÖR KONSOLIDERING:
-- CREATE POLICY validerar tabell-refs inline vid CREATE. Policies som
-- refererar andra §2.1.1-tabeller kan inte definieras i sin egen
-- tabell-migration eftersom forward-refs bryter db reset. Genom att
-- samla alla policies i en migration EFTER alla CREATE TABLEs kan
-- alla refs lösas.
--
-- Körs efter: 20260422120000 (bookings, sista CREATE TABLE)
--
-- Alla policies använder DROP POLICY IF EXISTS + CREATE POLICY för
-- idempotens (PG 17 stödjer inte CREATE POLICY IF NOT EXISTS).
-- =========================================================

-- ═══════════════════════════════════════════════════════════
-- cleaner_applications
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin reads all applications" ON "public"."cleaner_applications";
CREATE POLICY "Admin reads all applications" ON "public"."cleaner_applications"
    FOR SELECT TO "authenticated"
    USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admin updates applications" ON "public"."cleaner_applications";
CREATE POLICY "Admin updates applications" ON "public"."cleaner_applications"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Anyone can insert applications" ON "public"."cleaner_applications";
CREATE POLICY "Anyone can insert applications" ON "public"."cleaner_applications"
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can submit applications" ON "public"."cleaner_applications";
CREATE POLICY "Authenticated can submit applications" ON "public"."cleaner_applications"
    FOR INSERT
    WITH CHECK (("auth"."role"() = 'authenticated'::"text"));

DROP POLICY IF EXISTS "Cleaner reads own application" ON "public"."cleaner_applications";
CREATE POLICY "Cleaner reads own application" ON "public"."cleaner_applications"
    FOR SELECT TO "authenticated"
    USING (("email" = ("auth"."jwt"() ->> 'email'::"text")));

DROP POLICY IF EXISTS "Service role reads applications" ON "public"."cleaner_applications";
CREATE POLICY "Service role reads applications" ON "public"."cleaner_applications"
    FOR SELECT TO "service_role"
    USING (true);

DROP POLICY IF EXISTS "Service role updates applications" ON "public"."cleaner_applications";
CREATE POLICY "Service role updates applications" ON "public"."cleaner_applications"
    FOR UPDATE TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD reads team applications" ON "public"."cleaner_applications";
CREATE POLICY "VD reads team applications" ON "public"."cleaner_applications"
    FOR SELECT TO "authenticated"
    USING (("invited_by_company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

-- ═══════════════════════════════════════════════════════════
-- customer_profiles
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin SELECT customer profiles" ON "public"."customer_profiles";
CREATE POLICY "Admin SELECT customer profiles" ON "public"."customer_profiles"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
    )));

DROP POLICY IF EXISTS "Customer reads own profile" ON "public"."customer_profiles";
CREATE POLICY "Customer reads own profile" ON "public"."customer_profiles"
    FOR SELECT TO "authenticated"
    USING (("auth_user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Customer updates own profile" ON "public"."customer_profiles";
CREATE POLICY "Customer updates own profile" ON "public"."customer_profiles"
    FOR UPDATE TO "authenticated"
    USING (("auth_user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Owner reads own profile" ON "public"."customer_profiles";
CREATE POLICY "Owner reads own profile" ON "public"."customer_profiles"
    FOR SELECT TO "authenticated"
    USING ((("auth_user_id" = "auth"."uid"())
        OR ("email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text"))));

DROP POLICY IF EXISTS "Service role full profiles" ON "public"."customer_profiles";
CREATE POLICY "Service role full profiles" ON "public"."customer_profiles"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin_reads_all_customer_profiles" ON "public"."customer_profiles";
CREATE POLICY "admin_reads_all_customer_profiles" ON "public"."customer_profiles"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
        WHERE ("admin_users"."is_active" = true)
    )));

-- ═══════════════════════════════════════════════════════════
-- service_checklists
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin manages all service_checklists" ON "public"."service_checklists";
CREATE POLICY "Admin manages all service_checklists" ON "public"."service_checklists"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Public read service_checklists" ON "public"."service_checklists";
CREATE POLICY "Public read service_checklists" ON "public"."service_checklists"
    FOR SELECT TO "authenticated", "anon"
    USING (true);

DROP POLICY IF EXISTS "Service role manages service_checklists" ON "public"."service_checklists";
CREATE POLICY "Service role manages service_checklists" ON "public"."service_checklists"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages own company service_checklists" ON "public"."service_checklists";
CREATE POLICY "VD manages own company service_checklists" ON "public"."service_checklists"
    TO "authenticated"
    USING (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

-- ═══════════════════════════════════════════════════════════
-- ratings
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow insert ratings" ON "public"."ratings";
CREATE POLICY "Allow insert ratings" ON "public"."ratings"
    FOR INSERT TO "authenticated", "anon"
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read ratings" ON "public"."ratings";
CREATE POLICY "Anon can read ratings" ON "public"."ratings"
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Cleaner sees own ratings" ON "public"."ratings";
CREATE POLICY "Cleaner sees own ratings" ON "public"."ratings"
    FOR SELECT
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

-- ═══════════════════════════════════════════════════════════
-- waitlist
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin_read_waitlist" ON "public"."waitlist";
CREATE POLICY "admin_read_waitlist" ON "public"."waitlist"
    FOR SELECT
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
        WHERE ("admin_users"."is_active" = true)
    )));

DROP POLICY IF EXISTS "anon_insert_waitlist" ON "public"."waitlist";
CREATE POLICY "anon_insert_waitlist" ON "public"."waitlist"
    FOR INSERT
    WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- notifications
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Auth updates notifications" ON "public"."notifications";
CREATE POLICY "Auth updates notifications" ON "public"."notifications"
    FOR UPDATE
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Cleaner sees own notifications" ON "public"."notifications";
CREATE POLICY "Cleaner sees own notifications" ON "public"."notifications"
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Read own notifications" ON "public"."notifications";
CREATE POLICY "Read own notifications" ON "public"."notifications"
    FOR SELECT TO "authenticated"
    USING (("cleaner_id" = "auth"."uid"()));

-- ═══════════════════════════════════════════════════════════
-- tasks
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin manages all tasks" ON "public"."tasks";
CREATE POLICY "Admin manages all tasks" ON "public"."tasks"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Cleaner manages own tasks" ON "public"."tasks";
CREATE POLICY "Cleaner manages own tasks" ON "public"."tasks"
    TO "authenticated"
    USING ((
        ("assigned_to" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
        OR
        ("created_by" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
    ))
    WITH CHECK ((
        ("assigned_to" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
        OR
        ("created_by" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
    ));

DROP POLICY IF EXISTS "Service role manages tasks" ON "public"."tasks";
CREATE POLICY "Service role manages tasks" ON "public"."tasks"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages team tasks" ON "public"."tasks";
CREATE POLICY "VD manages team tasks" ON "public"."tasks"
    TO "authenticated"
    USING (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

-- ═══════════════════════════════════════════════════════════
-- guarantee_requests
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon insert guarantee requests" ON "public"."guarantee_requests";
CREATE POLICY "Anon insert guarantee requests" ON "public"."guarantee_requests"
    FOR INSERT TO "authenticated", "anon"
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage guarantee requests" ON "public"."guarantee_requests";
CREATE POLICY "Service manage guarantee requests" ON "public"."guarantee_requests"
    TO "service_role"
    USING (true);

DROP POLICY IF EXISTS "Service read guarantee requests" ON "public"."guarantee_requests";
CREATE POLICY "Service read guarantee requests" ON "public"."guarantee_requests"
    FOR SELECT TO "service_role"
    USING (true);

-- ═══════════════════════════════════════════════════════════
-- cleaner_service_prices
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin SELECT cleaner service prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Admin SELECT cleaner service prices" ON "public"."cleaner_service_prices"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
    )));

DROP POLICY IF EXISTS "Admin can manage service prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Admin can manage service prices" ON "public"."cleaner_service_prices"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Anon can read prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Anon can read prices" ON "public"."cleaner_service_prices"
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Authenticated can manage own prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Authenticated can manage own prices" ON "public"."cleaner_service_prices"
    TO "authenticated"
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )))
    WITH CHECK (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "company_owner_manage_team_prices" ON "public"."cleaner_service_prices";
CREATE POLICY "company_owner_manage_team_prices" ON "public"."cleaner_service_prices"
    USING (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "c2"."company_id"
            FROM "public"."cleaners" "c2"
            WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
        ))
    )))
    WITH CHECK (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "c2"."company_id"
            FROM "public"."cleaners" "c2"
            WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
        ))
    )));

-- ═══════════════════════════════════════════════════════════
-- company_service_prices
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin manages all company prices" ON "public"."company_service_prices";
CREATE POLICY "Admin manages all company prices" ON "public"."company_service_prices"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Public read company_service_prices — intentional" ON "public"."company_service_prices";
CREATE POLICY "Public read company_service_prices — intentional" ON "public"."company_service_prices"
    FOR SELECT TO "authenticated", "anon"
    USING (true);

DROP POLICY IF EXISTS "Service role manages company_service_prices" ON "public"."company_service_prices";
CREATE POLICY "Service role manages company_service_prices" ON "public"."company_service_prices"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages own company prices" ON "public"."company_service_prices";
CREATE POLICY "VD manages own company prices" ON "public"."company_service_prices"
    TO "authenticated"
    USING (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

-- ═══════════════════════════════════════════════════════════
-- self_invoices
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Cleaners see own invoices" ON "public"."self_invoices";
CREATE POLICY "Cleaners see own invoices" ON "public"."self_invoices"
    FOR SELECT
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Service role full access" ON "public"."self_invoices";
CREATE POLICY "Service role full access" ON "public"."self_invoices"
    TO "service_role"
    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- auth_audit_log
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin reads auth_audit_log" ON "public"."auth_audit_log";
CREATE POLICY "Admin reads auth_audit_log" ON "public"."auth_audit_log"
    FOR SELECT TO "authenticated"
    USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Service role writes auth_audit_log" ON "public"."auth_audit_log";
CREATE POLICY "Service role writes auth_audit_log" ON "public"."auth_audit_log"
    TO "service_role"
    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- magic_link_shortcodes
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Service role manages magic_link_shortcodes" ON "public"."magic_link_shortcodes";
CREATE POLICY "Service role manages magic_link_shortcodes" ON "public"."magic_link_shortcodes"
    TO "service_role"
    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- companies
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin SELECT companies" ON "public"."companies";
CREATE POLICY "Admin SELECT companies" ON "public"."companies"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
    )));

DROP POLICY IF EXISTS "Admin updates all companies" ON "public"."companies";
CREATE POLICY "Admin updates all companies" ON "public"."companies"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Allow insert companies" ON "public"."companies";
CREATE POLICY "Allow insert companies" ON "public"."companies"
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Company owner can read own company" ON "public"."companies";
CREATE POLICY "Company owner can read own company" ON "public"."companies"
    FOR SELECT
    USING (("owner_cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Company owner can update own company" ON "public"."companies";
CREATE POLICY "Company owner can update own company" ON "public"."companies"
    FOR UPDATE
    USING (("owner_cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Service role full access" ON "public"."companies";
CREATE POLICY "Service role full access" ON "public"."companies"
    USING (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "VD updates own company" ON "public"."companies";
CREATE POLICY "VD updates own company" ON "public"."companies"
    FOR UPDATE TO "authenticated"
    USING (("id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

DROP POLICY IF EXISTS "allow_anon_read_company_name" ON "public"."companies";
CREATE POLICY "allow_anon_read_company_name" ON "public"."companies"
    FOR SELECT
    USING (true);

-- ═══════════════════════════════════════════════════════════
-- cleaners
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin can manage cleaners" ON "public"."cleaners";
CREATE POLICY "Admin can manage cleaners" ON "public"."cleaners"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Admin can update any cleaner" ON "public"."cleaners";
CREATE POLICY "Admin can update any cleaner" ON "public"."cleaners"
    FOR UPDATE
    USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"))
    WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));

DROP POLICY IF EXISTS "Anon can read approved active cleaners" ON "public"."cleaners";
CREATE POLICY "Anon can read approved active cleaners" ON "public"."cleaners"
    FOR SELECT TO "authenticated", "anon"
    USING ((("is_approved" = true) AND ("is_active" = true)));

DROP POLICY IF EXISTS "Cleaner sees own data" ON "public"."cleaners";
CREATE POLICY "Cleaner sees own data" ON "public"."cleaners"
    FOR SELECT TO "authenticated"
    USING (("auth_user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Cleaner updates own profile" ON "public"."cleaners";
CREATE POLICY "Cleaner updates own profile" ON "public"."cleaners"
    FOR UPDATE
    USING (("auth_user_id" = "auth"."uid"()))
    WITH CHECK (("auth_user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Cleaners can update own profile columns" ON "public"."cleaners";
CREATE POLICY "Cleaners can update own profile columns" ON "public"."cleaners"
    FOR UPDATE
    USING (("auth"."uid"() = "id"))
    WITH CHECK (("auth"."uid"() = "id"));

DROP POLICY IF EXISTS "Company owner can insert team members" ON "public"."cleaners";
CREATE POLICY "Company owner can insert team members" ON "public"."cleaners"
    FOR INSERT
    WITH CHECK ("public"."is_company_owner_of"("company_id"));

DROP POLICY IF EXISTS "Company owner can update team members" ON "public"."cleaners";
CREATE POLICY "Company owner can update team members" ON "public"."cleaners"
    FOR UPDATE
    USING ("public"."is_company_owner_of"("company_id"));

DROP POLICY IF EXISTS "Users can create own cleaner" ON "public"."cleaners";
CREATE POLICY "Users can create own cleaner" ON "public"."cleaners"
    FOR INSERT
    WITH CHECK (("auth"."uid"() = "auth_user_id"));

DROP POLICY IF EXISTS "Users can update own cleaner" ON "public"."cleaners";
CREATE POLICY "Users can update own cleaner" ON "public"."cleaners"
    FOR UPDATE
    USING (("auth"."uid"() = "auth_user_id"));

-- ═══════════════════════════════════════════════════════════
-- bookings
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admin can manage bookings" ON "public"."bookings";
CREATE POLICY "Admin can manage bookings" ON "public"."bookings"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Anon creates bookings" ON "public"."bookings";
CREATE POLICY "Anon creates bookings" ON "public"."bookings"
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Auth read own bookings" ON "public"."bookings";
CREATE POLICY "Auth read own bookings" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING ((
        ("customer_email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text"))
        OR ("cleaner_id" = "auth"."uid"())
    ));

DROP POLICY IF EXISTS "Cleaner reads own bookings" ON "public"."bookings";
CREATE POLICY "Cleaner reads own bookings" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING (("cleaner_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Cleaner sees own bookings via cleaners table" ON "public"."bookings";
CREATE POLICY "Cleaner sees own bookings via cleaners table" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Cleaner updates own bookings" ON "public"."bookings";
CREATE POLICY "Cleaner updates own bookings" ON "public"."bookings"
    FOR UPDATE TO "authenticated"
    USING (("cleaner_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "Company owner reads team bookings" ON "public"."bookings";
CREATE POLICY "Company owner reads team bookings" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "owner"."company_id"
            FROM "public"."cleaners" "owner"
            WHERE (("owner"."auth_user_id" = "auth"."uid"()) AND ("owner"."is_company_owner" = true))
        ))
    )));

DROP POLICY IF EXISTS "Company owner updates team bookings" ON "public"."bookings";
CREATE POLICY "Company owner updates team bookings" ON "public"."bookings"
    FOR UPDATE TO "authenticated"
    USING (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "c2"."company_id"
            FROM "public"."cleaners" "c2"
            WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
        ))
    )))
    WITH CHECK ((
        ("cleaner_id" IN (
            SELECT "c"."id"
            FROM "public"."cleaners" "c"
            WHERE ("c"."company_id" IN (
                SELECT "c2"."company_id"
                FROM "public"."cleaners" "c2"
                WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
            ))
        ))
        OR ("cleaner_id" IS NULL)
    ));

DROP POLICY IF EXISTS "Customer reads own bookings" ON "public"."bookings";
CREATE POLICY "Customer reads own bookings" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));

DROP POLICY IF EXISTS "Service role full bookings" ON "public"."bookings";
CREATE POLICY "Service role full bookings" ON "public"."bookings"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admin_update_bookings" ON "public"."bookings";
CREATE POLICY "admin_update_bookings" ON "public"."bookings"
    FOR UPDATE
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
        WHERE ("admin_users"."is_active" = true)
    )));

DROP POLICY IF EXISTS "admin_view_all_bookings" ON "public"."bookings";
CREATE POLICY "admin_view_all_bookings" ON "public"."bookings"
    FOR SELECT TO "authenticated"
    USING ((EXISTS (
        SELECT 1
        FROM "public"."admin_users"
        WHERE ("admin_users"."email" = "auth"."email"())
    )));

DROP POLICY IF EXISTS "select_bookings_service" ON "public"."bookings";
CREATE POLICY "select_bookings_service" ON "public"."bookings"
    FOR SELECT TO "service_role"
    USING (true);

DROP POLICY IF EXISTS "update_bookings_service" ON "public"."bookings";
CREATE POLICY "update_bookings_service" ON "public"."bookings"
    FOR UPDATE TO "service_role"
    USING (true) WITH CHECK (true);

-- =========================================================
-- Slut alla §2.1.1-policies
-- =========================================================
