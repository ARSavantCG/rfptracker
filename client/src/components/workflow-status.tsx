import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, FileText, Users, ClipboardCheck, Award, CheckCircle } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

interface WorkflowStatusProps {
  rfp: RfpRequest;
  onAdvanceToInvitation: (rfp: RfpRequest) => void;
  onValidateRfp?: (rfp: RfpRequest) => void;
}

const workflowPhases = [
  { 
    key: "rfp-entry", 
    label: "RFP Entry", 
    icon: FileText, 
    color: "bg-blue-100 text-blue-700 border-blue-300",
    description: "Initial RFP data collection"
  },
  { 
    key: "invitation-to-bid", 
    label: "Invitation to Bid", 
    icon: Users, 
    color: "bg-orange-100 text-orange-700 border-orange-300",
    description: "Prepare and send bid invitations"
  },
  { 
    key: "bid-collection", 
    label: "Bid Collection", 
    icon: ClipboardCheck, 
    color: "bg-purple-100 text-purple-700 border-purple-300",
    description: "Collect and review submitted bids"
  },
  { 
    key: "evaluation", 
    label: "Evaluation", 
    icon: Award, 
    color: "bg-yellow-100 text-yellow-700 border-yellow-300",
    description: "Evaluate and compare bids"
  },
  { 
    key: "award", 
    label: "Award", 
    icon: CheckCircle, 
    color: "bg-green-100 text-green-700 border-green-300",
    description: "Select winner and award contract"
  }
];

export function WorkflowStatus({ rfp, onAdvanceToInvitation, onValidateRfp }: WorkflowStatusProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const advancePhaseMutation = useMutation({
    mutationFn: async (newPhase: string) => {
      return apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { phase: newPhase });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Workflow advanced",
        description: "Project has been moved to the next phase",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to advance workflow phase",
        variant: "destructive",
      });
    },
  });

  const currentPhaseIndex = workflowPhases.findIndex(phase => phase.key === rfp.workflowPhase);
  const nextPhase = workflowPhases[currentPhaseIndex + 1];

  const handleAdvancePhase = () => {
    if (nextPhase) {
      if (nextPhase.key === "invitation-to-bid") {
        // Open invitation-to-bid modal instead of directly advancing
        onAdvanceToInvitation(rfp);
      } else {
        advancePhaseMutation.mutate(nextPhase.key);
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Workflow Status</h3>
        <Badge variant="outline" className="text-xs">
          Phase {currentPhaseIndex + 1} of {workflowPhases.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {workflowPhases.map((phase, index) => {
          const Icon = phase.icon;
          const isActive = phase.key === rfp.workflowPhase;
          const isCompleted = index < currentPhaseIndex;
          const isNext = index === currentPhaseIndex + 1;

          return (
            <div
              key={phase.key}
              className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                isActive
                  ? phase.color
                  : isCompleted
                  ? "bg-gray-50 text-gray-600 border-gray-200"
                  : "bg-gray-25 text-gray-400 border-gray-100"
              }`}
            >
              <Icon className={`h-5 w-5 ${isCompleted ? "text-green-600" : ""}`} />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className={`font-medium text-sm ${isActive ? "text-gray-900" : ""}`}>
                    {phase.label}
                  </span>
                  {isCompleted && <CheckCircle className="h-4 w-4 text-green-600" />}
                  {isActive && (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5">
                      Current
                    </Badge>
                  )}
                </div>
                <p className="text-xs opacity-75 mt-1">{phase.description}</p>
              </div>
              {isNext && (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
            </div>
          );
        })}
      </div>

      {nextPhase && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <Button
            onClick={handleAdvancePhase}
            disabled={advancePhaseMutation.isPending}
            className="w-full"
          >
            {advancePhaseMutation.isPending ? (
              "Advancing..."
            ) : nextPhase.key === "invitation-to-bid" ? (
              "Create Invitation to Bid"
            ) : (
              `Advance to ${nextPhase.label}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}