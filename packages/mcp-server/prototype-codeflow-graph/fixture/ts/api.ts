import { UserService as Users } from "./user-service";
import { AdminService as Admins } from "./admin-service";
import type { Repository } from "./repository";

export function handleRequest(repository: Repository, id: string): string {
  const users = new Users(repository);
  const admins = new Admins();
  const user = users.getUser(id) ?? "anonymous";
  return admins.getUser(user);
}

export function auditUsers(users: Users, id: string): void {
  users.getUser(id);
}
