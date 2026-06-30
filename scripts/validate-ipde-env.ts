import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface IpdeEnvironmentFinding {
  level: 'ERROR' | 'WARN';
  code: string;
  variable: string;
  message: string;
}

type EnvironmentSource = Record<string, string | undefined>;

export function validateIpdeEnvironment(
  env: EnvironmentSource = process.env,
  cwd = process.cwd(),
): IpdeEnvironmentFinding[] {
  const findings: IpdeEnvironmentFinding[] = [];

  requireNonEmpty(env, findings, 'DATABASE_URL');
  requireIntegerInRange(env, findings, 'APP_PORT', 1, 65535);
  requireEqual(env, findings, 'IPDE_TENANT_CODE', 'IPDE');
  requireNonEmpty(env, findings, 'IPDE_WHATSAPP_PHONE_ID');
  requireNonEmpty(env, findings, 'WHATSAPP_VERIFY_TOKEN');
  const sendEnabled = requireBoolean(env, findings, 'WHATSAPP_SEND_ENABLED');
  requireApiVersion(env, findings, 'WHATSAPP_API_VERSION');
  requireIntegerInRange(
    env,
    findings,
    'WHATSAPP_REQUEST_TIMEOUT_MS',
    1000,
    120000,
  );
  requireNonEmpty(env, findings, 'DEFAULT_OPENAI_MODEL');
  requireIntegerInRange(
    env,
    findings,
    'OPENAI_REQUEST_TIMEOUT_MS',
    1000,
    120000,
  );
  requireIntegerInRange(env, findings, 'IPDE_OUTBOUND_MAX_ATTEMPTS', 1, 10);
  requireIntegerInRange(
    env,
    findings,
    'IPDE_OUTBOUND_RETRY_DELAY_SECONDS',
    5,
    3600,
  );

  validatePath(env, findings, 'IPDE_COMMERCIAL_CONFIG_PATH', cwd);
  validatePath(env, findings, 'IPDE_MODEL_PDF_ASSETS_PATH', cwd);
  validatePath(env, findings, 'IPDE_PRICING_PROMOTIONS_PATH', cwd);
  validatePath(env, findings, 'IPDE_MEDIA_ASSETS_PATH', cwd);
  validatePath(env, findings, 'IPDE_MANUAL_CATALOG_PATH', cwd);

  const persistentRoot =
    optional(env, 'PERSISTENT_DATA_DIR') ??
    optional(env, 'RAILWAY_VOLUME_MOUNT_PATH');
  if (!persistentRoot) {
    findings.push({
      level: 'WARN',
      code: 'LOCAL_PERSISTENT_FALLBACK',
      variable: 'PERSISTENT_DATA_DIR',
      message:
        'No persistent root configured; local ./data fallback will be used.',
    });
  }

  const signatureEnabled = requireBoolean(
    env,
    findings,
    'WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED',
  );
  if (signatureEnabled === true) {
    requireNonEmpty(env, findings, 'META_APP_SECRET');
  }

  if (sendEnabled === true) {
    requireNonPlaceholder(env, findings, 'WHATSAPP_ACCESS_TOKEN');
  }

  if (!nonPlaceholder(env, 'OPENAI_API_KEY')) {
    findings.push({
      level: 'WARN',
      code: 'OPENAI_REAL_CALLS_DISABLED',
      variable: 'OPENAI_API_KEY',
      message:
        'OpenAI API key is missing or placeholder; fallbacks may be used.',
    });
  }

  return findings;
}

function main(): number {
  const cwd = process.cwd();
  const findings = validateIpdeEnvironment(
    {
      ...loadDotEnvFile(cwd),
      ...process.env,
    },
    cwd,
  );

  for (const finding of findings) {
    const output = `${finding.level} ${finding.code} ${finding.variable}: ${finding.message}`;
    if (finding.level === 'ERROR') {
      console.error(output);
    } else {
      console.warn(output);
    }
  }

  const errors = findings.filter((finding) => finding.level === 'ERROR');
  if (errors.length > 0) {
    console.error(
      `IPDE environment validation failed: ${errors.length} error(s)`,
    );
    return 1;
  }

  console.log('IPDE environment validation passed');
  return 0;
}

