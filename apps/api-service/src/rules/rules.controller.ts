import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RulesService } from "./rules.service";
import { RuleDefinition } from "./interfaces/rules.interface";

@Controller("rules")
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get()
  getAllRules(): RuleDefinition[] {
    return this.rulesService.getAllRules();
  }

  @Get(":name")
  getRule(@Param("name") name: string): RuleDefinition | undefined {
    return this.rulesService.getRule(name);
  }

  @Post("evaluate-policy")
  evaluatePolicy(
    @Body()
    body: {
      policy: {
        failOn?: {
          severities?: string[];
          rules?: string[];
          paths?: string[];
          minFindingCount?: number;
        };
      };
      findings: Array<{
        severity: string;
        rule: string;
        path: string;
      }>;
    },
  ): { passed: boolean; violations: string[] } {
    const failOn = body?.policy?.failOn ?? {};
    const findings = Array.isArray(body?.findings) ? body.findings : [];
    const violations: string[] = [];

    const matched = findings.filter((f) => {
      const sevMatch =
        !failOn.severities?.length || failOn.severities.includes(f.severity);
      const ruleMatch = !failOn.rules?.length || failOn.rules.includes(f.rule);
      const pathMatch =
        !failOn.paths?.length ||
        failOn.paths.some((p) => f.path.startsWith(p));
      return sevMatch && ruleMatch && pathMatch;
    });

    if (matched.length > 0) {
      violations.push(`${matched.length} finding(s) match failure criteria`);
    }
    if (
      typeof failOn.minFindingCount === "number" &&
      matched.length >= failOn.minFindingCount
    ) {
      violations.push(
        `finding count ${matched.length} reached threshold ${failOn.minFindingCount}`,
      );
    }

    return { passed: violations.length === 0, violations };
  }
}
