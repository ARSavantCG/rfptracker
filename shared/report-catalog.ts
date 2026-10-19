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
  | 'rfp'           // an RFP id
  | 'properties'    // SEVERAL property ids — a whole park, or any mix of buildings
  | 'choice'        // one of a fixed list
  | 'boolean';      // present/absent flag

/**
 * HOW a parameter reaches the server. The reports were built at different times
 * and do not agree, so the difference is declared here rather than re-derived by
 * every caller:
 *
 *   'query'   — ?name=value. The majority.
 *   'path'    — substituted into a ':name' segment. budget-buckets takes its RFP
 *               in the path, so a query parameter would 404.
 *   'filters' — packed into a single ?filters={...} JSON object. The executive
 *               summary reads one JSON blob rather than separate parameters.
 */
export type ReportParamStyle = 'query' | 'path' | 'filters';

export interface ReportParam {
  name: string;
  label: string;
  type: ReportParamType;
  /** false means the report cannot be opened until this is chosen. */
  optional: boolean;
  /** Shown as the blank option when blank behaves differently from a value. */
  blankMeans?: string;
  /** Defaults to 'query'. */
  style?: ReportParamStyle;
  /** For type 'choice'. */
  choices?: Array<{ value: string; label: string }>;
}

export interface ReportDefinition {
  /** Stable identifier. NEVER renamed — saved pins reference it. */
  key: string;
  label: string;
  /** The question this report answers, in the reader's words. */
  answers: string;
  /**
   * 'api'   — an endpoint returning HTML; fetched with the auth token and opened
   *           in a new tab as a blob.
   * 'page'  — an in-app route; navigated to normally.
   * 'modal' — opens a dialog on the Reports page rather than a document. The
   *           custom report builder has no URL of its own; without this kind it
   *           would have had to stay outside the catalog as a special case.
   */
  kind: 'api' | 'page' | 'modal';
  path: string;
  params: ReportParam[];
  /**
   * A caveat the reader needs BEFORE opening it — a gap in the data, or a
   * prerequisite. Carried here so it shows wherever the report is offered,
   * rather than living in one page's markup as it did before.
   */
  note?: string;
  /** Permission the viewer needs, or null for anyone signed in. */
  permission: string | null;
  category: 'Portfolio' | 'Pipeline' | 'Cost' | 'People';
  /** lucide-react icon name; the client maps it to a component. */
  icon: string;
}

/**
 * The property scope parameter, shared by every report that can be narrowed.
 *
 * Defined once rather than repeated per report: nine entries using it means
 * nine chances for the name, type or blank behaviour to drift apart, which is
 * how portfolio, costs-in-place and executive ended up with three different
 * spellings of the same idea in the first place.
 *
 * Multi-select. A park is just every building sharing a property name, so the
 * picker offers that as one click and sends the ids it expands to.
 */
const PROPERTY_SCOPE: ReportParam = {
  name: 'propertyIds',
  label: 'Properties',
  type: 'properties',
  optional: true,
  blankMeans: 'Every property',
};

