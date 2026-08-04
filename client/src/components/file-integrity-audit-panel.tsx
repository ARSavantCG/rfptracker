import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, AlertTriangle, RefreshCw, FileWarning, CheckCircle2 } from "lucide-react";

interface AuditFile {
  source: string;
  id: number;
  ownerLabel: string;
  originalName: string;
  storedAs: string;
  sizeBytes: number | null;
  retrievable: boolean;
}

interface AuditResult {
  checkedAt: string;
  objectStorageConfigured: boolean;
  summary: {
    total: number;
    retrievable: number;
    missing: number;
    bySource: { source: string; total: number; missing: number }[];
  };
  missingFiles: AuditFile[];
}

const SOURCE_LABEL: Record<string, string> = {
  property_attachment: "Property attachments",
  project_file: "Project files",
  evaluation_budget_attachment: "Evaluation budget attachments",
};

export function FileIntegrityAuditPanel() {
  // Not auto-run: the audit resolves every file individually, including Object
  // Storage round-trips, so it is deliberately on-demand rather than firing on
  // every visit to the Storage tab.
  const [hasRun, setHasRun] = useState(false);

  const { data, isFetching, refetch, error } = useQuery<AuditResult>({
    queryKey: ["/api/admin/file-audit"],
    enabled: hasRun,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const run = () => {
    if (!hasRun) setHasRun(true);
    else refetch();
  };

  const summary = data?.summary;
  const allHealthy = summary && summary.missing === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <ShieldCheck className="h-5 w-5" />
          <span>File Integrity Audit</span>
        </CardTitle>
        <CardDescription>
          Checks every stored file — property attachments, project files, and evaluation budget
          attachments — and reports which ones can still actually be downloaded. Each file is
          resolved the same way the download routes resolve it, so a pass here means the download
          genuinely works. Read-only: nothing is written, deleted, or repaired.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={isFetching} data-testid="button-run-file-audit">
            {isFetching ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Checking files…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 mr-2" />
                {hasRun ? "Run again" : "Run audit"}
              </>
            )}
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground">
              Last checked {new Date(data.checkedAt).toLocaleString()}
            </span>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Audit failed to run: {(error as Error).message}
            </AlertDescription>
          </Alert>
        )}

        {data && !data.objectStorageConfigured && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Object Storage is not configured</strong> (PRIVATE_OBJECT_DIR is unset).
              Uploads exist only on the container's local disk, which is wiped on every publish.
              Every file is at risk until this is set.
            </AlertDescription>
          </Alert>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Files checked</div>
                <div className="text-2xl font-semibold">{summary.total.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Retrievable</div>
                <div className="text-2xl font-semibold text-green-700">
                  {summary.retrievable.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Missing</div>
                <div
                  className={`text-2xl font-semibold ${summary.missing > 0 ? "text-red-700" : "text-green-700"}`}
                >
                  {summary.missing.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              {summary.bySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {SOURCE_LABEL[s.source] || s.source}
                  </span>
                  <span>
                    {s.total} checked
                    {s.missing > 0 ? (
                      <Badge variant="destructive" className="ml-2">
                        {s.missing} missing
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2">
                        all present
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {allHealthy ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Every stored file resolved successfully. Nothing is missing.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <Alert variant="destructive">
                  <FileWarning className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{summary.missing} file{summary.missing === 1 ? "" : "s"} cannot be
                    retrieved.</strong> These records exist in the database but the underlying bytes
                    are not on disk or in Object Storage. They are not recoverable from here — the
                    list below is so you know exactly which ones, and who they belong to, before
                    someone asks.
                  </AlertDescription>
                </Alert>

                <div className="max-h-80 overflow-y-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">File</th>
                        <th className="text-left p-2">Belongs to</th>
                        <th className="text-left p-2">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.missingFiles.map((f) => (
                        <tr key={`${f.source}-${f.id}`} className="border-t">
                          <td className="p-2 font-medium">{f.originalName}</td>
                          <td className="p-2">{f.ownerLabel}</td>
                          <td className="p-2 text-muted-foreground">
                            {SOURCE_LABEL[f.source] || f.source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
