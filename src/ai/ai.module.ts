import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { OpenAiClientService } from './openai-client.service';

@Module({
  providers: [OpenAiClientService, AiService],
  exports: [OpenAiClientService, AiService],
})
export class AiModule {}
