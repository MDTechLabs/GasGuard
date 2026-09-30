class PaginationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaginationError';
    this.statusCode = 400;
  }
}

module.exports = {
  PaginationError
};