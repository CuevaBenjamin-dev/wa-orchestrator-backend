import { z } from 'zod';
import {
  IpdeMessageExtractionSchema,
  IpdeMessageUnderstandingInputSchema,
} from './ipde-understanding.schemas';

export type IpdeMessageUnderstandingInput = z.infer<
  typeof IpdeMessageUnderstandingInputSchema
>;

export type IpdeMessageExtraction = z.infer<typeof IpdeMessageExtractionSchema>;

export type IpdeUnderstandingFallbackReason =
  | 'API_KEY_MISSING'
  | 'TIMEOUT'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMIT'
  | 'MODEL_NOT_AVAILABLE'
  | 'PARSED_OUTPUT_NULL'
  | 'INVALID_PARSED_OUTPUT'
  | 'NETWORK_ERROR'
  | 'SDK_ERROR'
  | 'UNKNOWN_ERROR';

export interface IpdeMessageUnderstandingResult {
  extraction: IpdeMessageExtraction;
  metadata: {
    source: 'OPENAI' | 'LOCAL_FALLBACK';
    model: string | null;
    promptVersion: string;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
    usedFallback: boolean;
    fallbackReason?: IpdeUnderstandingFallbackReason;
  };
}
