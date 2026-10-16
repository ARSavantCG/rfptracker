/**
 * THE SINGLE SOURCE for what reports exist.
 *
 * Before this, a report's URL was written out by hand in every place that
 * offered it — reports.tsx, navigation.tsx, properties.tsx, the admin panel —
 * so adding one meant editing three or four files and four of the thirteen
 * reports never made it onto the Reports page at all. Same duplication that
 * produced five copies of the property legal totals and three copies of the bay
 * matcher.
 *
 * Add a report HERE and it appears everywhere that reads this catalog.
 *
 * Each entry says what QUESTION the report answers, not what it contains. "Open
 * Items" means nothing to someone who has not used it; "what is still in flight
 * and what is overdue" does.
 */

/** What kind of value a parameter takes, so the UI can offer the right picker. */
export type ReportParamType =
  | 'property'      // a property id, matched against properties.id
  | 'propertyName'  // a property NAME, which groups every building under it
  | 'boolean';      // present/absent flag

export interface ReportParam {
  name: string;
  label: string;
  type: ReportParamType;
  /** Blank means "everything", not an error. Every parameter here is optional today. */
  optional: boolean;
  /** Shown under the picker when blank behaves differently from a chosen value. */
  blankMeans?: string;
}

export interface ReportDefinition {
  /** Stable identifier. NEVER renamed — saved pins reference it. */
  key: string;
  label: string;
  /** The question this report answers, in the reader's words. */
  answers: string;
  /**
   * 'api'  — an endpoint returning HTML; fetched with the auth token and opened
   *          in a new tab as a blob.
   * 'page' — an in-app route; navigated to normally.
   */
  kind: 'api' | 'page';
  path: string;
  params: ReportParam[];
  /** Permission the viewer needs, or null for anyone signed in. */
  permission: string | null;
  category: 'Portfolio' | 'Pipeline' | 'Cost' | 'People';
  /** lucide-react icon name; the client maps it to a component. */
  icon: string;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  // ---- Portfolio ---------------------------------------------------------
  {
    key: 'portfolio',
    label: 'Portfolio Report',
    answers: 'How much area and parking does each building have, and what is still available?',
    kind: 'api',
    path: '/api/reports/portfolio',
    params: [
      {
        name: 'property',
        label: 'Property',
        type: 'propertyName',
        optional: true,
        blankMeans: 'Every building in the portfolio',
      },
    ],
    permission: null,
    category: 'Portfolio',
    icon: 'Building2',
  },
  {
    key: 'occupancy',
    label: 'Occupancy Report',
    answers: 'How much of each building is leased, and who is in it?',
    kind: 'api',
    path: '/api/reports/occupancy',
    params: [],
    permission: null,
    category: 'Portfolio',
    icon: 'Building2',
  },
  {
    key: 'property-summary',
    label: 'Property Summary',
    answers: 'What are the headline figures for every property?',
    kind: 'api',
    path: '/api/reports/property-summary',
    params: [],
    permission: null,
    category: 'Portfolio',
    icon: 'TableIcon',
  },
  {
    key: 'property-data-audit',
    label: 'Property Data Audit',
    answers: 'Which property records are incomplete or inconsistent?',
    kind: 'page',
    path: '/property-data-audit',
    params: [],
    permission: null,
    category: 'Portfolio',
    icon: 'ClipboardList',
  },

  // ---- Pipeline ----------------------------------------------------------
  {
    key: 'open-items',
    label: 'Open Items',
    answers: 'What is still in flight, and what is already overdue?',
    kind: 'api',
    path: '/api/reports/open-items',
    params: [],
    permission: null,
    category: 'Pipeline',
    icon: 'ListChecks',
  },
  {
    key: 'turnaround',
    label: 'RFP Turnaround',
    answers: 'Did we hit our internal due dates, and by how much?',
    kind: 'api',
    path: '/api/reports/turnaround',
    params: [],
    permission: 'admin.access',
    category: 'Pipeline',
    icon: 'Clock',
  },
  {
    key: 'executive',
    label: 'Executive Summary',
    answers: 'Where does every RFP stand right now?',
    kind: 'api',
    path: '/api/reports/executive',
    params: [],
    permission: null,
    category: 'Pipeline',
    icon: 'FileText',
  },
  {
    key: 'historical',
    label: 'Historical Report',
    answers: 'What has the pipeline done over time?',
    kind: 'api',
    path: '/api/reports/historical',
    params: [],
    permission: null,
    category: 'Pipeline',
    icon: 'TrendingUp',
  },
  {
    key: 'project-report-generator',
    label: 'Project Reports',
    answers: 'What is the full write-up for one project?',
    kind: 'page',
    path: '/project-report-generator',
    params: [],
    permission: null,
    category: 'Pipeline',
    icon: 'FileBarChart',
  },