function requireNonEmpty(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
): string | null {
  const value = optional(env, variable);
  if (!value) {
    findings.push({
      level: 'ERROR',
      code: 'REQUIRED_ENV_MISSING',
      variable,
      message: 'Required environment variable is missing.',
    });
    return null;
  }
  return value;
}

function requireNonPlaceholder(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
): void {
  if (!nonPlaceholder(env, variable)) {
    findings.push({
      level: 'ERROR',
      code: 'SECRET_MISSING_FOR_REAL_SEND',
      variable,
      message:
        'A non-placeholder secret is required when WhatsApp real sending is enabled.',
    });
  }
}

function requireEqual(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
  expected: string,
): void {
  const value = requireNonEmpty(env, findings, variable);
  if (value && value !== expected) {
    findings.push({
      level: 'ERROR',
      code: 'UNEXPECTED_ENV_VALUE',
      variable,
      message: `Expected ${expected}.`,
    });
  }
}

function requireBoolean(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
): boolean | null {
  const value = requireNonEmpty(env, findings, variable);
  if (!value) return null;
  if (value !== 'true' && value !== 'false') {
    findings.push({
      level: 'ERROR',
      code: 'BOOLEAN_ENV_INVALID',
      variable,
      message: 'Expected true or false.',
    });
    return null;
  }
  return value === 'true';
}

function requireIntegerInRange(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
  min: number,
  max: number,
): void {
  const value = requireNonEmpty(env, findings, variable);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    findings.push({
      level: 'ERROR',
      code: 'INTEGER_ENV_OUT_OF_RANGE',
      variable,
      message: `Expected integer from ${min} to ${max}.`,
    });
  }
}

function requireApiVersion(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
): void {
  const value = requireNonEmpty(env, findings, variable);
  if (value && !/^v\d+\.\d+$/.test(value)) {
    findings.push({
      level: 'ERROR',
      code: 'WHATSAPP_API_VERSION_INVALID',
      variable,
      message: 'Expected format like v21.0.',
    });
  }
}

function validatePath(
  env: EnvironmentSource,
  findings: IpdeEnvironmentFinding[],
  variable: string,
  cwd: string,
): void {
  const value = requireNonEmpty(env, findings, variable);
  if (!value) return;
  if (isAbsolute(value) && !existsSync(value)) {
    findings.push({
      level: 'ERROR',
      code: 'CONFIG_PATH_NOT_FOUND',
      variable,
      message: 'Configured file path does not exist.',
    });
    return;
  }
  const resolved = resolve(cwd, value);
  if (!existsSync(resolved)) {
    findings.push({
      level: 'ERROR',
      code: 'CONFIG_PATH_NOT_FOUND',
      variable,
      message: 'Configured file path does not exist.',
    });
  }
}

function optional(env: EnvironmentSource, variable: string): string | null {
  const value = env[variable]?.trim();
  return value ? value : null;
}

function nonPlaceholder(env: EnvironmentSource, variable: string): boolean {
  const value = optional(env, variable);
  return Boolean(value && !value.startsWith('replace_with_'));
}

function loadDotEnvFile(cwd: string): EnvironmentSource {
  const envPath = resolve(cwd, '.env');
  if (!existsSync(envPath)) {
    return {};
  }

  const parsed: EnvironmentSource = {};
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7) : line;
    const separatorIndex = normalizedLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    parsed[key] = normalizeEnvValue(
      normalizedLine.slice(separatorIndex + 1).trim(),
    );
  }

  return parsed;
}

function normalizeEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(' #');
  if (commentIndex >= 0) {
    return value.slice(0, commentIndex).trim();
  }

  return value;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('IPDE environment validation failed: UNKNOWN_ERROR');
    process.exitCode = 1;
  }
}
