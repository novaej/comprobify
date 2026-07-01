/**
 * Stable machine-readable error codes used in RFC 7807 Problem Detail responses.
 *
 * These are the `code` values that appear in every error response body:
 *
 *   { "code": "CERTIFICATE_EXPIRED", "status": 400, "detail": "..." }
 *
 * Clients should switch on `code`, not on `status` or `detail`, because HTTP
 * status codes are too coarse (multiple distinct errors share the same status)
 * and `detail` strings are for humans and may change.
 *
 * When adding a new error: add the constant here first, then use it at the
 * throw site. Do not hard-code string literals directly in service/middleware
 * files — always import from this module.
 */

const ErrorCodes = Object.freeze({
  // --- Certificate ---
  /** P12 file could not be parsed (corrupted or wrong format) */
  CERTIFICATE_INVALID: 'CERTIFICATE_INVALID',
  /** P12 password is incorrect */
  CERTIFICATE_PASSWORD_INVALID: 'CERTIFICATE_PASSWORD_INVALID',
  /** Signing key bag not found inside the P12 */
  CERTIFICATE_KEY_NOT_FOUND: 'CERTIFICATE_KEY_NOT_FOUND',
  /** Certificate notAfter date has passed */
  CERTIFICATE_EXPIRED: 'CERTIFICATE_EXPIRED',

  // --- Account / tenant status ---
  /** The tenant account has been suspended */
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  /** Operation requires a verified email address */
  EMAIL_VERIFICATION_REQUIRED: 'EMAIL_VERIFICATION_REQUIRED',
  /** Resend request too soon — server-side cooldown not elapsed */
  RESEND_COOLDOWN: 'RESEND_COOLDOWN',
  /** Verification token does not exist or has expired */
  INVALID_OR_EXPIRED_TOKEN: 'INVALID_OR_EXPIRED_TOKEN',
  /** Tenant email is already verified */
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',

  // --- Issuer resolution ---
  /** X-Issuer-Id header is missing */
  ISSUER_ID_REQUIRED: 'ISSUER_ID_REQUIRED',
  /** X-Issuer-Id value is not a valid positive integer */
  ISSUER_ID_INVALID: 'ISSUER_ID_INVALID',
  /** Issuer not found or is inactive */
  ISSUER_NOT_FOUND: 'ISSUER_NOT_FOUND',
  /** Issuer exists but belongs to a different tenant */
  ISSUER_FORBIDDEN: 'ISSUER_FORBIDDEN',
  /** sourceIssuerId not found or belongs to a different tenant */
  SOURCE_ISSUER_NOT_FOUND: 'SOURCE_ISSUER_NOT_FOUND',
  /** API key environment does not match the tenant's current environment */
  API_KEY_ENV_MISMATCH: 'API_KEY_ENV_MISMATCH',

  // --- Document ---
  /** Document type is not enabled for this issuer */
  DOCUMENT_TYPE_NOT_ENABLED: 'DOCUMENT_TYPE_NOT_ENABLED',
  /** Document type is not registered in the builder registry */
  DOCUMENT_TYPE_NOT_SUPPORTED: 'DOCUMENT_TYPE_NOT_SUPPORTED',
  /** Requested state transition is not allowed by the document state machine */
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  /** Operation requires document status to be AUTHORIZED */
  DOCUMENT_NOT_AUTHORIZED: 'DOCUMENT_NOT_AUTHORIZED',

  // --- API keys ---
  /** The key used to authenticate this request cannot revoke itself */
  SELF_REVOCATION_FORBIDDEN: 'SELF_REVOCATION_FORBIDDEN',
  /** Production keys can only be created after at least one promotion */
  PRODUCTION_KEY_REQUIRES_PROMOTION: 'PRODUCTION_KEY_REQUIRES_PROMOTION',

  // --- Tenant / plan limits ---
  /** Tenant has reached the maximum number of branches for their plan */
  BRANCH_LIMIT_REACHED: 'BRANCH_LIMIT_REACHED',
  /** Branch has reached the maximum number of issue points for this plan */
  ISSUE_POINT_LIMIT_REACHED: 'ISSUE_POINT_LIMIT_REACHED',
  /** Document type is not included in the tenant's current subscription tier */
  DOCUMENT_TYPE_NOT_IN_TIER: 'DOCUMENT_TYPE_NOT_IN_TIER',
  /** Supplied subscription tier is not recognised */
  INVALID_TIER: 'INVALID_TIER',
  /** Supplied tenant status value is not recognised */
  INVALID_TENANT_STATUS: 'INVALID_TENANT_STATUS',
  /** Source issuer RUC does not match the supplied RUC */
  RUC_MISMATCH: 'RUC_MISMATCH',
  /** Tenant has only one active issuer left — it cannot be removed */
  LAST_ISSUER_CANNOT_BE_REMOVED: 'LAST_ISSUER_CANNOT_BE_REMOVED',
  /** Issuer has issued documents and cannot be removed */
  ISSUER_HAS_DOCUMENTS: 'ISSUER_HAS_DOCUMENTS',
  /** Requested nextSequential is not greater than the current counter value */
  SEQUENTIAL_CANNOT_DECREASE: 'SEQUENTIAL_CANNOT_DECREASE',
  /** Subscription not found */
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  /** Payment not found */
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** Tenant already has a subscription in flight (not ACTIVE/CANCELLED/EXPIRED) */
  SUBSCRIPTION_ALREADY_IN_FLIGHT: 'SUBSCRIPTION_ALREADY_IN_FLIGHT',
  /** Tier change requested but the tenant has no ACTIVE subscription */
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  /** Requested tier is the same as the subscription's current tier */
  TIER_CHANGE_NO_OP: 'TIER_CHANGE_NO_OP',
  /** A tier change (upgrade payment or scheduled downgrade) is already in flight for this subscription */
  TIER_CHANGE_ALREADY_PENDING: 'TIER_CHANGE_ALREADY_PENDING',

  // --- Webhook endpoints ---
  /** Tenant has reached the maximum number of webhook endpoints for their plan */
  WEBHOOK_ENDPOINT_LIMIT_REACHED: 'WEBHOOK_ENDPOINT_LIMIT_REACHED',
  /** Webhook endpoint not found or belongs to a different tenant */
  WEBHOOK_ENDPOINT_NOT_FOUND: 'WEBHOOK_ENDPOINT_NOT_FOUND',

  // --- Legal documents ---
  /** No published version exists yet for the requested document type */
  AGREEMENT_NOT_FOUND: 'AGREEMENT_NOT_FOUND',
  /** Submitted termsVersion does not match the currently published version */
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  /** All legal documents must be ACCEPTED before promoting to production */
  AGREEMENT_ACCEPTANCE_REQUIRED: 'AGREEMENT_ACCEPTANCE_REQUIRED',

  // --- File upload ---
  /** Multipart file upload is malformed or contains an unexpected field */
  INVALID_FILE_UPLOAD: 'INVALID_FILE_UPLOAD',

  // --- Infrastructure (internal errors) ---
  /** AES-GCM decryption failed — possible data corruption or wrong key */
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  /** No builder is registered for the requested document type code */
  BUILDER_NOT_FOUND: 'BUILDER_NOT_FOUND',
});

module.exports = ErrorCodes;
