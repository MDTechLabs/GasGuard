const { PaginationError } = require('../errors');

class ReportingService {
  constructor() {
    this.MAX_PAGE_SIZE = 100;
    this.DEFAULT_PAGE_SIZE = 20;
  }

  async fetchAllData() {
    throw new Error('Method not implemented');
  }

  async getPaginatedData({ page = 1, pageSize = this.DEFAULT_PAGE_SIZE } = {}) {
    const numericPage = parseInt(page, 10) || 1;
    const numericPageSize = parseInt(pageSize, 10) || this.DEFAULT_PAGE_SIZE;

    if (numericPage < 1) {
      throw new PaginationError('Page must be a positive integer');
    }

    if (numericPageSize < 1 || numericPageSize > this.MAX_PAGE_SIZE) {
      throw new PaginationError(`Page size must be between 1 and ${this.MAX_PAGE_SIZE}`);
    }

    const allData = await this.fetchAllData();
    const totalItems = allData.length;
    const totalPages = Math.ceil(totalItems / numericPageSize);

    if (numericPage > totalPages && totalItems > 0) {
      return {
        data: [],
        page: numericPage,
        pageSize: numericPageSize,
        totalItems,
        totalPages
      };
    }

    const startIndex = (numericPage - 1) * numericPageSize;
    const endIndex = startIndex + numericPageSize;
    const paginatedData = allData.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      page: numericPage,
      pageSize: numericPageSize,
      totalItems,
      totalPages
    };
  }
}

module.exports = { ReportingService };