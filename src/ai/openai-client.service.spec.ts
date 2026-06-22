import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  OpenAiClientService,
  OpenAiConfigurationError,
} from './openai-client.service';

describe('OpenAiClientService', () => {
  it('stays unconfigured without an API key', () => {
    const service = new OpenAiClientService(new ConfigService({}));

    expect(service.isConfigured()).toBe(false);
    expect(service.getClient()).toBeNull();
    expect(service.requestTimeoutMs).toBe(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS);
  });

  it('creates one client with the configured timeout', () => {
    const service = new OpenAiClientService(
      new ConfigService({
        OPENAI_API_KEY: 'fictitious-test-key',
        OPENAI_REQUEST_TIMEOUT_MS: '15000',
      }),
    );

    expect(service.isConfigured()).toBe(true);
    expect(service.getClient()).toBe(service.getClient());
    expect(service.getClient()?.timeout).toBe(15000);
  });

  it.each(['0', '-1', 'not-a-number', '999999'])(
    'rejects an unreasonable timeout value: %s',
    (timeout) => {
      expect(
        () =>
          new OpenAiClientService(
            new ConfigService({
              OPENAI_REQUEST_TIMEOUT_MS: timeout,
            }),
          ),
      ).toThrow(OpenAiConfigurationError);
    },
  );
});
