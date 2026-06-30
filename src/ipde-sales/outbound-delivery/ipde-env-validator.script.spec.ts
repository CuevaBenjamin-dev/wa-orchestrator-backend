import { resolve } from 'node:path';
import { validateIpdeEnvironment } from '../../../scripts/validate-ipde-env';

describe('ipde:env:validate', () => {
  const repoRoot = resolve(__dirname, '../../..');

  it('passes with valid staging environment and does not require real secrets', () => {
    const findings = validateIpdeEnvironment(validEnv(), repoRoot);

    expect(errors(findings)).toHaveLength(0);
    expect(codes(findings)).toContain('OPENAI_REAL_CALLS_DISABLED');
  });

  it('fails when real WhatsApp sending is enabled without a real token', () => {
    const findings = validateIpdeEnvironment(
      validEnv({
        WHATSAPP_SEND_ENABLED: 'true',
        WHATSAPP_ACCESS_TOKEN: 'replace_with_meta_access_token',
      }),
      repoRoot,
    );

    expect(errorCodes(findings)).toContain('SECRET_MISSING_FOR_REAL_SEND');
    expect(renderFindings(findings)).not.toContain(
      'replace_with_meta_access_token',
    );
  });

  it('fails when Meta signature validation is enabled without app secret', () => {
    const findings = validateIpdeEnvironment(
      validEnv({
        WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED: 'true',
        META_APP_SECRET: '',
      }),
      repoRoot,
    );

    expect(errorVariables(findings)).toContain('META_APP_SECRET');
    expect(renderFindings(findings)).not.toContain('app-secret');
  });

  it('validates timeout and outbox attempt ranges', () => {
    const findings = validateIpdeEnvironment(
      validEnv({
        WHATSAPP_REQUEST_TIMEOUT_MS: '10',
        IPDE_OUTBOUND_MAX_ATTEMPTS: '11',
      }),
      repoRoot,
    );

    expect(errorVariables(findings)).toContain('WHATSAPP_REQUEST_TIMEOUT_MS');
    expect(errorVariables(findings)).toContain('IPDE_OUTBOUND_MAX_ATTEMPTS');
  });
});

function errors<T extends { level: string }>(findings: T[]): T[] {
  return findings.filter((finding) => finding.level === 'ERROR');
}

function codes(findings: Array<{ code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

function errorCodes(
  findings: Array<{ code: string; level: string }>,
): string[] {
  return errors(findings).map((finding) => finding.code);
}

function errorVariables(
  findings: Array<{ level: string; variable: string }>,
): string[] {
  return errors(findings).map((finding) => finding.variable);
}

function renderFindings(
  findings: Array<{
    level: string;
    code: string;
    variable: string;
    message: string;
  }>,
): string {
  return findings
    .map(
      (finding) =>
        `${finding.level} ${finding.code} ${finding.variable}: ${finding.message}`,
    )
    .join('\n');
}

function validEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/example',
    APP_PORT: '3000',
    IPDE_TENANT_CODE: 'IPDE',
    IPDE_WHATSAPP_PHONE_ID: 'ipde-phone-id',
    WHATSAPP_VERIFY_TOKEN: 'verify-token',
    WHATSAPP_SEND_ENABLED: 'false',
    WHATSAPP_ACCESS_TOKEN: 'replace_with_meta_access_token',
    WHATSAPP_API_VERSION: 'v21.0',
    WHATSAPP_REQUEST_TIMEOUT_MS: '10000',
    OPENAI_API_KEY: '',
    OPENAI_REQUEST_TIMEOUT_MS: '10000',
    DEFAULT_OPENAI_MODEL: 'gpt-5.4-mini',
    PERSISTENT_DATA_DIR: './data',
    IPDE_COMMERCIAL_CONFIG_PATH: './config/ipde/commercial-config.json',
    IPDE_MODEL_PDF_ASSETS_PATH: './config/ipde/model-pdf-assets.json',
    IPDE_PRICING_PROMOTIONS_PATH: './config/ipde/pricing-promotions.json',
    IPDE_MEDIA_ASSETS_PATH: './config/ipde/media-assets.json',
    IPDE_MANUAL_CATALOG_PATH: './config/ipde/catalog.manual.json',
    META_APP_SECRET: '',
    WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED: 'false',
    IPDE_OUTBOUND_MAX_ATTEMPTS: '3',
    IPDE_OUTBOUND_RETRY_DELAY_SECONDS: '60',
    ...overrides,
  };
}
