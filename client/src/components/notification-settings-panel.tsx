import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { BellOff, Bell, AlertTriangle, Mail, CalendarClock } from "lucide-react";
import { REPORT_CADENCE_PRESETS } from "@shared/schema";

interface NotificationStatus {
  muted: boolean;
  willSend: boolean;
  blockers: string[];
  firesOn: string[];
  fromEmail: string;
  sendgridKeyConfigured: boolean;
  ownerContacts: { id: number; name: string; email: string }[];
  allOwners: { id: number; name: string; email: string; receivesNotifications: boolean }[];
  reportDays: string;
  reportHour: number;
  alwaysCopyEmail: string;
  businessTimezone: string;
  timezoneSample: string;
  ownerContactsWithoutEmail: number;
  deactivatedOwnersExcluded: number;
}

export function NotificationSettingsPanel() {
  const { toast } = useToast();
  const [copyEmail, setCopyEmail] = useState("");

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

  const recipientMutation = useMutation({
    mutationFn: async ({ contactId, receives }: { contactId: number; receives: boolean }) =>
      apiRequest("/api/admin/notifications/recipient", "POST", { contactId, receives }),
    onSuccess: () => refetch(),
    onError: (e: Error) =>
      toast({ title: "Could not update recipient", description: e.message, variant: "destructive" }),
  });

  // Seed the input once data arrives, without clobbering what is being typed.
  useEffect(() => {
    if (data?.alwaysCopyEmail !== undefined) setCopyEmail(data.alwaysCopyEmail);
  }, [data?.alwaysCopyEmail]);

  const alwaysCopyMutation = useMutation({
    mutationFn: async (email: string) =>
      apiRequest("/api/admin/notifications/always-copy", "POST", { email }),
    onSuccess: (_r, email) => {
      refetch();
      toast({
        title: email ? "Copy address saved" : "Copy address cleared",
        description: email
          ? `${email} will be BCC'd on every automated email.`
          : "No one is being copied on automated emails.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const cadenceMutation = useMutation({
    mutationFn: async ({ days, hour }: { days: string; hour: number }) =>
      apiRequest("/api/admin/notifications/cadence", "POST", { days, hour }),
    onSuccess: () => {
      refetch();
      toast({ title: "Report schedule updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not update schedule", description: e.message, variant: "destructive" }),
  });

  const setAll = (receives: boolean) => {
    (data?.allOwners ?? []).forEach((o) => {
      if (o.receivesNotifications !== receives) {
        recipientMutation.mutate({ contactId: o.id, receives });
      }
    });
  };

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
            <span className="text-muted-foreground">Dates rendered in</span>
            <span title="Set in shared/date-utils.ts — applies to every server-generated email and report">
              {data?.businessTimezone ?? '—'}{data?.timezoneSample ? ` · now ${data.timezoneSample}` : ''}
            </span>
          </div>
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

        <div className="rounded-lg border p-3 space-y-2">
          <Label className="text-xs font-medium">Always copy</Label>
          <p className="text-[11px] text-muted-foreground">
            BCC'd on every automated email — new RFP, publish, and the status report — whether or
            not this address is an Owner. Leave blank to turn off.
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              className="h-8 flex-1 text-xs"
              placeholder="you@kurvindustrial.com"
              value={copyEmail}
              onChange={(e) => setCopyEmail(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={alwaysCopyMutation.isPending || copyEmail === (data?.alwaysCopyEmail ?? "")}
              onClick={() => alwaysCopyMutation.mutate(copyEmail.trim())}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            Status report schedule
          </Label>
          <p className="text-[11px] text-muted-foreground">
            A digest of active RFPs, sent to the same recipients. Separate from the per-RFP alerts,
            which always fire immediately.
          </p>
          <div className="flex gap-2">
            <select
              className="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
              value={data?.reportDays ?? "1,3,5"}
              onChange={(e) =>
                cadenceMutation.mutate({ days: e.target.value, hour: data?.reportHour ?? 8 })}
            >
              {REPORT_CADENCE_PRESETS.map((p) => (
                <option key={p.label} value={p.days}>{p.label}</option>
              ))}
            </select>
            <select
              className="flex h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
              value={String(data?.reportHour ?? 8)}
              disabled={(data?.reportDays ?? "1,3,5") === ""}
              onChange={(e) =>
                cadenceMutation.mutate({ days: data?.reportDays ?? "1,3,5", hour: parseInt(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Server time. Takes effect immediately — no republish.
          </p>
        </div>

        {data?.allOwners && data.allOwners.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Who receives alerts</Label>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAll(true)}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAll(false)}>
                  Clear all
                </Button>
              </div>
            </div>
            <div className="rounded border divide-y">
              {data.allOwners.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-50"
                >
                  <Checkbox
                    checked={o.receivesNotifications}
                    onCheckedChange={(v) =>
                      recipientMutation.mutate({ contactId: o.id, receives: !!v })}
                  />
                  <span className={`font-medium ${o.receivesNotifications ? "" : "text-muted-foreground line-through"}`}>
                    {o.name}
                  </span>
                  <span className="text-muted-foreground ml-auto">{o.email}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Unchecking silences that person without deactivating the contact. Use this to send only
              to yourself while testing; the mute switch above stops everything at once.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
