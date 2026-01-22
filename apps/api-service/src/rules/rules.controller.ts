import { Controller, Get, Param } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RuleDefinition } from './interfaces/rules.interface';

@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get()
  getAllRules(): RuleDefinition[] {
    return this.rulesService.getAllRules();
  }

  @Get(':name')
  getRule(@Param('name') name: string): RuleDefinition | undefined {
    return this.rulesService.getRule(name);
  }
}
