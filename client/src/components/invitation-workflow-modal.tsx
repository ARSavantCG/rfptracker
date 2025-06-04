import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Mail, Users, Send, Building, User } from "lucide-react";
import type { RfpRequest, Contact, Invitation } from "@shared/schema";

interface InvitationWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function InvitationWorkflowModal({ isOpen, onClose, rfp }: InvitationWorkflowModalProps) {
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const { toast } = useToast();

  // Fetch contacts
  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ["/api/contacts"],
    enabled: isOpen,
  });

  // Fetch existing invitations for this RFP
  const { data: existingInvitations = [], isLoading: invitationsLoading } = useQuery({
    queryKey: ["/api/rfp-requests", rfp?.id, "invitations"],
    enabled: isOpen && !!rfp?.id,
  });

  // Send invitations mutation
  const sendInvitationsMutation = useMutation({
    mutationFn: async (contactIds: number[]) => {
      if (!rfp) throw new Error("No RFP selected");
      
      const invitationPromises = contactIds.map(contactId =>
        apiRequest(`/api/invitations`, "POST", {
          rfpId: rfp.id,
          contactId,
          status: "sent",
          sentAt: new Date().toISOString(),
        })
      );
      
      return Promise.all(invitationPromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitations"] });
      toast({
        title: "Invitations sent",
        description: `Successfully sent ${selectedContacts.length} invitation(s)`,
      });
      setSelectedContacts([]);
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send invitations. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleContactToggle = (contactId: number) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSendInvitations = () => {
    if (selectedContacts.length === 0) {
      toast({
        title: "No contacts selected",
        description: "Please select at least one contact to send invitations.",
        variant: "destructive",
      });
      return;
    }
    
    sendInvitationsMutation.mutate(selectedContacts);
  };

  // Get contact IDs that already have invitations
  const invitedContactIds = new Set((existingInvitations as Invitation[]).map((inv: Invitation) => inv.contactId));

  // Filter contacts by type
  const architects = (contacts as Contact[]).filter((contact: Contact) => contact.type === "architect");
  const contractors = (contacts as Contact[]).filter((contact: Contact) => contact.type === "contractor");

  const ContactSection = ({ title, contacts, icon: Icon }: { 
    title: string; 
    contacts: Contact[]; 
    icon: any;
  }) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h4 className="font-medium">{title}</h4>
        <Badge variant="secondary" className="ml-auto">
          {contacts.length}
        </Badge>
      </div>
      
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No {title.toLowerCase()} available
        </p>
      ) : (
        <div className="space-y-2">
          {contacts.map((contact) => {
            const isInvited = invitedContactIds.has(contact.id);
            const isSelected = selectedContacts.includes(contact.id);
            
            return (
              <div
                key={contact.id}
                className={`flex items-center space-x-3 p-3 rounded-lg border ${
                  isInvited 
                    ? "bg-muted/50 border-muted" 
                    : "bg-background hover:bg-muted/30 cursor-pointer"
                }`}
                onClick={() => !isInvited && handleContactToggle(contact.id)}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={isInvited}
                  onCheckedChange={() => !isInvited && handleContactToggle(contact.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{contact.name}</p>
                    {isInvited && (
                      <Badge variant="outline" className="text-xs">
                        Already invited
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{contact.company}</p>
                  <p className="text-xs text-muted-foreground">{contact.email}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Invitations
          </DialogTitle>
          <DialogDescription>
            {rfp && (
              <>
                Send invitations for <strong>{rfp.project}</strong> ({rfp.rfpNumber})
                <br />
                Client: {rfp.client}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {contactsLoading || invitationsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-muted-foreground">Loading contacts...</div>
          </div>
        ) : (
          <div className="space-y-6">
            <ScrollArea className="max-h-[400px] pr-4">
              <div className="space-y-6">
                <ContactSection 
                  title="Architects" 
                  contacts={architects} 
                  icon={Building}
                />
                
                <Separator />
                
                <ContactSection 
                  title="General Contractors" 
                  contacts={contractors} 
                  icon={User}
                />
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                {selectedContacts.length} contact(s) selected
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSendInvitations}
                  disabled={selectedContacts.length === 0 || sendInvitationsMutation.isPending}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {sendInvitationsMutation.isPending 
                    ? "Sending..." 
                    : `Send ${selectedContacts.length} Invitation${selectedContacts.length !== 1 ? 's' : ''}`
                  }
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}