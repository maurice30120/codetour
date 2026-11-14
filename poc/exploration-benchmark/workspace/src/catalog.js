export class Catalog {
  constructor(storage, logger) {
    this.storage = storage;
    this.logger = logger;
  }

  find(id) {
    this.logger.info(`Looking up ${id}`);
    return this.storage.get(id);
  }
}
