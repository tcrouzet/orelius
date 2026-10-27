export class ChatNavigation {
  private revision = 0;
  private pending = Promise.resolve();
  private sidebarCollapsed: boolean | null = null;

  path: string | null;

  constructor(path: string | null = null) { this.path = path; }

  rememberSidebar(collapsed: boolean): boolean { return this.sidebarCollapsed ??= collapsed; }

  restoreSidebar(fallback: boolean | null = null): boolean | null {
    const collapsed = this.sidebarCollapsed ?? fallback;
    this.sidebarCollapsed = null;
    return collapsed;
  }

  current(): () => boolean {
    const revision = this.revision;
    return () => revision === this.revision;
  }

  run(path: string | null, action: (current: () => boolean) => Promise<void>): Promise<void> {
    this.path = path;
    this.revision++;
    const current = this.current();
    const task = this.pending.then(async () => { if (current()) await action(current); });
    this.pending = task.catch(() => {});
    return task;
  }
}
