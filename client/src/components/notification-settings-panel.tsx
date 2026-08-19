import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { BellOff, Bell, AlertTriangle, Mail } from "lucide-react";

interface NotificationStatus {
  muted: boolean;
  willSend: boolean;
  blockers: string[];
  firesOn: string[];
  fromEmail: string;
  sendgridKeyConfigured: boolean;
  ownerContacts: { id: number; name: string; email: string }[];
  ownerContactsWithoutEmail: number;
  deactivatedOwnersExcluded: number;
}

export function NotificationSettingsPanel() {
  const { toast } = useToast();

  const { data, refetch } = useQuery<NotificationStatus>({
    queryKey: ["/api/admin/notification-status"],
  });

  const muteMutation = useMutation({
    mutationFn: async (muted: boolean) =>
      apiRequest("/api/admin/notifications/mute", "POST", { muted }),
    onSuccess: (_res, muted) => {
      refetch();
      toast({
        title: muted ? "Notifications muted" : "Notifications on",
        description: muted
          ? "No alerts will be sent until you turn this back on. Safe to run test RFPs."
          : "The team will receive new-RFP alerts again.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not change setting", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Notifications
        </CardTitle>
        <CardDescription>
          The team is alerted when someone completes Step 1 of an RFP, and when a project is
          published. Recipients are every active contact typed <strong>Owner</strong> in Contacts —
          add or deactivate someone there and this list follows automatically.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className={`flex items-start gap-3 rounded-lg border p-3 ${data?.muted ? "bg-amber-50 border-amber-300" : ""}`}>
          <Switch
            id="mute-notifications"
            checked={!!data?.muted}
            onCheckedChange={(v) => muteMutation.mutate(!!v)}
            disabled={muteMutation.isPending}
            data-testid="switch-mute-notifications"
          />
          <div className="leading-tight">
            <Label htmlFor="mute-notifications" className="cursor-pointer flex items-center gap-1.5">
              {data?.muted ? <BellOff className="h-4 w-4 text-amber-700" /> : <Bell className="h-4 w-4" />}
              Mute all outbound notifications
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Turn on before running test RFPs against live data. Suppresses new-RFP alerts,
              publish alerts, and the Mon/Wed/Fri status report. Takes effect immediately — no
              republish needed.
            </p>
          </div>
        </div>

        {data?.muted && (
          <Alert className="border-amber-300 bg-amber-50">
            <BellOff className="h-4 w-4" />
            <AlertDescription className="text-amber-900">
              <strong>Currently muted.</strong> Nothing is being sent. Remember to turn this off
              when testing is done — a muted app looks exactly like one nobody is using.
            </AlertDescription>
          </Alert>
        )}

        {data && !data.muted && data.blockers.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Alerts will not send:</strong>
              <ul className="list-disc pl-5 mt-1 text-xs">
                {data.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sending as</span>
            <span className="font-mono">{data?.fromEmail ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">SendGrid key</span>
            <span>
              {data?.sendgridKeyConfigured
                ? <Badge variant="outline">configured</Badge>
                : <Badge variant="destructive">missing</Badge>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipients (active owners)</span>
            <span>{data?.ownerContacts?.length ?? 0}</span>
          </div>
          {!!data?.ownerContactsWithoutEmail && (
            <div className="flex justify-between text-amber-700">
              <span>Owners with no email address</span>
              <span>{data.ownerContactsWithoutEmail}</span>
            </div>
          )}
          {!!data?.deactivatedOwnersExcluded && (
            <div className="flex justify-between text-muted-foreground">
              <span>Deactivated owners excluded</span>
              <span>{data.deactivatedOwnersExcluded}</span>
            </div>
          )}
        </div>

        {data?.ownerContacts && data.ownerContacts.length > 0 && (
          <div className="rounded border divide-y">
            {data.ownerContacts.map((o) => (
              <div key={o.id} className="flex justify-between px-2 py-1.5 text-xs">
                <span className="font-medium">{o.name}</span>
                <span className="text-muted-foreground">{o.email}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