  // ---- Cost --------------------------------------------------------------
  {
    key: 'costs-in-place',
    label: 'Costs in Place',
    answers: 'What has already been built into each building, and what did it cost?',
    kind: 'api',
    path: '/api/reports/costs-in-place',
    params: [
      {
        name: 'propertyId',
        label: 'Property',
        type: 'property',
        optional: true,
        blankMeans: 'Every property',
      },
    ],
    permission: null,
    category: 'Cost',
    icon: 'DollarSign',
  },
  {
    key: 'category-cost-breakdown',
    label: 'Category Cost Breakdown',
    answers: 'Where is the money going, by cost category?',
    kind: 'page',
    path: '/reports/category-cost-breakdown',
    params: [],
    permission: null,
    category: 'Cost',
    icon: 'Tags',
  },

  // ---- People ------------------------------------------------------------
  {
    key: 'vendor-workload',
    label: 'Vendor Workload',
    answers: 'How much work is each contractor carrying right now?',
    kind: 'api',
    path: '/api/reports/vendor-workload/html',
    params: [
      {
        name: 'incompleteOnly',
        label: 'Open work only',
        type: 'boolean',
        optional: true,
        blankMeans: 'Include completed work',
      },
    ],
    permission: null,
    category: 'People',
    icon: 'Users',
  },
  {
    key: 'project-team',
    label: 'Project Team Directory',
    answers: 'Who is assigned to what?',
    kind: 'api',
    path: '/api/reports/project-team',
    params: [],
    permission: null,
    category: 'People',
    icon: 'Users',
  },
];

export const REPORTS_BY_KEY: Record<string, ReportDefinition> =
  Object.fromEntries(REPORT_CATALOG.map((r) => [r.key, r]));

export const REPORT_CATEGORIES = ['Portfolio', 'Pipeline', 'Cost', 'People'] as const;

/**
 * Build a report's URL from saved parameters.
 *
 * ONLY parameters the definition declares are emitted. A pin saved before a
 * report's parameters changed can therefore carry a key this report no longer
 * understands, and it is dropped rather than appended to the query string — a
 * stale pin opens the report's default view instead of a URL the server will
 * reject.
 *
 * Blank, null and `false` are all "not set" and emit nothing.
 */
export function buildReportUrl(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
): string {
  const search = new URLSearchParams();
  for (const param of def.params) {
    const raw = params?.[param.name];
    if (raw === undefined || raw === null || raw === '' || raw === false) continue;
    search.set(param.name, param.type === 'boolean' ? 'true' : String(raw));
  }
  const qs = search.toString();
  return qs ? `${def.path}?${qs}` : def.path;
}

/** Parameters the definition does not declare, so a caller can report them. */
export function unknownParamKeys(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
): string[] {
  if (!params) return [];
  const known = new Set(def.params.map((p) => p.name));
  return Object.keys(params).filter((k) => !known.has(k));
}

/**
 * A pin's display label: the report name, plus what it is scoped to.
 *
 * `resolve` turns a parameter value into something a person recognises — a
 * property id into its name. It returns null when the value no longer resolves,
 * which is how a pin to a renamed or deleted property is caught instead of
 * rendering a bare id or throwing.
 */
export function describeReportPin(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
  resolve: (param: ReportParam, value: string) => string | null,
): { label: string; available: boolean; reason?: string } {
  const parts: string[] = [];

  for (const param of def.params) {
    const raw = params?.[param.name];
    if (raw === undefined || raw === null || raw === '' || raw === false) continue;

    if (param.type === 'boolean') {
      parts.push(param.label);
      continue;
    }

    const resolved = resolve(param, String(raw));
    if (resolved === null) {
      return {
        label: def.label,
        available: false,
        reason: `The ${param.label.toLowerCase()} this was pinned to no longer exists.`,
      };
    }
    parts.push(resolved);
  }

  return {
    label: parts.length ? `${def.label} — ${parts.join(' · ')}` : def.label,
    available: true,
  };
}

/** Whether a viewer's permission list lets them open this report. */
export function canViewReport(
  def: ReportDefinition,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (!def.permission) return true;
  return Array.isArray(permissions) && permissions.includes(def.permission);
}
