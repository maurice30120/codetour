import type { SourceFile } from "../../src/index";

/**
 * Ground-truth fixtures for the TypeScript pack (#151), ported from the
 * validated prototype fixtures (packages/mcp-server/prototype-codeflow-graph/
 * fixture/ts) and extended with a dynamic-dispatch case. Every expected row
 * is hand-written: `certainty: "provable"` marks relations a static pack must
 * assert (status "resolved"), `certainty: "hard"` marks relations that may
 * legitimately surface as heuristic edges (interface dispatch) or as explicit
 * ambiguity sites with candidates (dynamic dispatch) — never as a guessed edge.
 *
 * Line numbers below are asserted by the tests — edit with care.
 */

export const TS_REPOSITORY_PATH = "repository.ts";
export const TS_BASE_SERVICE_PATH = "base-service.ts";
export const TS_USER_SERVICE_PATH = "user-service.ts";
export const TS_ADMIN_SERVICE_PATH = "admin-service.ts";
export const TS_API_PATH = "api.ts";
export const TS_DISPATCH_PATH = "dispatch.ts";

export const TS_REPOSITORY = `export interface Repository {
  find(id: string): string | undefined;
  log(action: string, id: string): void;
}
`;

export const TS_BASE_SERVICE = `export class BaseService {
  protected validate(id: string): void {
    if (!id) {
      throw new Error("missing id");
    }
  }
}
`;

export const TS_USER_SERVICE = `import { BaseService } from "./base-service";
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
`;

export const TS_ADMIN_SERVICE = `export class AdminService {
  getUser(id: string): string {
    return \`admin:\${id}\`;
  }
}
`;

export const TS_API = `import { UserService as Users } from "./user-service";
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

export function dispatchUnknown(svc: any, id: string): string {
  return svc.getUser(id);
}
`;

export const TS_DISPATCH = `export class FastPicker {
  getUser(id: string): string {
    return \`fast:\${id}\`;
  }
}

export class SlowPicker {
  getUser(id: string): string {
    return \`slow:\${id}\`;
  }
}

export function handleViaPicker(fast: boolean, id: string): string {
  const picker = fast ? new FastPicker() : new SlowPicker();
  return picker.getUser(id);
}
`;

export const TS_PACK_FIXTURES: SourceFile[] = [
  { path: TS_REPOSITORY_PATH, content: TS_REPOSITORY },
  { path: TS_BASE_SERVICE_PATH, content: TS_BASE_SERVICE },
  { path: TS_USER_SERVICE_PATH, content: TS_USER_SERVICE },
  { path: TS_ADMIN_SERVICE_PATH, content: TS_ADMIN_SERVICE },
  { path: TS_API_PATH, content: TS_API },
  { path: TS_DISPATCH_PATH, content: TS_DISPATCH }
];

export const TSX_APP_PATH = "app.tsx";
export const TSX_APP = `export class Store {
  label(): string {
    return "store";
  }
}

export class App {
  private store = new Store();

  render(): string {
    return this.store.label();
  }
}

export function mount(): App {
  const app = new App();
  return app.render();
}
`;

export const TSX_FIXTURES: SourceFile[] = [{ path: TSX_APP_PATH, content: TSX_APP, language: "tsx" }];

// ---------------------------------------------------------------------------
// Hand-written ground truth.
// ---------------------------------------------------------------------------

export interface ExpectedEdge {
  from: string;
  to: string;
  kind: "call" | "new" | "super";
  callType: "direct" | "interface" | "super" | "new";
  status: "resolved" | "heuristic";
  file: string;
  /** 1-based line of the relation site. */
  line: number;
  certainty: "provable" | "hard";
}

export interface ExpectedSite {
  file: string;
  line: number;
  name: string;
  caller: string;
  candidates: string[];
  status: "ambiguous" | "unresolved";
  certainty: "provable" | "hard";
}

