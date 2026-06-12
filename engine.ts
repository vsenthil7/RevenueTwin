/**
 * Workflow & notifications (S18).
 *
 * Detected cases don't help anyone if nobody is told. This module routes cases to owners,
 * maintains a per-user approval inbox, tracks SLA timers, escalates overdue cases, and pushes
 * notifications through pluggable channels (Teams/Slack/email in production; in-memory here).
 *
 * Deterministic and clock-injectable so SLA/escalation logic is fully testable.
 */
export class WorkflowError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkflowError'; }
}

export type WorkItemStatus = 'unassigned' | 'assigned' | 'in_review' | 'escalated' | 'closed';

export interface WorkItem {
  readonly caseId: string;
  readonly customerId: string;
  assignee: string | null;
  status: WorkItemStatus;
  readonly createdAt: string;
  readonly slaDueAt: string; // ISO deadline for first decision
  escalatedAt: string | null;
}

export interface Notification {
  readonly to: string;
  readonly channel: ChannelName;
  readonly subject: string;
  readonly body: string;
  readonly at: string;
}

export type ChannelName = 'email' | 'slack' | 'teams' | 'inapp';

/** Pluggable notification channel. Production wraps a real transport. */
export interface NotificationChannel {
  readonly name: ChannelName;
  send(n: Notification): Promise<void>;
}

/** In-memory channel for pilots/tests; records what would have been sent. */
export class InMemoryChannel implements NotificationChannel {
  sent: Notification[] = [];
  constructor(public readonly name: ChannelName) {}
  async send(n: Notification): Promise<void> { this.sent.push(n); }
}

/** Adds `hours` to an ISO timestamp, returns ISO. */
export function addHours(iso: string, hours: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new WorkflowError(`Invalid timestamp ${iso}`);
  return new Date(t + hours * 3_600_000).toISOString();
}

export interface WorkflowConfig {
  /** hours from creation until the SLA deadline for a first decision. */
  readonly slaHours: number;
  /** escalation target user when SLA is breached. */
  readonly escalationTo: string;
}

export class WorkflowEngine {
  private items = new Map<string, WorkItem>();

  constructor(
    private channel: NotificationChannel,
    private config: WorkflowConfig,
    private clock: () => string = () => new Date().toISOString(),
  ) {}

  /** Register a newly detected case as a work item with an SLA deadline. */
  async intake(caseId: string, customerId: string): Promise<WorkItem> {
    if (this.items.has(caseId)) throw new WorkflowError(`Work item ${caseId} already exists`);
    const now = this.clock();
    const item: WorkItem = {
      caseId, customerId, assignee: null, status: 'unassigned',
      createdAt: now, slaDueAt: addHours(now, this.config.slaHours), escalatedAt: null,
    };
    this.items.set(caseId, item);
    return item;
  }

  /** Assign an owner and notify them. */
  async assign(caseId: string, assignee: string): Promise<WorkItem> {
    const item = this.require(caseId);
    if (item.status === 'closed') throw new WorkflowError(`Cannot assign a closed item ${caseId}`);
    item.assignee = assignee;
    item.status = 'assigned';
    await this.channel.send({
      to: assignee, channel: this.channel.name,
      subject: `Revenue case ${caseId} assigned to you`,
      body: `Case ${caseId} (customer ${item.customerId}) needs review by ${item.slaDueAt}.`,
      at: this.clock(),
    });
    return item;
  }

  /** Mark an item as under review (assignee opened it). */
  startReview(caseId: string): WorkItem {
    const item = this.require(caseId);
    if (item.assignee === null) throw new WorkflowError(`Cannot review unassigned item ${caseId}`);
    item.status = 'in_review';
    return item;
  }

  /** Close an item once a decision is made. */
  close(caseId: string): WorkItem {
    const item = this.require(caseId);
    item.status = 'closed';
    return item;
  }

  /**
   * Sweep for SLA breaches: any open (non-closed, non-escalated) item whose deadline has passed
   * is escalated and the escalation target is notified. Returns the escalated items.
   */
  async sweepSla(): Promise<WorkItem[]> {
    const now = this.clock();
    const nowMs = Date.parse(now);
    const escalated: WorkItem[] = [];
    for (const item of this.items.values()) {
      if (item.status === 'closed' || item.status === 'escalated') continue;
      if (Date.parse(item.slaDueAt) < nowMs) {
        item.status = 'escalated';
        item.escalatedAt = now;
        await this.channel.send({
          to: this.config.escalationTo, channel: this.channel.name,
          subject: `SLA breached on case ${item.caseId}`,
          body: `Case ${item.caseId} (customer ${item.customerId}) is overdue (due ${item.slaDueAt}).`,
          at: now,
        });
        escalated.push(item);
      }
    }
    return escalated;
  }

  /** The approval inbox for a user: assigned/in-review items they own, not closed. */
  inbox(userId: string): WorkItem[] {
    return [...this.items.values()].filter(
      (i) => i.assignee === userId && i.status !== 'closed');
  }

  get(caseId: string): WorkItem | null {
    return this.items.get(caseId) ?? null;
  }

  private require(caseId: string): WorkItem {
    const item = this.items.get(caseId);
    if (!item) throw new WorkflowError(`Work item ${caseId} not found`);
    return item;
  }
}
