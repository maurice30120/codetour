export class AdminService {
  getUser(id: string): string {
    return `admin:${id}`;
  }
}