export const EXPECTED_EDGES: ExpectedEdge[] = [
  // import alias + var inference: new Users(...) -> UserService.constructor
  { from: "handleRequest", to: "UserService.constructor", kind: "new", callType: "new", status: "resolved", file: TS_API_PATH, line: 6, certainty: "provable" },
  { from: "handleRequest", to: "AdminService.constructor", kind: "new", callType: "new", status: "resolved", file: TS_API_PATH, line: 7, certainty: "provable" },
  // users.getUser(id) with users inferred from new Users(...)
  { from: "handleRequest", to: "UserService.getUser", kind: "call", callType: "direct", status: "resolved", file: TS_API_PATH, line: 8, certainty: "provable" },
  { from: "handleRequest", to: "AdminService.getUser", kind: "call", callType: "direct", status: "resolved", file: TS_API_PATH, line: 9, certainty: "provable" },
  // declared parameter type + import alias: auditUsers(users: Users)
  { from: "auditUsers", to: "UserService.getUser", kind: "call", callType: "direct", status: "resolved", file: TS_API_PATH, line: 13, certainty: "provable" },
  // inheritance: super() in the constructor, extends clause proves the base
  { from: "UserService.constructor", to: "BaseService.constructor", kind: "super", callType: "super", status: "resolved", file: TS_USER_SERVICE_PATH, line: 6, certainty: "provable" },
  // this.x inherited from the base class (this.validate)
  { from: "UserService.getUser", to: "BaseService.validate", kind: "call", callType: "direct", status: "resolved", file: TS_USER_SERVICE_PATH, line: 10, certainty: "provable" },
  // this.x on the enclosing type (this.audit)
  { from: "UserService.getUser", to: "UserService.audit", kind: "call", callType: "direct", status: "resolved", file: TS_USER_SERVICE_PATH, line: 11, certainty: "provable" },
  // interface dispatch through a typed field (this.repository.find): asserted
  // toward the port Repository.find with heuristic status — hard, never guessed
  { from: "UserService.getUser", to: "Repository.find", kind: "call", callType: "interface", status: "heuristic", file: TS_USER_SERVICE_PATH, line: 12, certainty: "hard" },
  { from: "UserService.audit", to: "Repository.log", kind: "call", callType: "interface", status: "heuristic", file: TS_USER_SERVICE_PATH, line: 16, certainty: "hard" },
  // dynamic dispatch fixture: both creations are provable new edges
  { from: "handleViaPicker", to: "FastPicker.constructor", kind: "new", callType: "new", status: "resolved", file: TS_DISPATCH_PATH, line: 14, certainty: "provable" },
  { from: "handleViaPicker", to: "SlowPicker.constructor", kind: "new", callType: "new", status: "resolved", file: TS_DISPATCH_PATH, line: 14, certainty: "provable" }
];

export const EXPECTED_SITES: ExpectedSite[] = [
  // dynamic dispatch: picker's type comes from a ternary — NOT provable.
  // The call must surface as an ambiguity site with the same-named members
  // indexed on the local graph, never an edge.
  { file: TS_DISPATCH_PATH, line: 15, name: "getUser", caller: "handleViaPicker", candidates: ["AdminService.getUser", "FastPicker.getUser", "SlowPicker.getUser", "UserService.getUser"], status: "ambiguous", certainty: "hard" },
  // same-named methods on an untyped receiver: ambiguity site, never a false edge
  { file: TS_API_PATH, line: 17, name: "getUser", caller: "dispatchUnknown", candidates: ["AdminService.getUser", "FastPicker.getUser", "SlowPicker.getUser", "UserService.getUser"], status: "ambiguous", certainty: "hard" },
  // unknown global constructor: unresolved site with no candidates
  { file: TS_BASE_SERVICE_PATH, line: 4, name: "Error", caller: "BaseService.validate", candidates: [], status: "unresolved", certainty: "hard" }
];
