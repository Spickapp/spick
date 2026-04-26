// supabase/functions/_shared/document-store.ts
// ──────────────────────────────────────────────────────────────────
// Sprint A (2026-04-26) — Universal dokument-arkivering.
//
// SYFTE:
//   Centralisera arkivering av kvitton, fakturor, kontrakt, försäkring,
//   tax-XML, certifikat, etc. Storage = Supabase storage-bucket 'documents'.
//
// SCOPE Sprint A:
//   - uploadDocument: spara fil + meta-rad
//   - listDocumentsForOwner: läs egna dokument
//   - getDocumentDownloadUrl: signerad temporär URL
//   - archiveExpiredDocuments: cron-job (Sprint B)
//
// REGLER: #26 N/A (ny fil), #27 scope (bara dokument-helpers), #28 SSOT
//   (alla dokument-ops via dessa funktioner), #30 BokfL retention är
//   default 7 år men kräver jurist-bedömning per dokumenttyp, #31 schema
//   curl-verifierat 2026-04-26 (documents existerar ej före migration).
// ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface SupabaseDocumentClient {
  from: (table: string) => any;
  storage: {
    from: (bucket: string) => {
      // deno-lint-ignore no-explicit-any
      upload: (path: string, body: Uint8Array | ArrayBuffer, opts?: any) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      createSignedUrl: (path: string, expiresInSeconds: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export type DocumentType =
  | "receipt"
  | "invoice_to_company"
  | "invoice_from_subleverantor"
  | "contract"
  | "insurance"
  | "tax_xml"
  | "training_cert"
  | "dispute_evidence"
  | "other";

export interface UploadDocumentOpts {
  type: DocumentType;
  title: string;
  fileBuffer: Uint8Array;
  mimeType: string;
  // Minst en ägar-FK
  customerEmail?: string;
  cleanerId?: string;
  companyId?: string;
  bookingId?: string;
  // Metadata
  description?: string;
  retentionDays?: number;     // default: 2555 dagar (7 år BokfL)
  expiresAt?: string;         // ISO timestamp för försäkring/avtal
  generatedBy?: "auto" | "admin" | "user_upload" | "system";
  sourceEf?: string;
}

export interface UploadDocumentResult {
  document_id: string;
  storage_path: string;
  bucket: string;
}

export interface DocumentRecord {
  id: string;
  document_type: DocumentType;
  customer_email: string | null;
  cleaner_id: string | null;
  company_id: string | null;
  booking_id: string | null;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  title: string;
  description: string | null;
  issued_at: string;
  expires_at: string | null;
  retention_until: string | null;
  generated_by: string;
  source_ef: string | null;
  status: "active" | "archived" | "deleted";
  created_at: string;
  updated_at: string;
}

export const DEFAULT_BUCKET = "documents";
export const DEFAULT_RETENTION_DAYS = 2555; // 7 år
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 timme

// ============================================================
// Helpers
// ============================================================

/**
 * Räknar ut framtida ISO-timestamp för retention.
 */
export function calcRetentionUntil(daysFromNow: number = DEFAULT_RETENTION_DAYS): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString();
}

/**
 * Bygger storage-path: type/yyyy-mm/<owner-key>/<uuid>.<ext>
 */
export function buildStoragePath(opts: {
  type: DocumentType;
  ownerKey: string;
  ext: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safeExt = (opts.ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `${opts.type}/${yyyy}-${mm}/${opts.ownerKey}/${uuid}.${safeExt}`;
}

/**
 * Mime-type → file-extension mapper (säker subset).
 */
export function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/webp": "webp",
    "text/html": "html",
    "text/plain": "txt",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/json": "json",
  };
  return map[mime.toLowerCase()] || "bin";
}

// ============================================================
// Upload
// ============================================================

/**
 * Laddar upp ett dokument till storage + skapar metadatarad.
 * Validerar att minst en ägar-FK är satt.
 */
export async function uploadDocument(
  supabase: SupabaseDocumentClient,
  opts: UploadDocumentOpts,
): Promise<UploadDocumentResult> {
  // Validering: minst en ägare
  if (!opts.customerEmail && !opts.cleanerId && !opts.companyId && !opts.bookingId) {
    throw new Error("uploadDocument: minst en ägar-FK krävs (customerEmail|cleanerId|companyId|bookingId)");
  }

  // Bygg path
  const ownerKey = (
    opts.cleanerId ||
    opts.companyId ||
    opts.bookingId ||
    (opts.customerEmail ? opts.customerEmail.replace(/[^a-z0-9]/gi, "") : "anon")
  ).slice(0, 32);
  const ext = extFromMime(opts.mimeType);
  const storagePath = buildStoragePath({ type: opts.type, ownerKey, ext });

  // Upload
  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(DEFAULT_BUCKET)
    .upload(storagePath, opts.fileBuffer, { contentType: opts.mimeType, upsert: false });
  if (uploadErr || !uploadData) {
    throw new Error(`uploadDocument storage-fel: ${uploadErr?.message || "okänt"}`);
  }

  // Metarad
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const retentionUntil = calcRetentionUntil(retentionDays);
  const insertRow = {
    document_type: opts.type,
    customer_email: opts.customerEmail ? opts.customerEmail.toLowerCase().trim() : null,
    cleaner_id: opts.cleanerId ?? null,
    company_id: opts.companyId ?? null,
    booking_id: opts.bookingId ?? null,
    storage_path: storagePath,
    file_size_bytes: opts.fileBuffer.length,
    mime_type: opts.mimeType,
    title: opts.title,
    description: opts.description ?? null,
    expires_at: opts.expiresAt ?? null,
    retention_until: retentionUntil,
    generated_by: opts.generatedBy ?? "auto",
    source_ef: opts.sourceEf ?? null,
  };
  const { data: docRow, error: docErr } = await supabase
    .from("documents")
    .insert(insertRow)
    .select("id, storage_path")
    .maybeSingle();

  if (docErr || !docRow) {
    // Cleanup storage om DB-insert failade
    await supabase.storage.from(DEFAULT_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`uploadDocument DB-fel: ${docErr?.message || "ingen rad"}`);
  }

  return {
    document_id: docRow.id as string,
    storage_path: docRow.storage_path as string,
    bucket: DEFAULT_BUCKET,
  };
}

// ============================================================
// Read / Download
// ============================================================

export interface ListDocumentsOpts {
  customerEmail?: string;
  cleanerId?: string;
  companyId?: string;
  bookingId?: string;
  type?: DocumentType;
  limit?: number;
}

/**
 * Listar dokument för ägare (max 100).
 * RLS skyddar — anrop från service-role bör explicit filtrera ägare.
 */
export async function listDocumentsForOwner(
  supabase: SupabaseDocumentClient,
  opts: ListDocumentsOpts,
): Promise<DocumentRecord[]> {
  if (!opts.customerEmail && !opts.cleanerId && !opts.companyId && !opts.bookingId) {
    return [];
  }
  let q = supabase.from("documents").select("*").eq("status", "active");
  if (opts.customerEmail) q = q.eq("customer_email", opts.customerEmail.toLowerCase().trim());
  if (opts.cleanerId) q = q.eq("cleaner_id", opts.cleanerId);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
  if (opts.type) q = q.eq("document_type", opts.type);
  q = q.order("issued_at", { ascending: false }).limit(opts.limit ?? 100);
  const { data } = await q;
  return (data as DocumentRecord[]) || [];
}

/**
 * Genererar signerad nedladdnings-URL (giltig 1h).
 */
export async function getDocumentDownloadUrl(
  supabase: SupabaseDocumentClient,
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(DEFAULT_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
