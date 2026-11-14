export class BaseService {
  protected validate(id: string): void {
    if (!id) {
      throw new Error("missing id");
    }
  }
}
