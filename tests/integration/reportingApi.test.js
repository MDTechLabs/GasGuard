const request = require('supertest');
const app = require('../../src/app');
const { ReportingService } = require('../../src/services/reportingService');

jest.mock('../../src/services/reportingService');

describe('Reporting API Pagination', () => {
  const mockData = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, value: `report-${i + 1}` }));

  beforeEach(() => {
    ReportingService.prototype.getPaginatedData.mockResolvedValue({
      data: mockData.slice(0, 20),
      page: 1,
      pageSize: 20,
      totalItems: 50,
      totalPages: 3
    });
  });

  it('should return paginated results for /reports endpoint', async () => {
    const res = await request(app)
      .get('/api/reports')
      .query({ page: 1, pageSize: 20 })
      .expect(200);

    expect(res.body.data.length).toBe(20);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(3);
    expect(ReportingService.prototype.getPaginatedData).toHaveBeenCalledWith({
      page: '1',
      pageSize: '20'
    });
  });

  it('should use default pagination when no params provided', async () => {
    const res = await request(app)
      .get('/api/reports')
      .expect(200);

    expect(res.body.data.length).toBe(20);
    expect(res.body.page).toBe(1);
    expect(ReportingService.prototype.getPaginatedData).toHaveBeenCalledWith({});
  });

  it('should return 400 for invalid page parameter', async () => {
    ReportingService.prototype.getPaginatedData.mockRejectedValue(new Error('Invalid page'));
    await request(app)
      .get('/api/reports')
      .query({ page: 0 })
      .expect(400);
  });

  it('should return 400 for page size exceeding maximum', async () => {
    ReportingService.prototype.getPaginatedData.mockRejectedValue(new Error('Page size too large'));
    await request(app)
      .get('/api/reports')
      .query({ pageSize: 101 })
      .expect(400);
  });

  it('should handle empty result set', async () => {
    ReportingService.prototype.getPaginatedData.mockResolvedValue({
      data: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0
    });

    const res = await request(app)
      .get('/api/reports')
      .query({ page: 1, pageSize: 20 })
      .expect(200);

    expect(res.body.data.length).toBe(0);
    expect(res.body.totalPages).toBe(0);
  });
});