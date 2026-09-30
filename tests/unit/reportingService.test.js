const { ReportingService } = require('../../src/services/reportingService');
const { PaginationError } = require('../../src/errors');

describe('ReportingService Pagination', () => {
  let reportingService;

  beforeEach(() => {
    reportingService = new ReportingService();
  });

  describe('getPaginatedData', () => {
    const mockData = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, value: `item-${i + 1}` }));

    beforeEach(() => {
      jest.spyOn(reportingService, 'fetchAllData').mockResolvedValue(mockData);
    });

    it('should return first page with default pagination', async () => {
      const result = await reportingService.getPaginatedData({});
      expect(result.data.length).toBe(20);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(5);
      expect(result.totalItems).toBe(100);
    });

    it('should return specified page with custom page size', async () => {
      const result = await reportingService.getPaginatedData({ page: 2, pageSize: 10 });
      expect(result.data.length).toBe(10);
      expect(result.data[0].id).toBe(11);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(10);
    });

    it('should handle empty dataset', async () => {
      jest.spyOn(reportingService, 'fetchAllData').mockResolvedValue([]);
      const result = await reportingService.getPaginatedData({ page: 1, pageSize: 10 });
      expect(result.data.length).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('should throw PaginationError for invalid page', async () => {
      await expect(reportingService.getPaginatedData({ page: 0, pageSize: 10 }))
        .rejects.toThrow(PaginationError);
    });

    it('should throw PaginationError for page size exceeding maximum', async () => {
      await expect(reportingService.getPaginatedData({ page: 1, pageSize: 101 }))
        .rejects.toThrow(PaginationError);
    });

    it('should return last page with partial results', async () => {
      const result = await reportingService.getPaginatedData({ page: 5, pageSize: 20 });
      expect(result.data.length).toBe(0);
      expect(result.page).toBe(5);
    });
  });
});