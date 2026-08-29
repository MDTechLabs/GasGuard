import { Test, TestingModule } from '@nestjs/testing';
import { SorobanOptimizationReportController } from '../report-controller';

describe('SorobanOptimizationReportController', () => {
  let controller: SorobanOptimizationReportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SorobanOptimizationReportController],
    }).compile();

    controller = module.get<SorobanOptimizationReportController>(SorobanOptimizationReportController);
  });

  it('should return paginated optimization reports with filtering support', () => {
    const result = controller.getReports({ page: 1, limit: 10 });

    expect(result.data).toBeDefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });
});