# Fix Frontend ↔ DB Schema Alignment

## Problem
The local frontend files were patched to use column names that DON'T EXIST in the database.
The DB has the original column names from the migrations. The frontend must be reverted to match.

## Column Mapping (Frontend → Actual DB)

### Bookings table
| Frontend sends | Actual DB column | Notes |
|---|---|---|
| `customer_name` | `name` | COALESCE in views handles both |
| `customer_email` | `email` | Primary storage column |
| `customer_phone` | `phone` | |
| `customer_address` | `address` | |
| `service_type` | `service` | |
| `booking_date` | `date` | |
| `booking_time` | `time` | |
| `booking_hours` | `hours` | |
| `square_meters` | `sqm` | |
| `rut_amount` | `rut` (boolean) | |
| `payment_intent_id` | `stripe_payment_intent` | Set by webhook |

### Cleaners table
| Frontend queries | Actual DB column | Notes |
|---|---|---|
| `auth_user_id` | `email` | No auth_user_id column exists |
| `v_cleaners_for_booking` | `cleaners` table directly | View doesn't exist |

### booking_confirmation view
| Frontend queries | Actual view column |
|---|---|
| `payment_intent_id` | `stripe_session_id` |
| `service_type` | `service` |
| `booking_date` | `date` |
| `booking_time` | `time` |
| `customer_address` | `city` |

## Files to fix
1. boka.html — loadAvailableCleaners() + booking INSERT
2. stadare-dashboard.html — loadCleanerByEmail()
3. tack.html — fetchBookingBySession()
4. min-bokning.html — load() + cancelBooking()
5. mitt-konto.html — login() + confirmCancel()
6. booking-cancel-v2/index.ts — column names in SELECT + UPDATE
7. SQL migration — ensure correct RLS policies