export const REPORT_CATALOG: ReportDefinition[] = [
  // ---- Portfolio ---------------------------------------------------------
  {
    key: 'portfolio',
    label: 'Portfolio Report',
    answers: 'How much area and parking does each building have, and what is still available?',
    kind: 'api',
    path: '/api/reports/portfolio',
    params: [PROPERTY_SCOPE],
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
    params: [PROPERTY_SCOPE],
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
    params: [PROPERTY_SCOPE],
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
    params: [PROPERTY_SCOPE],
    note: 'Publish dates began recording automatically on 19 Aug 2026. Earlier RFPs are listed as not measurable rather than counted as misses.',
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
    // These three used to come from the page-level Filters card, which sent them
    // to this report and nothing else. Declared here instead, so the scope is
    // visible on the report that uses it — and can be pinned, which a page-level
    // filter never could.
    params: [
      {
        name: 'status', label: 'Status', type: 'choice', optional: true, style: 'filters',
        blankMeans: 'Every status',
        choices: [
          { value: 'received', label: 'Received' },
          { value: 'in-progress', label: 'In Progress' },
          { value: 'completed', label: 'Completed' },
          { value: 'on-hold', label: 'On Hold' },
        ],
      },
      PROPERTY_SCOPE,
      {
        name: 'dueInDays', label: 'Due within', type: 'choice', optional: true, style: 'filters',
        blankMeans: 'Any time',
        choices: [
          { value: '1', label: 'Due within 1 day' },
          { value: '3', label: 'Due within 3 days' },
          { value: '7', label: 'Due within 1 week' },
          { value: '30', label: 'Due within 1 month' },
        ],
      },
    ],
    permission: null,
    category: 'Pipeline',
    icon: 'FileText',
  },
  {
    key: 'historical',
    label: 'Historical Pricing',
    answers: 'What did completed projects actually cost?',
    kind: 'api',
    path: '/api/reports/historical',
    // Deliberately no parameters. The old card sent it the page filters and the
    // handler never read them, so the filters appeared to apply and did not.
    // Declaring none is the honest description of what this report does.
    params: [],
    note: 'Covers completed projects only, and always the whole set — it cannot be filtered.',
    permission: null,
    category: 'Pipeline',
    icon: 'TrendingUp',
  },
  {
    key: 'custom',
    label: 'Custom Report',
    answers: 'What if I want to choose the columns myself?',
    kind: 'modal',
    path: '',
    params: [],
    note: 'Opens a builder: pick the fields, the order, and the export format.',
    permission: null,
    category: 'Pipeline',
    icon: 'BarChart3',
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
    params: [PROPERTY_SCOPE],
    permission: null,
    category: 'Cost',
    icon: 'DollarSign',
  },
  {
    key: 'budget-buckets',
    label: 'Budget by Contract',
    answers: 'How does one project split across contractor, design, CM fees and balance?',
    kind: 'api',
    // The RFP id goes in the PATH, not the query — a ?rfpId= would 404 here.
    path: '/api/reports/budget-buckets/:rfpId',
    params: [
      {
        name: 'rfpId', label: 'RFP', type: 'rfp', optional: false, style: 'path',
      },
    ],
    note: 'One project at a time. Only RFPs that have reached evaluation have budget data.',
    permission: null,
    category: 'Cost',
    icon: 'DollarSign',
  },
  {
    key: 'budget-reconciliation',
    label: 'Budget Reconciliation',
    answers: 'Does every saved grand total match the line items beneath it?',
    kind: 'api',
    path: '/api/reports/budget-reconciliation',
    params: [],
    note: 'Reads only. Flags any published total that does not equal the sum of its own lines.',
    permission: 'admin.access',
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
      PROPERTY_SCOPE,
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
    params: [PROPERTY_SCOPE],
    note: 'Assign people on each RFP under Project Team. Projects with nobody assigned will not appear.',
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
  // Packed into one ?filters={...} blob at the end, if any are set.
  const filterBlob: Record<string, string> = {};
  let path = def.path;

  for (const param of def.params) {
    const raw = params?.[param.name];
    if (raw === undefined || raw === null || raw === '' || raw === false) continue;
    const value = param.type === 'boolean' ? 'true' : String(raw);

    switch (param.style) {
      case 'path':
        // encodeURIComponent, not raw interpolation: a value with a slash in it
        // would otherwise invent a path segment.
        path = path.replace(`:${param.name}`, encodeURIComponent(value));
        break;
      case 'filters':
        filterBlob[param.name] = value;
        break;
      default:
        search.set(param.name, value);
    }
  }

  if (Object.keys(filterBlob).length > 0) {
    search.set('filters', JSON.stringify(filterBlob));
  }

  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Required parameters that have no value, by label.
 *
 * A path parameter left unfilled leaves a literal ":rfpId" in the URL, which
 * 404s with nothing to explain why. Callers check this before offering to open
 * or pin a report, so the gap is caught at the button rather than at the server.
 */
export function missingRequiredParams(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
): string[] {
  return def.params
    .filter((p) => !p.optional)
    .filter((p) => {
      const raw = params?.[p.name];
      return raw === undefined || raw === null || raw === '' || raw === false;
    })
    .map((p) => p.label);
}

/** True when this report can be opened with the parameters supplied. */
export function isReportReady(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
): boolean {
  return missingRequiredParams(def, params).length === 0;
}

/**
 * Rewrite a saved pin's parameters into the shapes the report declares TODAY.
 *
 * Reports change. When portfolio's `property` (a name) and costs-in-place's
 * `propertyId` were replaced by one multi-select `propertyIds`, every pin and
 * every pasted link still carried the old spelling — and buildReportUrl drops
 * parameters a report no longer declares, which would have quietly widened
 * "Costs in Place — Kurv Port Everglades" into the whole portfolio. A pin that
 * silently changes what it shows is worse than one that visibly breaks.
 *
 * So old spellings are translated rather than dropped. `resolveNameToIds` turns
 * a property NAME into the ids beneath it — which is also how a whole park is
 * selected — and is supplied by the caller, since this module has no access to
 * the property list.
 */
export function migrateLegacyParams(
  def: ReportDefinition,
  params: Record<string, any> | null | undefined,
  resolveNameToIds: (name: string) => string[],
): Record<string, any> {
  if (!params) return {};
  const out: Record<string, any> = { ...params };

  const takesPropertyIds = def.params.some((p) => p.name === 'propertyIds');
  if (takesPropertyIds) {
    const ids = new Set<string>();
    for (const id of String(out.propertyIds ?? '').split(',')) {
      const t = id.trim();
      if (t) ids.add(t);
    }
    // costs-in-place: ?propertyId=4   portfolio: ?building=9
    for (const key of ['propertyId', 'building']) {
      const raw = out[key];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        ids.add(String(raw).trim());
      }
      delete out[key];
    }
    // portfolio and executive: a property NAME, covering every building under it.
    const name = out.property;
    if (name !== undefined && name !== null && String(name).trim() !== '') {
      const resolved = resolveNameToIds(String(name).trim());
      if (resolved.length > 0) {
        resolved.forEach((id) => ids.add(id));
        delete out.property;
      }
      // A name that resolves to NOTHING is left in place on purpose. Deleting
      // it would turn a pin scoped to a deleted property into one that opens
      // the entire portfolio with no sign anything changed. Left behind, it is
      // reported as an undeclared parameter and the pin is visibly flagged.
    } else {
      delete out.property;
    }

    if (ids.size > 0) out.propertyIds = Array.from(ids).join(',');
    else delete out.propertyIds;
  }

  return out;
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
