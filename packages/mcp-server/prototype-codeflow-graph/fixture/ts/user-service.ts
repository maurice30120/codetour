import { BaseService } from "./base-service";
import type { Repository } from "./repository";

export class UserService extends BaseService {
  constructor(private readonly repository: Repository) {
    super();
  }

  getUser(id: string): string | undefined {
    this.validate(id);
    this.audit(id);
    return this.repository.find(id);
  }

  private audit(id: string): void {
    this.repository.log("getUser", id);
  }
}
