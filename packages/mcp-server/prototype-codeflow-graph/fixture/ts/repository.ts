export interface Repository {
  find(id: string): string | undefined;
  log(action: string, id: string): void;
}
